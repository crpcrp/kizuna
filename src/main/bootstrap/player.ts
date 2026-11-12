import * as fs from 'node:fs'
import {
  globalShortcut,
  nativeImage,
  powerSaveBlocker,
  type BrowserWindow,
  type IpcMain,
  type Shell
} from 'electron'
import { join } from 'node:path'
import { screenshotsDir } from '../appIdentity'
import type { LaunchPathBuffer } from '../launchArgs'
import type { MpvController } from '../mpv/controller'
import { windowIdFromHandleBuffer } from '../mpv/nativeWindowHandle'
import { startMpvWithConfig } from '../mpvStartup'
import { registerPlayerBridge } from '../playerBridge'
import { createPlayerRuntime, type PlayerRuntime } from '../playerRuntime'
import { createPlayerSettingsService, registerPlayerSettingsBridge } from '../playerSettingsBridge'
import type { MediaHistoryService } from '../services/mediaHistory'
import { createMpvConfigManager, type MpvConfigManager } from '../services/mpvConfig'
import { createPowerSaveController } from '../services/powerSave'
import { createFrameCaptureService, createScreenshotService } from '../services/screenshots'
import type { SettingsStore } from '../services/settings'
import { createSystemMediaController } from '../services/systemMedia'
import type { StartupProbe } from '../startupProbe'
import { LAUNCH_CHANNELS } from '../../shared/ipcChannels'
import { sendToWindow } from '../windowOptions'
import { tempFileFs, type BootstrapDeps } from './deps'
import type { AppPaths } from './paths'

/**
 * Creates the mpv user-config manager and registers the player-settings IPC
 * bridge (getSettings/setSettings for the Options menu's contents:
 * keybindings, skip amount, popup/subtitle display), backed by the shared
 * settings store's `player` block.
 */
export function startPlayerSettings(
  deps: Pick<BootstrapDeps, 'ipcMain' | 'settings' | 'paths'> & { shell: Shell }
): MpvConfigManager {
  const mpvConfig = createMpvConfigManager({
    userDataDir: deps.paths.userData,

    shell: deps.shell
  })
  registerPlayerSettingsBridge(
    deps.ipcMain,
    createPlayerSettingsService({
      settings: deps.settings,
      openMpvConfigDir: () => mpvConfig.open()
    })
  )
  return mpvConfig
}

export interface PlayerWindowDeps {
  ipcMain: IpcMain
  paths: AppPaths
  settings: SettingsStore
  controller: MpvController
  mpvConfig: MpvConfigManager
  mpvPath: string
  mediaHistory: MediaHistoryService
  launchPathBuffer: LaunchPathBuffer
  startupProbe: StartupProbe
  videoHost: BrowserWindow
  uiOverlay: BrowserWindow
}

/**
 * Wires the app's `controller`/`mpvConfig` and this window into the
 * testable `startMpvWithConfig` orchestrator (see `mpvStartup.ts`), which owns
 * the config-enabled → no-config-retry → banner decision.
 */
function startMpvForWindow(deps: PlayerWindowDeps, windowId: bigint | string): Promise<void> {
  const { mpvUserConfig, mpvExtraArgs } = deps.settings.get().player
  return startMpvWithConfig({
    mpvPath: deps.mpvPath,
    windowId,
    settings: { mpvUserConfig, mpvExtraArgs },
    configDir: deps.mpvConfig.configDir,
    ensureConfigDir: () => deps.mpvConfig.ensureDir(),
    start: (opts) => deps.controller.start(opts),
    reportConfigError: (message) => {
      sendToWindow(deps.uiOverlay, LAUNCH_CHANNELS.error, message)
    },
    warn: (err) =>
      console.warn('[kizuna] mpv failed to start with user config; retrying without it:', err)
  })
}

/**
 * Builds the system-media controller with the real Electron surfaces: the
 * video host owns taskbar progress/thumbnail buttons, while media-key and
 * thumbnail activations are pushed to the renderer-owning overlay. On Windows
 * both roles are the same window. Icons are first-party PNGs under
 * `resources/icons/`.
 */
function createSystemMediaForWindow(
  iconsDir: string,
  videoHost: BrowserWindow,
  uiOverlay: BrowserWindow
): ReturnType<typeof createSystemMediaController> {
  const icon = (name: string): Electron.NativeImage =>
    nativeImage.createFromPath(join(iconsDir, `${name}.png`))
  const isWindows = process.platform === 'win32'
  return createSystemMediaController({
    globalShortcut,
    setProgressBar: (progress, options) => {
      if (videoHost.isDestroyed()) return
      if (options) videoHost.setProgressBar(progress, options)
      else videoHost.setProgressBar(progress)
    },
    setThumbarButtons: isWindows
      ? (buttons) => {
          if (videoHost.isDestroyed()) return
          videoHost.setThumbarButtons(
            buttons.map((b) => ({
              icon: b.icon as Electron.NativeImage,
              tooltip: b.tooltip,
              click: b.click
            }))
          )
        }
      : () => {},
    send: (channel, value) => {
      sendToWindow(uiOverlay, channel, value)
    },
    icons: { prev: icon('prev'), play: icon('play'), pause: icon('pause'), next: icon('next') }
  })
}

export function createPlayerRuntimeForWindow(deps: PlayerWindowDeps): PlayerRuntime {
  const { controller, videoHost, uiOverlay, paths, settings } = deps
  return createPlayerRuntime({
    startMpv: () =>
      startMpvForWindow(deps, windowIdFromHandleBuffer(videoHost.getNativeWindowHandle())),
    createPowerSave: () => createPowerSaveController(powerSaveBlocker),
    createSystemMedia: () => createSystemMediaForWindow(paths.iconsDir, videoHost, uiOverlay),
    createScreenshots: () =>
      createScreenshotService({
        takeScreenshot: (path) => controller.screenshotToFile(path),
        folder: () => settings.get().player.screenshotFolder ?? screenshotsDir(paths.pictures),
        exists: (path) => fs.existsSync(path),
        mkdir: (path) => {
          fs.mkdirSync(path, { recursive: true })
        }
      }),
    createFrames: () =>
      createFrameCaptureService({
        takeScreenshot: (path) => controller.screenshotToFile(path),
        tempDir: () => paths.temp,
        ...tempFileFs
      }),
    registerBridge: ({ powerSave, systemMedia, screenshots, frames }) => {
      registerPlayerBridge(
        deps.ipcMain,
        controller,
        (channel, value) => {
          sendToWindow(uiOverlay, channel, value)
        },
        deps.mediaHistory,
        powerSave,
        screenshots,
        systemMedia,
        frames
      )
    },
    launchPathBuffer: deps.launchPathBuffer,
    startupProbe: deps.startupProbe,
    warn: (err) => console.warn('[kizuna] mpv not started:', err)
  })
}
