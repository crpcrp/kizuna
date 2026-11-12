import {
  app,
  BrowserWindow,
  clipboard,
  ipcMain,
  safeStorage,
  screen,
  session,
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent
} from 'electron'
import * as fs from 'node:fs'
import { registerWindowControls, sendToWindow } from './windowOptions'
import { LAUNCH_CHANNELS } from '../shared/ipcChannels'
import { createAppLifecycleCoordinator, type AppLifecycleCoordinator } from './appLifecycle'
import { MpvController } from './mpv/controller'
import { resolveBinaryPaths } from './resourcePaths'
import { registerClipboardBridge } from './clipboardBridge'
import { createSafeStorageCodec } from './services/secrets'
import { createSettingsStore, type SettingsStore } from './services/settings'
import { createSettingsFile } from './services/settingsFile'
import { createUserUnidicManager } from './services/mecab/unidic'
import type { JimakuService } from './services/jimaku/service'
import type { MediaHistoryService } from './services/mediaHistory'
import type { MpvConfigManager } from './services/mpvConfig'
import { createLaunchPathBuffer, videoPathFromArgv } from './launchArgs'
import { applyAppIdentity } from './appIdentity'
import { createStartupProbe, STARTUP_PROBE_ENV } from './startupProbe'
import { resolveStartupDecision } from './startupDecision'
import type { UpdateService } from './updateService'
import type { BootstrapDeps, MainWindowRef, SendToMain } from './bootstrap/deps'
import { resolveAppPaths } from './bootstrap/paths'
import { createAppMediaHistoryStore, startMedia, startMediaHistory } from './bootstrap/media'
import { startDict, startMecab } from './bootstrap/dict'
import { startAnki } from './bootstrap/anki'
import { startKnowledge } from './bootstrap/knowledge'
import { startTranslation } from './bootstrap/translation'
import { startJimaku } from './bootstrap/jimaku'
import { startPlayerSettings } from './bootstrap/player'
import { startAppInfo } from './bootstrap/appInfo'
import { startUpdates } from './bootstrap/updates'
import { createWindow, type WindowRuntime } from './bootstrap/window'

// Must run before `ready` and before the first `app.getPath('userData')`:
// Electron resolves that path once, from the app name, and caches it.
applyAppIdentity(app)

// mpv's `--wid` embedding requires an X11 window. Electron also documents
// XWayland as the supported path when programmatic positioning and resizing
// are required, as they are for Kizuna's paired windows.
if (process.platform === 'linux') app.commandLine.appendSwitch('ozone-platform', 'x11')

// Chromium's DirectComposition surface can paint over mpv's `--wid` child
// window on Windows, so the transparent-window setup disables Chromium
// acceleration there. Linux needs Chromium's accelerated X11 compositor to
// display the transparent Electron surface, so leave it enabled.
if (process.platform === 'win32') app.disableHardwareAcceleration()

// Log instead of Electron's modal "JavaScript error in the main process" dialog;
// a stray failure (e.g. a transient disk error) must not take the player down.
process.on('uncaughtException', (error) => {
  console.error('[kizuna] uncaught exception in main process', error)
})
process.on('unhandledRejection', (reason) => {
  console.error('[kizuna] unhandled rejection in main process', reason)
})

// Off unless `KIZUNA_STARTUP_PROBE=1`, which the packaged Linux smoke test
// sets. When on, the app reports its startup milestones on stdout and quits
// itself as soon as all three land — so the smoke test asserts on a real
// launch rather than on a timer.
const startupProbe = createStartupProbe({
  enabled: process.env[STARTUP_PROBE_ENV] === '1',
  log: (line) => console.log(line),
  ready: () => {
    process.exitCode = 0
    app.quit()
  }
})

/** Everything `bootstrap()` creates, in creation order. */
interface AppRuntime {
  settings: SettingsStore
  updates: UpdateService
  mediaHistory: MediaHistoryService
  jimaku: JimakuService
  mpvConfig: MpvConfigManager
  window: WindowRuntime
}

// One controller for the app's lifetime; started/stopped alongside the
// (currently single) main window.
const controller = new MpvController()
const mainWindow: MainWindowRef = { current: undefined }
const sendToMain: SendToMain = (channel, value) => sendToWindow(mainWindow.current, channel, value)
// Set once by `bootstrap()` inside `whenReady`; Electron lifecycle handlers
// registered earlier read it optionally.
let runtime: AppRuntime | undefined

const gotSingleInstanceLock = app.requestSingleInstanceLock()
const launchPathBuffer = createLaunchPathBuffer(
  (path) => sendToMain(LAUNCH_CHANNELS.openPath, path),
  (message) => sendToMain(LAUNCH_CHANNELS.error, message)
)

/**
 * Builds the main-process runtime in dependency order: shared paths and
 * stores, the updater (before the window, which it later reveals), the
 * per-feature IPC bridges, and finally the window with its player and Game OCR.
 */
