import { screen, type IpcMain } from 'electron'
import { registerAppShellBridge } from '../appShellBridge'
import type { LaunchPathBuffer } from '../launchArgs'
import type { MpvController } from '../mpv/controller'
import type { PlayerRuntime } from '../playerRuntime'
import { createAppShellCoordinator, type AppShellCoordinator } from '../services/appShell'
import type { MediaHistoryService } from '../services/mediaHistory'
import type { MpvConfigManager } from '../services/mpvConfig'
import type { SettingsStore } from '../services/settings'
import type { StartupDecision } from '../startupDecision'
import type { StartupProbe } from '../startupProbe'
import { createSurfacePresentation } from '../surfacePresentation'
import { applyNavigationGuards, applyReloadGuard, sendToWindow } from '../windowOptions'
import {
  createAppWindowSet,
  loadRendererWindow,
  preparePlayerAppWindowSet,
  presentAppWindowSet,
  presentOverlayAppWindowSet,
  showOverlayAppWindowSet,
  type AppWindowSet
} from '../windowPair'
import { APP_SHELL_CHANNELS, WINDOW_CONTROL_CHANNELS } from '../../shared/ipcChannels'
import type { MainWindowRef, SendToMain } from './deps'
import { startGameOcr, type GameOcrHandles } from './gameOcr'
import type { AppPaths } from './paths'
import { createPlayerRuntimeForWindow } from './player'

export interface WindowRuntime {
  windows: AppWindowSet
  appShell: AppShellCoordinator
  player: PlayerRuntime
  gameOcr: GameOcrHandles | undefined
}

export interface CreateWindowDeps {
  ipcMain: IpcMain
  settings: SettingsStore
  paths: AppPaths
  sendToMain: SendToMain
  mainWindow: MainWindowRef
  controller: MpvController
  mpvConfig: MpvConfigManager
  mpvPath: string
  mediaHistory: MediaHistoryService
  decision: StartupDecision
  launchPathBuffer: LaunchPathBuffer
  startupProbe: StartupProbe
  quit: () => void
}

/**
 * Creates the window set and everything bound to it (Game OCR, the player
 * runtime, the app-shell coordinator), then presents the initial surface and
 * loads the renderer.
 */
export function createWindow(deps: CreateWindowDeps): WindowRuntime {
  const { ipcMain, paths, mainWindow, decision } = deps
  // Created below; the close guard and app shell only read them after this returns.
  const late: { gameOcr?: GameOcrHandles; appShell?: AppShellCoordinator } = {}
  const windows = createAppWindowSet({
    preloadPath: paths.preload,
    closeGuard: (event) => late.gameOcr?.lifecycle.handleWindowClose(event) ?? true
  })
  const surfacePresentation = createSurfacePresentation(windows, screen)
  const { videoHost, uiOverlay } = windows
  mainWindow.current = uiOverlay
  // Keep the renderer pinned to its bundled origin: deny off-page navigation and
  // refuse child-window creation (Electron security checklist #12/#13).
  applyNavigationGuards(uiOverlay.webContents)
  // Ctrl/Cmd+R is Chromium's built-in reload shortcut; it would otherwise
  // wipe the current session with no warning (see applyReloadGuard's doc).
  applyReloadGuard(uiOverlay.webContents)
  uiOverlay.on('closed', () => {
    if (mainWindow.current === uiOverlay) mainWindow.current = undefined
    late.gameOcr?.lifecycle.handleWindowLost()
  })
  uiOverlay.webContents.on('render-process-gone', () => late.gameOcr?.lifecycle.handleWindowLost())

  // In `dev`, electron-vite serves the renderer over HTTP (with HMR).
  // In a packaged/built app, load the compiled HTML from disk.
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  // The coordinator listens to the canonical native window (the Linux host,
  // or the single Windows window), restores paired bounds after the native
  // transition, and deduplicates the renderer-facing notification.
  windows.onFullscreenChanged((fullscreen) => {
    sendToWindow(uiOverlay, WINDOW_CONTROL_CHANNELS.fullscreenChanged, fullscreen)
  })

  const gameOcr = startGameOcr({
    ipcMain,
    settings: deps.settings,
    paths,
    sendToMain: deps.sendToMain,
    mainWindow,
    controller: deps.controller,
    windows,
    appShell: () => late.appShell,
    quit: deps.quit
  })
  late.gameOcr = gameOcr

  let rendererLoaded = false
  let initialPlayerPresentation = true

  // Do not let renderer effects invoke player channels before their handlers
  // exist. A failed mpv start is caught inside ensureStarted and still loads a
  // usable UI over the opaque host.
  const player = createPlayerRuntimeForWindow({
    ipcMain,
    paths,
    settings: deps.settings,
    controller: deps.controller,
    mpvConfig: deps.mpvConfig,
    mpvPath: deps.mpvPath,
    mediaHistory: deps.mediaHistory,
    launchPathBuffer: deps.launchPathBuffer,
    startupProbe: deps.startupProbe,
    videoHost,
    uiOverlay
  })
  const presentOverlay = (): void => {
    if (rendererLoaded) showOverlayAppWindowSet(windows)
    else presentOverlayAppWindowSet(windows)
  }

  const shell = createAppShellCoordinator({
    initialSurface: decision.initialSurface,
    presentInitialSurface: decision.presentInitialSurface,
    ensurePlayerStarted: () => {
      // Restore the normal player rectangle before mapping the mpv host. This
      // prevents a splash-sized host from ever being shown as the player.
      surfacePresentation.restorePlayerBounds()
      // mpv's X11 --wid target must already be mapped while it initializes.
      if (player.getState() === 'not-started') preparePlayerAppWindowSet(windows)
      return player.ensureStarted()
    },
    presentSplash: () => surfacePresentation.presentSplash(presentOverlay),
    presentPlayer: () => {
      if (initialPlayerPresentation) {
        initialPlayerPresentation = false
        if (rendererLoaded) windows.activate()
        else presentAppWindowSet(windows)
      } else {
        windows.activate()
      }
    },
    presentOptions: () => surfacePresentation.presentOptions(presentOverlay),
    dismissGameOcrOptions: () => gameOcr?.lifecycle.dismissOptions() ?? false,
    sendSurfaceChanged: (surface) =>
      sendToWindow(uiOverlay, APP_SHELL_CHANNELS.surfaceChanged, surface),
    // The coordinator owns the renderer-facing idempotence guard; this
    // callback must enter Electron's quit lifecycle directly or it would call
    // back into the coordinator and stop at that guard.
    quit: deps.quit
  })
  late.appShell = shell
  registerAppShellBridge(ipcMain, shell, (sender) => sender === uiOverlay.webContents)

  const loadRenderer = (): void => {
    if (rendererLoaded || uiOverlay.isDestroyed()) return
    rendererLoaded = true
    deps.startupProbe.mark('window')
    loadRendererWindow(uiOverlay, { devUrl, packagedHtmlPath: paths.rendererHtml })
  }

  const start = async (): Promise<void> => {
    if (decision.startGameOcr) {
      try {
        const status = await gameOcr?.runtime.start()
        if (status?.game.error || status?.game.state === 'error') await shell.showOptions()
      } catch {
        await shell.showOptions()
      }
    } else if (decision.initialSurface === 'player') {
      await shell.showPlayer()
    }

    if (uiOverlay.isDestroyed() || videoHost.isDestroyed()) return
    loadRenderer()
  }
  void start()

  return { windows, appShell: shell, player, gameOcr }
}
