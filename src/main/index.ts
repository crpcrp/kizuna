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
import {
  applyNavigationGuards,
  applyReloadGuard,
  registerWindowControls,
  sendToWindow
} from './windowOptions'
import { LAUNCH_CHANNELS, WINDOW_CONTROL_CHANNELS } from '../shared/ipcChannels'
import { createQuitCoordinator } from './appLifecycle'
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
import { resolveBinaryPaths, type BinaryPaths } from './resourcePaths'
import { registerMecabBridge, createMecabService } from './mecabBridge'
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
import { registerUrlSubtitleBridge } from './urlSubtitleBridge'
import {
  createUrlSubtitleService,
  execYtdlp,
  type UrlSubtitleService
} from './services/urlSubtitles'
import { parseSrt } from './media/srtParser'
import { parseVtt } from './media/vttParser'
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
import {
  createAppWindowSet,
  loadRendererWindow,
  presentAppWindowSet,
  type AppWindowSet
} from './windowPair'

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

// One controller for the app's lifetime; started/stopped alongside the
// (currently single) main window.
const controller = new MpvController()
let mediaHistory: MediaHistoryService | undefined
let powerSave: ReturnType<typeof createPowerSaveController> | undefined
let systemMedia: ReturnType<typeof createSystemMediaController> | undefined
let mpvConfig: MpvConfigManager | undefined
let urlSubtitles: UrlSubtitleService | undefined
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
  ytdlpPath: string | undefined,
  history: MediaHistoryService,
  settings: SettingsStore
): void {
  const windows = createAppWindowSet({
    preloadPath: join(__dirname, '../preload/index.js')
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
  })

  // In `dev`, electron-vite serves the renderer over HTTP (with HMR).
  // In a packaged/built app, load the compiled HTML from disk.
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  // The coordinator listens to the canonical native window (the Linux host,
  // or the single Windows window), restores paired bounds after the native
  // transition, and deduplicates the renderer-facing notification.
  windows.onFullscreenChanged((fullscreen) => {
    sendToWindow(uiOverlay, WINDOW_CONTROL_CHANNELS.fullscreenChanged, fullscreen)
  })

  // Do not let renderer effects invoke player channels before their handlers
  // exist. The windows remain hidden during mpv's short socket startup; a
  // failed mpv start is caught inside startPlayer and still loads a usable UI.
  void startPlayer(videoHost, uiOverlay, mpvPath, ytdlpPath, history, settings).then(() => {
    if (uiOverlay.isDestroyed() || videoHost.isDestroyed()) return
    // Linux keeps both windows hidden until the renderer has finished its first
    // document load. Windows retains BrowserWindow's existing eager presentation.
    presentAppWindowSet(windows)
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
  ytdlpPath: string | undefined,
  windowId: bigint | string,
  settings: SettingsStore
): Promise<void> {
  const { mpvUserConfig, mpvExtraArgs } = settings.get().player
  return startMpvWithConfig({
    mpvPath,
    windowId,
    ytdlpPath,
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
  ytdlpPath: string | undefined,
  history: MediaHistoryService,
  settings: SettingsStore
): Promise<void> {
  try {
    const windowId = windowIdFromHandleBuffer(videoHost.getNativeWindowHandle())
    await startMpvForWindow(uiOverlay, mpvPath, ytdlpPath, windowId, settings)
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
      ytdlpPath !== undefined,
      frames
    )
    launchPathBuffer.markPlayerReady()
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
function startMecab(binaryPaths: BinaryPaths, settings: SettingsStore): void {
  const mecabService = createMecabService({
    mecabPath: binaryPaths.mecabPath,
    dictPaths: { ipadicDir: binaryPaths.ipadicDir, unidicDir: binaryPaths.unidicDir },
    exists: fs.existsSync,
    settings
  })
  registerMecabBridge(ipcMain, mecabService)
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
 * Registers the URL-subtitle IPC bridge: enumerate/acquire the
 * provided/auto subtitle tracks of the active extractor URL through the bundled
 * yt-dlp, into a main-owned cache dir below `userData`. yt-dlp only runs for
 * extractor-backed URLs when the binary exists; here we supply the real
 * node:fs/promises adapter — the service itself stays fully fakeable.
 */
function startUrlSubtitles(ytdlpPath: string | undefined): void {
  const cacheDir = join(app.getPath('userData'), 'url-subtitles')
  urlSubtitles = createUrlSubtitleService({
    ytdlpPath,
    cacheDir,
    exec: execYtdlp,
    fs: {
      mkdir: async (dir) => {
        await fs.promises.mkdir(dir, { recursive: true })
      },
      readdir: (dir) => fs.promises.readdir(dir),
      readFile: (path) => fs.promises.readFile(path, 'utf-8'),
      remove: (path) => fs.promises.rm(path, { recursive: true, force: true })
    },
    parse: (content, format) => (format === 'vtt' ? parseVtt(content) : parseSrt(content))
  })
  registerUrlSubtitleBridge(ipcMain, urlSubtitles)
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

if (!gotSingleInstanceLock) {
  app.quit()
} else {
  const handleBeforeQuit = createQuitCoordinator({
    // Electron's defaultSession getter is unavailable until app is ready.
    // Keep the lookup lazy because this coordinator is registered during
    // module initialization, before the ready promise resolves.
    defaultSession: {
      flushStorageData: () => session.defaultSession.flushStorageData()
    },
    controller,
    flushHistory: () => mediaHistory?.flush(),
    releasePowerSave: () => powerSave?.dispose(),
    disposeSystemMedia: () => systemMedia?.dispose(),
    cleanupUrlSubtitles: async () => {
      await urlSubtitles?.cleanup()
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

  ipcMain.on(LAUNCH_CHANNELS.rendererReady, () => launchPathBuffer.markReady())

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
    // Probe the bundled yt-dlp once at startup: only pass its path
    // to mpv's ytdl hook when the binary actually exists, so a dev checkout
    // without it doesn't hand mpv a dangling path.
    const ytdlpPath = fs.existsSync(binaryPaths.ytdlpPath) ? binaryPaths.ytdlpPath : undefined

    const settings = createAppSettingsStore()
    mpvConfig = createMpvConfigManager({
      userDataDir: app.getPath('userData'),
      fs,
      shell
    })
    mediaHistory = createMediaHistoryService({ settings })
    registerMediaHistoryBridge(ipcMain, mediaHistory)

    sweepThumbnails()
    startMedia(binaryPaths.ffprobePath, binaryPaths.ffmpegPath, mediaHistory)
    startMecab(binaryPaths, settings)
    startDict()
    startAnki(settings, binaryPaths.ffmpegPath)
    startKnowledge(settings)
    startPlayerSettings(settings, mpvConfig)
    startIntegrationStatus(binaryPaths)
    registerClipboardBridge(ipcMain, clipboard)
    registerTranslateBridge(ipcMain, createGoogleTranslator(httpFetch))
    startUrlSubtitles(ytdlpPath)

    createWindow(binaryPaths.mpvPath, ytdlpPath, mediaHistory, settings)

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
        createWindow(binaryPaths.mpvPath, ytdlpPath, mediaHistory, settings)
    })
  })

  app.on('before-quit', handleBeforeQuit)

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