function bootstrap(lifecycle: AppLifecycleCoordinator, hasLaunchPath: boolean): AppRuntime {
  const paths = resolveAppPaths({
    userData: app.getPath('userData'),
    temp: app.getPath('temp'),
    pictures: app.getPath('pictures'),
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appRoot: app.getAppPath(),
    mainDir: __dirname
  })
  const binaryPaths = resolveBinaryPaths({
    isPackaged: paths.isPackaged,
    resourcesPath: paths.resourcesPath,
    appRoot: paths.appRoot
  })
  const userUnidic = createUserUnidicManager({ userDataDir: paths.userData, fs, shell })
  // Read history before any settings write can drop the legacy key.
  const historyStore = createAppMediaHistoryStore(paths)
  const settings = createSettingsStore(createSettingsFile(paths.settingsFile, fs))
  const deps: BootstrapDeps = {
    ipcMain,
    settings,
    secrets: createSafeStorageCodec(safeStorage),
    paths,
    sendToMain
  }
  const decision = resolveStartupDecision({
    startupBehavior: settings.get().player.startupBehavior,
    hasLaunchPath,
    supportsGameOcr: process.platform === 'win32',
    probe: process.env[STARTUP_PROBE_ENV] === '1'
  })
  const getVersion = (): string => app.getVersion()

  const updates = startUpdates({
    ...deps,
    mainWindow,
    lifecycle,
    getVersion,
    revealForUpdate: () => void runtime?.window.gameOcr?.lifecycle.revealForUpdate()
  })
  const mediaHistory = startMediaHistory({ ipcMain, paths, store: historyStore })
  startMedia({ ipcMain, paths, binaryPaths, mediaHistory })
  startMecab({ ...deps, binaryPaths, userUnidic })
  startDict(deps)
  startAnki({ ...deps, ffmpegPath: binaryPaths.ffmpegPath })
  startKnowledge(deps)
  startTranslation(deps)
  const jimaku = startJimaku({ ...deps, mediaHistory, shell })
  const mpvConfig = startPlayerSettings({ ...deps, shell })
  startAppInfo({ ipcMain, paths, binaryPaths, shell, getVersion })
  registerClipboardBridge(ipcMain, clipboard)
  const window = createWindow({
    ...deps,
    mainWindow,
    controller,
    mpvConfig,
    mpvPath: binaryPaths.mpvPath,
    mediaHistory,
    decision,
    launchPathBuffer,
    startupProbe,
    quit: () => app.quit()
  })
  return { settings, updates, mediaHistory, jimaku, mpvConfig, window }
}

if (!gotSingleInstanceLock) {
  app.quit()
} else {
  const lifecycle = createAppLifecycleCoordinator({
    // Electron's defaultSession getter is unavailable until app is ready.
    // Keep the lookup lazy because this coordinator is registered during
    // module initialization, before the ready promise resolves.
    defaultSession: {
      flushStorageData: () => session.defaultSession.flushStorageData()
    },
    controller,
    stopGameOcr: async () => {
      await runtime?.window.gameOcr?.lifecycle.stop(false)
    },
    flushHistory: () => {
      // Retry a settings write that failed earlier (e.g. a locked settings.json).
      runtime?.settings.flush()
      return runtime?.mediaHistory.flush()
    },
    releasePowerSave: () => runtime?.window.player.releasePowerSave(),
    disposeSystemMedia: () => runtime?.window.player.disposeSystemMedia(),
    onShutdownStart: () => {
      runtime?.updates.beginShutdown()
    },
    appQuit: () => {
      runtime?.window.windows.close()
      app.quit()
    }
  })

  const initialLaunchPath = videoPathFromArgv(process.argv, process.cwd())
  if (initialLaunchPath) launchPathBuffer.setPath(initialLaunchPath)

  app.on('second-instance', (_event, argv, cwd) => {
    const gameOcrLifecycle = runtime?.window.gameOcr?.lifecycle
    const launchPath = videoPathFromArgv(argv, cwd)
    if (launchPath) {
      void (gameOcrLifecycle?.showFromSecondInstance(true) ?? runtime?.window.appShell.showPlayer())
      launchPathBuffer.setPath(launchPath)
    } else {
      void (gameOcrLifecycle?.showFromSecondInstance() ?? Promise.resolve())
    }
  })

  ipcMain.on(LAUNCH_CHANNELS.rendererReady, () => {
    launchPathBuffer.markReady()
    startupProbe.mark('renderer')
  })

  app.whenReady().then(() => {
    registerWindowControls<IpcMainEvent, IpcMainInvokeEvent>(
      ipcMain,
      (event) => {
        const senderWindow = BrowserWindow.fromWebContents(event.sender)
        return runtime?.window.windows.controlsFor(senderWindow) ?? null
      },
      screen,
      () => void runtime?.mediaHistory.flush()
    )
    runtime = bootstrap(lifecycle, initialLaunchPath !== undefined)
  })

  app.on('before-quit', lifecycle.handleBeforeQuit)
  app.on('will-quit', () => {
    runtime?.window.gameOcr?.lifecycle.dispose()
    runtime?.updates.dispose()
    runtime?.jimaku.dispose()
  })

  app.on('window-all-closed', () => {
    app.quit()
  })
}
