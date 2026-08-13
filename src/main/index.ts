import {
  app,
  BrowserWindow,
  clipboard,
  globalShortcut,
  ipcMain,
  nativeImage,
  powerSaveBlocker,
  safeStorage,
  screen,
  session,
  shell,
  type IpcMainEvent,
  type IpcMainInvokeEvent
} from 'electron'
import { join } from 'node:path'
import * as fs from 'node:fs'
import { Worker } from 'node:worker_threads'
import Database from 'better-sqlite3'
import { autoUpdater } from 'electron-updater'
import packageMetadata from '../../package.json'
import {
  applyNavigationGuards,
  applyReloadGuard,
  registerWindowControls,
  sendToWindow
} from './windowOptions'
import { LAUNCH_CHANNELS, UPDATE_CHANNELS, WINDOW_CONTROL_CHANNELS } from '../shared/ipcChannels'
import { COPYRIGHT } from '../shared/appIdentity'
import { createAppLifecycleCoordinator, type AppLifecycleCoordinator } from './appLifecycle'
import { MpvController } from './mpv/controller'
import { registerPlayerBridge } from './playerBridge'
import { createPowerSaveController } from './services/powerSave'
import { createSystemMediaController } from './services/systemMedia'
import { createFrameCaptureService, createScreenshotService } from './services/screenshots'
import { sweepThumbnailCache, THUMBNAIL_CACHE_MAX_BYTES } from './services/thumbnails/cache'
import { nodeThumbnailDirFs } from './services/thumbnails/nodeFs'
import { windowIdFromHandleBuffer } from './mpv/nativeWindowHandle'
import { registerMediaBridge } from './mediaBridge'
import { createMediaService } from './mediaService'
import {
  missingResourceMessage,
  requiredGameOcrResources,
  resolveBinaryPaths,
  resolveGameOcrPaths,
  resolveThirdPartyNoticesPath,
  type BinaryPaths
} from './resourcePaths'
import { createAppInfoService, registerAppInfoBridge } from './appInfoBridge'
import { registerMecabBridge, createMecabService } from './mecabBridge'
import { isValidMecabDictionaryDir } from './services/mecab/dictionaryValidation'
import {
  createUserUnidicManager,
  migrateLegacyUnidic,
  type UserUnidicManager
} from './services/mecab/unidic'
import {
  registerDictBridge,
  createDictService,
  configureDictConnection,
  resolveImportWorkerPath
} from './dictBridge'
import { createWorkerImporter } from './services/dict/workerImporter'
import { registerAnkiBridge } from './ankiBridge'
import { createAnkiService } from './services/anki/service'
import { createSentenceAudioService } from './services/anki/sentenceAudio'
import { execFfmpeg } from './media/ffmpeg'
import { registerKnowledgeBridge, createKnowledgeService } from './knowledgeBridge'
import { initSchema } from './services/knowledge/schema'
import type { KnowledgeDb } from './services/knowledge/store'
import { registerPlayerSettingsBridge, createPlayerSettingsService } from './playerSettingsBridge'
import { registerIntegrationBridge, createIntegrationService } from './integrationBridge'
import { createMpvConfigManager, type MpvConfigManager } from './services/mpvConfig'
import { startMpvWithConfig } from './mpvStartup'
import { registerClipboardBridge } from './clipboardBridge'
import { httpFetch } from './services/http'
import { registerTranslateBridge } from './translateBridge'
import { createGoogleTranslator } from './services/translate/googleTranslate'
import { createSafeStorageCodec } from './services/secrets'
import { createSettingsStore, type SettingsStore } from './services/settings'
import { createSettingsFile } from './services/settingsFile'
import { createMediaHistoryService, type MediaHistoryService } from './services/mediaHistory'
import { registerMediaHistoryBridge } from './mediaHistoryBridge'
import { createLaunchPathBuffer, videoPathFromArgv } from './launchArgs'
import { applyAppIdentity, screenshotsDir } from './appIdentity'
import { createStartupProbe, STARTUP_PROBE_ENV } from './startupProbe'
import {
  createAppWindowSet,
  loadRendererWindow,
  presentAppWindowSet,
  type AppWindowSet
} from './windowPair'
import { createElectronUpdaterAdapter } from './electronUpdaterAdapter'
import { registerUpdateBridge } from './updateBridge'
import { createUpdateService, type UpdateService } from './updateService'
import { detectUpdateSupport } from './updateSupport'
import { createGameOcrController, writeGameOcrTotalTime } from './services/gameOcr/controller'
import { createProductionDisplaySources } from './services/gameOcr/displayCapture'
import { createGameOcrCaptureTargets } from './services/gameOcr/captureTarget'
import { createProductionForegroundWindowSource } from './services/gameOcr/foregroundWindow'
import { createGameOcrWindow } from './services/gameOcr/frozenFrameElectron'
import { createPpOcrWorkerService } from './services/ocr/ppOcrWorker'
import { resolveDetectionSideLength } from './services/ocr/ppOcrProtocol'
import { createGameOcrRuntimeService, type GameOcrRuntimeService } from './services/gameOcr/runtime'
import {
  createGameOcrBackgroundLifecycle,
  type GameOcrBackgroundLifecycle
} from './services/gameOcr/backgroundLifecycle'
import { createElectronGameOcrTrayFactory } from './services/gameOcr/tray'
import { registerGameOcrBridge } from './gameOcrBridge'

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

// One controller for the app's lifetime; started/stopped alongside the
// (currently single) main window.
const controller = new MpvController()
let mediaHistory: MediaHistoryService | undefined
let powerSave: ReturnType<typeof createPowerSaveController> | undefined
let systemMedia: ReturnType<typeof createSystemMediaController> | undefined
let mpvConfig: MpvConfigManager | undefined
let updates: UpdateService | undefined
let gameOcr: GameOcrRuntimeService | undefined
let gameOcrLifecycle: GameOcrBackgroundLifecycle | undefined
// The renderer-owning window. On Linux this is the transparent child overlay;
// the opaque video host is kept separate and is passed only to mpv.
let mainWindow: BrowserWindow | undefined
let appWindows: AppWindowSet | undefined
const gotSingleInstanceLock = app.requestSingleInstanceLock()
const launchPathBuffer = createLaunchPathBuffer(
  (path) => {
    sendToWindow(mainWindow, LAUNCH_CHANNELS.openPath, path)
  },
  (message) => {
    sendToWindow(mainWindow, LAUNCH_CHANNELS.error, message)
  }
)

function createWindow(
  mpvPath: string,
  history: MediaHistoryService,
  settings: SettingsStore
): void {
  const windows = createAppWindowSet({
    preloadPath: join(__dirname, '../preload/index.js'),
    closeGuard: (event) => gameOcrLifecycle?.handleWindowClose(event) ?? true
  })
  const { videoHost, uiOverlay } = windows
  appWindows = windows
  mainWindow = uiOverlay
  // Keep the renderer pinned to its bundled origin: deny off-page navigation and
  // refuse child-window creation (Electron security checklist #12/#13).
  applyNavigationGuards(uiOverlay.webContents)
  // Ctrl/Cmd+R is Chromium's built-in reload shortcut; it would otherwise
  // wipe the current session with no warning (see applyReloadGuard's doc).
  applyReloadGuard(uiOverlay.webContents)
  uiOverlay.on('closed', () => {
    if (mainWindow === uiOverlay) mainWindow = undefined
    gameOcrLifecycle?.handleWindowLost()
  })
  uiOverlay.webContents.on('render-process-gone', () => gameOcrLifecycle?.handleWindowLost())

  // In `dev`, electron-vite serves the renderer over HTTP (with HMR).
  // In a packaged/built app, load the compiled HTML from disk.
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  // The coordinator listens to the canonical native window (the Linux host,
  // or the single Windows window), restores paired bounds after the native
  // transition, and deduplicates the renderer-facing notification.
  windows.onFullscreenChanged((fullscreen) => {
    sendToWindow(uiOverlay, WINDOW_CONTROL_CHANNELS.fullscreenChanged, fullscreen)
  })

  // mpv's X11 --wid target must already be mapped while it initializes. Keep
  // only the opaque host visible during startup; the transparent renderer
  // overlay waits until the IPC bridge and renderer are ready.
  if (videoHost !== uiOverlay) videoHost.show()

  startGameOcr(settings, windows)

  // Do not let renderer effects invoke player channels before their handlers
  // exist. A failed mpv start is caught inside startPlayer and still loads a
  // usable UI over the opaque host.
  void startPlayer(videoHost, uiOverlay, mpvPath, history, settings).then(() => {
    if (uiOverlay.isDestroyed() || videoHost.isDestroyed()) return
    // Linux keeps the transparent overlay hidden until the renderer has
    // finished its first document load. Windows retains eager presentation.
    presentAppWindowSet(windows)
    startupProbe.mark('window')
    loadRendererWindow(uiOverlay, {
      devUrl,
      packagedHtmlPath: join(__dirname, '../renderer/index.html')
    })
  })
}

/**
 * Wires the singleton `controller`/`mpvConfig` and this window into the
 * testable `startMpvWithConfig` orchestrator (see `mpvStartup.ts`), which owns
 * the config-enabled → no-config-retry → banner decision.
 */
function startMpvForWindow(
  uiOverlay: BrowserWindow,
  mpvPath: string,
  windowId: bigint | string,
  settings: SettingsStore
): Promise<void> {
  const { mpvUserConfig, mpvExtraArgs } = settings.get().player
  return startMpvWithConfig({
    mpvPath,
    windowId,
    settings: { mpvUserConfig, mpvExtraArgs },
    configDir: mpvConfig?.configDir ?? '',
    ensureConfigDir: () => mpvConfig?.ensureDir(),
    start: (opts) => controller.start(opts),
    reportConfigError: (message) => {
      sendToWindow(uiOverlay, LAUNCH_CHANNELS.error, message)
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
  videoHost: BrowserWindow,
  uiOverlay: BrowserWindow
): ReturnType<typeof createSystemMediaController> {
  const resourcesBase = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
  const iconsDir = join(resourcesBase, 'icons')
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

/**
 * Starts mpv in `videoHost` and wires the IPC bridge to `uiOverlay` once it's up.
 *
 * The bridge is only registered after `controller.start()` resolves: it
 * eagerly calls observeTimePos/observeDuration, which send IPC over the
 * mpv socket — registering it before a live connection produces an
 * unhandled rejection. If mpv fails to start (e.g. binary missing), we log
 * and continue with the player bridge left unregistered; the rest of the
 * app must keep working without it.
 */
async function startPlayer(
  videoHost: BrowserWindow,
  uiOverlay: BrowserWindow,
  mpvPath: string,
  history: MediaHistoryService,
  settings: SettingsStore
): Promise<void> {
  try {
    const windowId = windowIdFromHandleBuffer(videoHost.getNativeWindowHandle())
    await startMpvForWindow(uiOverlay, mpvPath, windowId, settings)
    powerSave = createPowerSaveController(powerSaveBlocker)
    systemMedia = createSystemMediaForWindow(videoHost, uiOverlay)
    const screenshots = createScreenshotService({
      takeScreenshot: (path) => controller.screenshotToFile(path),
      folder: () =>
        settings.get().player.screenshotFolder ?? screenshotsDir(app.getPath('pictures')),
      exists: (path) => fs.existsSync(path),
      mkdir: (path) => {
        fs.mkdirSync(path, { recursive: true })
      }
    })
    const frames = createFrameCaptureService({
      takeScreenshot: (path) => controller.screenshotToFile(path),
      tempDir: () => app.getPath('temp'),
      readBase64: async (path) => (await fs.promises.readFile(path)).toString('base64'),
      remove: (path) => fs.promises.rm(path, { force: true })
    })
    registerPlayerBridge(
      ipcMain,
      controller,
      (channel, value) => {
        sendToWindow(uiOverlay, channel, value)
      },
      history,
      powerSave,
      screenshots,
      systemMedia,
      frames
    )
    launchPathBuffer.markPlayerReady()
    // Reached only after `controller.start()` resolved, which means mpv is
    // running and its IPC socket accepted a connection.
    startupProbe.mark('mpv')
  } catch (err) {
    console.warn('[kizuna] mpv not started:', err)
    // A file double-clicked to launch the app can never play now; surface a
    // banner instead of dropping it silently (the buffer only reports if a
    // launch path is actually queued).
    launchPathBuffer.markPlayerFailed()
  }
}

/**
 * Registers the media IPC bridge (open-file dialog, ffprobe track
 * enumeration, ffmpeg subtitle extraction).
 */
function startMedia(ffprobePath: string, ffmpegPath: string, history: MediaHistoryService): void {
  const mediaService = createMediaService({
    ffprobePath,
    ffmpegPath,
    tmpDir: app.getPath('temp'),
    mediaHistory: history,
    thumbnailCacheDir: join(app.getPath('userData'), 'thumbnails')
  })
  registerMediaBridge(ipcMain, mediaService)
}

/**
 * LRU-caps the seekbar-thumbnail cache at startup. The eviction policy lives in
 * services/thumbnails/cache.ts and the node:fs walk in
 * services/thumbnails/nodeFs.ts (which tolerates an absent cache dir on first
 * run); here we only name the directory and log the outcome.
 */
function sweepThumbnails(): void {
  const cacheDir = join(app.getPath('userData'), 'thumbnails')
  try {
    const removed = sweepThumbnailCache({
      cacheDir,
      maxBytes: THUMBNAIL_CACHE_MAX_BYTES,
      fs: nodeThumbnailDirFs
    })
    if (removed.length) console.log(`[kizuna] thumbnail cache: evicted ${removed.length} dir(s)`)
  } catch (err) {
    console.warn('[kizuna] thumbnail cache sweep failed:', err)
  }
}

/**
 * Constructs the settings store backed by a settings.json file in the user's
 * app-data directory. Hoisted out of `startMecab` so `startAnki` and
 * `startKnowledge` share the same store instance instead of each reading/
 * parsing settings.json independently.
 */
function createAppSettingsStore(): SettingsStore {
  const settingsPath = join(app.getPath('userData'), 'settings.json')
  return createSettingsStore(createSettingsFile(settingsPath, fs))
}

/**
 * Registers the mecab IPC bridge (tokenize/listDicts/selectDict).
 */
function startMecab(
  binaryPaths: BinaryPaths,
  settings: SettingsStore,
  userUnidic: UserUnidicManager
): void {
  const mecabService = createMecabService({
    mecabPath: binaryPaths.mecabPath,
    dictPaths: {
      ipadicDir: binaryPaths.ipadicDir,
      unidicDir: binaryPaths.unidicDir,
      userUnidicDir: userUnidic.dir
    },
    exists: fs.existsSync,
    isValid: (directory) => isValidMecabDictionaryDir(directory, fs, process.platform),
    settings
  })
  registerMecabBridge(ipcMain, mecabService, {
    openUserUnidicDir: () => userUnidic.open()
  })
}

/**
 * Preserves UniDic installed under the old package-managed resource path.
 * Windows NSIS runs an equivalent pre-uninstall copy before this code starts;
 * the startup path covers development and Linux package/AppImage transitions.
 * Migration failures are actionable diagnostics only: IPADIC remains usable.
 */
function migrateLegacyUnidicFromResources(
  binaryPaths: BinaryPaths,
  userUnidic: UserUnidicManager
): void {
  // Unpackaged Linux resolves the distro's shared UniDic path, not a legacy
  // Kizuna resource folder; never copy a system dictionary into app data.
  if (!app.isPackaged && process.platform === 'linux') return
  // Same guard the NSIS hook applies: only a compiled dictionary is worth
  // migrating. Copying an empty leftover folder would claim the persistent
  // target and block a later migration of a real one.
  if (!isValidMecabDictionaryDir(binaryPaths.unidicDir, fs, process.platform)) return

  const result = migrateLegacyUnidic({
    legacyDir: binaryPaths.unidicDir,
    targetDir: userUnidic.dir,
    fs,
    platform: process.platform
  })
  if (result.status === 'migrated') {
    console.log(`[kizuna] migrated legacy UniDic to ${result.target}`)
  } else if (result.status === 'failed') {
    console.warn(
      `[kizuna] could not migrate legacy UniDic from ${result.source} to ${result.target}: ${result.error}. ` +
        'Open Options > Parser & Dictionaries > Open UniDic folder to install it manually; IPADIC remains available.'
    )
  }
}

/**
 * Registers the dict IPC bridge (importDict/lookup/listDicts/setEnabled/
 * reorder), backed by a dict.db SQLite file in the user's app-data
 * directory. Imports run in a worker thread via
 * `createWorkerImporter`, which opens its own connection to the same file;
 * `configureDictConnection` sets this connection's pragmas (incremental
 * auto-vacuum, then WAL + a busy timeout so its reads don't block on — or get
 * blocked by — the worker's writes) and owns their order. Import progress is
 * pushed to the renderer-owning window; the Linux video host has no renderer.
 */
function startDict(): void {
  const dbPath = join(app.getPath('userData'), 'dict.db')
  const db = new Database(dbPath)
  configureDictConnection(db)
  const importer = createWorkerImporter({
    dbPath,
    workerPath: resolveImportWorkerPath(__dirname),
    createWorker: (workerPath, workerData) => new Worker(workerPath, { workerData })
  })
  const dictService = createDictService({ db, importer })
  registerDictBridge(ipcMain, dictService, (channel, value) => {
    sendToWindow(mainWindow, channel, value)
  })
}

/**
 * Registers the anki IPC bridge (ping/deckNames/modelNames/modelFieldNames/
 * addNote/getSettings/setSettings), backed by the shared settings store, the
 * global `fetch` boundary, and the bundled ffmpeg used to clip
 * sentence audio out of the loaded media file.
 */
function startAnki(settings: SettingsStore, ffmpegPath: string): void {
  const ankiService = createAnkiService({
    settings,
    fetch: httpFetch,
    // Sentence audio is clipped from the loaded file with the same bundled
    // ffmpeg and executor the media bridge uses.
    sentenceAudio: createSentenceAudioService({
      exec: execFfmpeg,
      ffmpegPath,
      tmpDir: () => app.getPath('temp'),
      fs: {
        readBase64: async (path) => (await fs.promises.readFile(path)).toString('base64'),
        remove: (path) => fs.promises.rm(path, { force: true })
      }
    })
  })
  registerAnkiBridge(ipcMain, ankiService)
}

/**
 * Registers the knowledge IPC bridge (levelsFor/sync/syncStatus/settings),
 * backed by a separate `knowledge.db` (kept apart from `dict.db` since they
 * have unrelated lifecycles) and the shared settings store. The WaniKani
 * token is encrypted via Electron's `safeStorage` (Windows DPAPI).
 * `syncIfStale()` runs once, fire-and-forget, so a stale cache colors
 * subtitles from a fresh sync without the user having to click "Sync now".
 */
function startKnowledge(settings: SettingsStore): void {
  const db = new Database(join(app.getPath('userData'), 'knowledge.db'))
  initSchema(db)
  const secrets = createSafeStorageCodec(safeStorage)
  const knowledgeService = createKnowledgeService({
    db: db as unknown as KnowledgeDb,
    settings,
    secrets,
    fetch: httpFetch
  })
  registerKnowledgeBridge(ipcMain, knowledgeService)
  void knowledgeService
    .syncIfStale()
    .catch((e) => console.error('[knowledge] startup sync failed', e))
}

/**
 * Registers the player-settings IPC bridge (getSettings/setSettings for the
 * Options menu's contents: keybindings, skip amount, popup/subtitle display),
 * backed by the shared settings store's `player` block.
 */
function startPlayerSettings(settings: SettingsStore, mpv: MpvConfigManager): void {
  const playerSettingsService = createPlayerSettingsService({
    settings,
    openMpvConfigDir: () => mpv.open()
  })
  registerPlayerSettingsBridge(ipcMain, playerSettingsService)
}

/** Reports what is on disk at a path without throwing on a missing entry. */
function probeResourceKind(path: string): 'file' | 'directory' | 'missing' {
  try {
    return fs.statSync(path).isDirectory() ? 'directory' : 'file'
  } catch {
    return 'missing'
  }
}

/**
 * Wires the Windows-only Game OCR runtime to the main-window bridge. The
 * PP-OCR ONNX payload is bundled by `win.extraResources`, so the paths resolve
 * against the same resources root as mpv and MeCab, and the runtime checks
 * them before each arm rather than trusting the installer.
 */
function startGameOcr(settings: SettingsStore, windows: AppWindowSet): void {
  if (process.platform !== 'win32') return

  const resourcesBase = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
  const ocrPaths = resolveGameOcrPaths({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appRoot: app.getAppPath(),
    platform: 'win32'
  })
  const worker = createPpOcrWorkerService({
    executablePath: ocrPaths.workerPath,
    // `--det-side-len` sets the detection tensor rather than capping it, so a
    // value larger than any capture upscales every one of them. The largest
    // display bounds what a capture can be, which leaves a fullscreen game
    // unscaled and stops a small window being blown up past one.
    detectionSideLength: resolveDetectionSideLength(
      screen
        .getAllDisplays()
        .flatMap((display) => [
          display.bounds.width * display.scaleFactor,
          display.bounds.height * display.scaleFactor
        ])
    ),
    modelPaths: {
      detection: ocrPaths.detectionModelPath,
      recognition: ocrPaths.recognitionModelPath,
      keys: ocrPaths.keysPath
    },
    onStateChange: (status) => gameOcr?.updateWorkerStatus(status)
  })
  const targets = createGameOcrCaptureTargets({
    foreground: createProductionForegroundWindowSource(process.platform),
    displays: createProductionDisplaySources(process.platform),
    screen
  })
  const controller = createGameOcrController({
    shortcut: globalShortcut,
    accelerator: settings.get().gameOcr.captureShortcut,
    targets,
    createPresentation: (bounds) =>
      createGameOcrWindow({
        platform: process.platform,
        preloadPath: join(__dirname, '../preload/index.js'),
        displayBounds: bounds,
        devUrl: process.env['ELECTRON_RENDERER_URL'],
        packagedHtmlPath: join(__dirname, '../renderer/gameOcr.html'),
        ipcMain,
        displayEvents: screen,
        traceInput: Boolean(process.env['KIZUNA_GAME_OCR_TIMING'])
      }),
    ocr: worker,
    onError: (message) => gameOcr?.reportError(message),
    // The renderer acknowledges a browser paint after React commits the word
    // boxes, so this is the complete delay the person at the shortcut feels.
    ...(!app.isPackaged
      ? {
          onTimings: writeGameOcrTotalTime,
          onDiagnostic: (message: string) => console.log(message)
        }
      : {})
  })
  const runtime = createGameOcrRuntimeService({
    settings,
    controller,
    worker,
    preflight: () => missingResourceMessage(requiredGameOcrResources(ocrPaths), probeResourceKind)
  })
  gameOcr = runtime
  gameOcrLifecycle = createGameOcrBackgroundLifecycle({
    runtime,
    window: {
      hide: () => windows.uiOverlay.hide(),
      activate: () => windows.activate()
    },
    tray: createElectronGameOcrTrayFactory(
      nativeImage.createFromPath(join(resourcesBase, 'icons', 'play.png'))
    ),
    quit: () => app.quit()
  })
  registerGameOcrBridge(
    ipcMain,
    runtime,
    (channel, value) => sendToWindow(mainWindow, channel, value),
    (sender) => sender === mainWindow?.webContents
  )
}

/**
 * Registers the integration-status IPC bridge: the read-only
 * "which optional bundled binaries are on disk" query behind the Options
 * dialog's "Setup & integrations" tab.
 */
function startIntegrationStatus(paths: BinaryPaths): void {
  registerIntegrationBridge(
    ipcMain,
    createIntegrationService({ paths, exists: (p) => fs.existsSync(p) })
  )
}

/** Registers the About-dialog bridge with runtime version and packaged notices. */
function startAppInfo(): void {
  const noticesPath = resolveThirdPartyNoticesPath({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appRoot: app.getAppPath()
  })
  registerAppInfoBridge(
    ipcMain,
    createAppInfoService({
      getVersion: () => app.getVersion(),
      metadata: {
        description: packageMetadata.description,
        license: packageMetadata.license,
        copyright: COPYRIGHT
      },
      noticesPath,
      exists: (path) => fs.existsSync(path),
      openExternal: (url) => shell.openExternal(url),
      openPath: (path) => shell.openPath(path)
    })
  )
}

/** Starts the single main-process updater and its renderer-owning IPC bridge. */
function startUpdates(lifecycle: AppLifecycleCoordinator, settings: SettingsStore): UpdateService {
  let packageType: string | undefined
  try {
    packageType = fs.readFileSync(join(process.resourcesPath, 'package-type'), 'utf8').trim()
  } catch {
    // AppImage and unpackaged builds do not have electron-builder's package marker.
  }
  const service = createUpdateService({
    support: detectUpdateSupport({
      isPackaged: app.isPackaged,
      platform: process.platform,
      appImagePath: process.env['APPIMAGE'],
      packageType,
      hasUpdateConfiguration: fs.existsSync(join(process.resourcesPath, 'app-update.yml'))
    }),
    currentVersion: app.getVersion(),
    updater: createElectronUpdaterAdapter(autoUpdater),
    prepareInstall: (install) => lifecycle.prepareForInstall(install),
    allowAutomaticChecks: process.env[STARTUP_PROBE_ENV] !== '1'
  })
  registerUpdateBridge(ipcMain, service, settings, (sender) => sender === mainWindow?.webContents)
  service.subscribe((state) => sendToWindow(mainWindow, UPDATE_CHANNELS.stateChanged, state))
  return service
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
      if (gameOcrLifecycle) await gameOcrLifecycle.stop()
      else await gameOcr?.stop()
    },
    flushHistory: () => mediaHistory?.flush(),
    releasePowerSave: () => powerSave?.dispose(),
    disposeSystemMedia: () => systemMedia?.dispose(),
    onShutdownStart: () => {
      updates?.beginShutdown()
    },
    appQuit: () => {
      appWindows?.close()
      app.quit()
    }
  })

  const initialLaunchPath = videoPathFromArgv(process.argv, process.cwd())
  if (initialLaunchPath) launchPathBuffer.setPath(initialLaunchPath)

  app.on('second-instance', (_event, argv, cwd) => {
    appWindows?.activate()
    const launchPath = videoPathFromArgv(argv, cwd)
    if (launchPath) launchPathBuffer.setPath(launchPath)
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
        return appWindows?.controlsFor(senderWindow) ?? null
      },
      screen,
      () => mediaHistory?.flush()
    )

    const binaryPaths = resolveBinaryPaths({
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      appRoot: app.getAppPath()
    })
    const userUnidic = createUserUnidicManager({
      userDataDir: app.getPath('userData'),
      fs,
      shell
    })
    migrateLegacyUnidicFromResources(binaryPaths, userUnidic)
    const settings = createAppSettingsStore()
    // Register once for the application lifetime. The overlay renderer starts
    // the optional startup check only after it has subscribed to state pushes.
    updates = startUpdates(lifecycle, settings)
    mpvConfig = createMpvConfigManager({
      userDataDir: app.getPath('userData'),
      fs,
      shell
    })
    mediaHistory = createMediaHistoryService({ settings })
    registerMediaHistoryBridge(ipcMain, mediaHistory)

    sweepThumbnails()
    startMedia(binaryPaths.ffprobePath, binaryPaths.ffmpegPath, mediaHistory)
    startMecab(binaryPaths, settings, userUnidic)
    startDict()
    startAnki(settings, binaryPaths.ffmpegPath)
    startKnowledge(settings)
    startPlayerSettings(settings, mpvConfig)
    startIntegrationStatus(binaryPaths)
    startAppInfo()
    registerClipboardBridge(ipcMain, clipboard)
    registerTranslateBridge(ipcMain, createGoogleTranslator(httpFetch))
    createWindow(binaryPaths.mpvPath, mediaHistory, settings)

    // macOS dock re-activation. This path is dead on Windows (the primary
    // target): `window-all-closed` quits the app there, so all windows are
    // never simultaneously closed while the process lives. It is left minimal
    // rather than fixed because re-opening a window here would re-enter
    // `startPlayer` with the singleton `MpvController`, whose `start` throws
    // "already started"; the catch would leave the new window bound to the old
    // bridge, whose `send` closure targets the destroyed window (pushes dropped
    // via the `isDestroyed` guard). A correct macOS revival needs a fresh
    // controller/bridge per window — out of scope until macOS is supported.
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0 && mediaHistory)
        createWindow(binaryPaths.mpvPath, mediaHistory, settings)
    })
  })

  app.on('before-quit', lifecycle.handleBeforeQuit)
  app.on('will-quit', () => {
    gameOcrLifecycle?.dispose()
    updates?.dispose()
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
