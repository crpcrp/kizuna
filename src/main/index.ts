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
  getMainWindowOptions,
  registerWindowControls,
  restorePreFullscreenBounds,
  sendToWindow
} from './windowOptions'
import { LAUNCH_CHANNELS, WINDOW_CONTROL_CHANNELS } from '../shared/ipcChannels'
import { handleBeforeQuit } from './appLifecycle'
import { MpvController } from './mpv/controller'
import { registerPlayerBridge } from './playerBridge'
import { createPowerSaveController } from './services/powerSave'
import { createSystemMediaController } from './services/systemMedia'
import { createFrameCaptureService, createScreenshotService } from './services/screenshots'
import { sweepThumbnailCache, THUMBNAIL_CACHE_MAX_BYTES } from './services/thumbnails'
import { hwndFromHandleBuffer } from './mpv/hwnd'
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
import { registerAnkiBridge, createAnkiService } from './ankiBridge'
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

// Must run before `ready` and before the first `app.getPath('userData')`:
// Electron resolves that path once, from the app name, and caches it.
applyAppIdentity(app)

// The spike's GO verdict was reached with hardware acceleration disabled
// (spike/main.ts): with Chromium's DirectComposition surface active, mpv's
// `--wid` child window can be painted over. Transparency is the primary fix;
// this ran alongside it for the whole spike, so we keep the validated combo.
// mpv does its own GPU rendering — Chromium only draws the lightweight UI.
// Must be called before app ready.
app.disableHardwareAcceleration()

// One controller for the app's lifetime; started/stopped alongside the
// (currently single) main window.
const controller = new MpvController()
let mediaHistory: MediaHistoryService | undefined
let powerSave: ReturnType<typeof createPowerSaveController> | undefined
let systemMedia: ReturnType<typeof createSystemMediaController> | undefined
let mpvConfig: MpvConfigManager | undefined
let urlSubtitles: UrlSubtitleService | undefined
let mainWindow: BrowserWindow | undefined
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
  const win = new BrowserWindow(getMainWindowOptions(join(__dirname, '../preload/index.js')))
  mainWindow = win
  // Keep the renderer pinned to its bundled origin: deny off-page navigation and
  // refuse child-window creation (Electron security checklist #12/#13).
  applyNavigationGuards(win.webContents)
  // Ctrl/Cmd+R is Chromium's built-in reload shortcut; it would otherwise
  // wipe the current session with no warning (see applyReloadGuard's doc).
  applyReloadGuard(win.webContents)
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = undefined
  })

  // In `dev`, electron-vite serves the renderer over HTTP (with HMR).
  // In a packaged/built app, load the compiled HTML from disk.
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    // A cold vite dev server occasionally isn't fully ready for the very
    // first request (e.g. still resolving its dependency pre-bundle); that
    // can surface as an outright load failure — a few retries with a short
    // delay cover that without masking a genuinely broken dev server (which
    // will keep failing after they're exhausted). electron.vite.config.ts's
    // optimizeDeps.include/server.warmup close the other half of this race
    // (a load that "succeeds" but renders blank because the module graph
    // wasn't actually ready yet).
    let attemptsLeft = 3
    win.webContents.on('did-fail-load', () => {
      if (attemptsLeft <= 0) return
      attemptsLeft -= 1
      setTimeout(() => win.loadURL(devUrl), 500)
    })
    win.loadURL(devUrl)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Push fullscreen transitions to the renderer so it can hide/reveal the
  // menu bar and bottom controls (see App.tsx). Both the window's own events
  // (F11, OS controls) and our IPC-driven toggles land here.
  win.on('enter-full-screen', () =>
    win.webContents.send(WINDOW_CONTROL_CHANNELS.fullscreenChanged, true)
  )
  win.on('leave-full-screen', () => {
    // Restore the window's pre-fullscreen size/position (captured in
    // windowOptions.ts's setFullscreen/toggleFullscreen handlers) only now,
    // after the OS has actually finished leaving fullscreen — doing it
    // earlier races the platform's own transition and can get overwritten.
    restorePreFullscreenBounds(win)
    win.webContents.send(WINDOW_CONTROL_CHANNELS.fullscreenChanged, false)
  })

  void startPlayer(win, mpvPath, ytdlpPath, history, settings)
}

/**
 * Wires the singleton `controller`/`mpvConfig` and this window into the
 * testable `startMpvWithConfig` orchestrator (see `mpvStartup.ts`), which owns
 * the config-enabled → no-config-retry → banner decision.
 */
function startMpvForWindow(
  win: BrowserWindow,
  mpvPath: string,
  ytdlpPath: string | undefined,
  hwnd: bigint | string,
  settings: SettingsStore
): Promise<void> {
  const { mpvUserConfig, mpvExtraArgs } = settings.get().player
  return startMpvWithConfig({
    mpvPath,
    hwnd,
    ytdlpPath,
    settings: { mpvUserConfig, mpvExtraArgs },
    configDir: mpvConfig?.configDir ?? '',
    ensureConfigDir: () => mpvConfig?.ensureDir(),
    start: (opts) => controller.start(opts),
    reportConfigError: (message) => {
      sendToWindow(win, LAUNCH_CHANNELS.error, message)
    },
    warn: (err) =>
      console.warn('[kizuna] mpv failed to start with user config; retrying without it:', err)
  })
}

/**
 * Builds the system-media controller (Feature 7) with the real Electron
 * surfaces for `win`: the app-global media-key shortcuts, this window's taskbar
 * progress bar, and — on Windows only — its thumbnail-toolbar buttons (the API
 * is a no-op elsewhere, so it's injected as an empty function off-Windows).
 * Media-key/thumbar activations are pushed to the renderer, which owns what each
 * command does. Icons are first-party PNGs under `resources/icons/`.
 */
function createSystemMediaForWindow(
  win: BrowserWindow
): ReturnType<typeof createSystemMediaController> {
  const resourcesBase = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
  const iconsDir = join(resourcesBase, 'icons')
  const icon = (name: string): Electron.NativeImage =>
    nativeImage.createFromPath(join(iconsDir, `${name}.png`))
  const isWindows = process.platform === 'win32'
  return createSystemMediaController({
    globalShortcut,
    setProgressBar: (progress, options) => {
      if (win.isDestroyed()) return
      if (options) win.setProgressBar(progress, options)
      else win.setProgressBar(progress)
    },
    setThumbarButtons: isWindows
      ? (buttons) => {
          if (win.isDestroyed()) return
          win.setThumbarButtons(
            buttons.map((b) => ({
              icon: b.icon as Electron.NativeImage,
              tooltip: b.tooltip,
              click: b.click
            }))
          )
        }
      : () => {},
    send: (channel, value) => {
      sendToWindow(win, channel, value)
    },
    icons: { prev: icon('prev'), play: icon('play'), pause: icon('pause'), next: icon('next') }
  })
}

/**
 * Starts mpv embedded into `win` and wires the IPC bridge once it's up.
 *
 * The bridge is only registered after `controller.start()` resolves: it
 * eagerly calls observeTimePos/observeDuration, which send IPC over the
 * mpv socket — registering it before a live connection produces an
 * unhandled rejection. If mpv fails to start (e.g. binary missing), we log
 * and continue with the player bridge left unregistered; the rest of the
 * app must keep working without it.
 */
async function startPlayer(
  win: BrowserWindow,
  mpvPath: string,
  ytdlpPath: string | undefined,
  history: MediaHistoryService,
  settings: SettingsStore
): Promise<void> {
  try {
    const hwnd = hwndFromHandleBuffer(win.getNativeWindowHandle())
    await startMpvForWindow(win, mpvPath, ytdlpPath, hwnd, settings)
    powerSave = createPowerSaveController(powerSaveBlocker)
    systemMedia = createSystemMediaForWindow(win)
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
        sendToWindow(win, channel, value)
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
 * Feature 10 slice 2 — LRU-caps the seekbar-thumbnail cache at startup. The
 * pure eviction lives in services/thumbnails.ts; here we supply the real
 * node:fs directory walk, tolerating an absent cache dir (first run) by
 * treating a missing/unreadable listing as empty.
 */
function sweepThumbnails(): void {
  const cacheDir = join(app.getPath('userData'), 'thumbnails')
  try {
    const removed = sweepThumbnailCache({
      cacheDir,
      maxBytes: THUMBNAIL_CACHE_MAX_BYTES,
      fs: {
        readSubdirs: (dir) => {
          try {
            return fs
              .readdirSync(dir, { withFileTypes: true })
              .filter((e) => e.isDirectory())
              .map((e) => e.name)
          } catch {
            return []
          }
        },
        readFiles: (dir) => {
          try {
            return fs
              .readdirSync(dir, { withFileTypes: true })
              .filter((e) => e.isFile())
              .map((e) => e.name)
          } catch {
            return []
          }
        },
        stat: (path) => {
          const s = fs.statSync(path)
          return { size: s.size, mtimeMs: s.mtimeMs }
        },
        remove: (path) => fs.rmSync(path, { recursive: true, force: true })
      }
    })
    if (removed.length) console.log(`[kizuna] thumbnail cache: evicted ${removed.length} dir(s)`)
  } catch (err) {
    console.warn('[kizuna] thumbnail cache sweep failed:', err)
  }
}

/**
 * Constructs the settings store backed by a settings.json file in the user's
 * app-data directory. Hoisted out of `startMecab` (Phase 3 · G4) so Phase 3's
 * `startAnki`/`startKnowledge` share the same store instance instead of each
 * reading/parsing settings.json independently.
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
 * directory. Imports run in a worker thread (Priority 8) via
 * `createWorkerImporter`, which opens its own connection to the same file;
 * `configureDictConnection` sets this connection's pragmas (incremental
 * auto-vacuum, then WAL + a busy timeout so its reads don't block on — or get
 * blocked by — the worker's writes) and owns their order. Import progress is
 * pushed to every live window (this app has just the one, but a broadcast is simpler
 * than threading the triggering window's id through the worker round-trip).
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
    for (const win of BrowserWindow.getAllWindows()) {
      sendToWindow(win, channel, value)
    }
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
 * backed by a separate `knowledge.db` (kept apart from `dict.db` — see
 * docs/phase-3-plan.md "Databases") and the shared settings store. The
 * WaniKani token is encrypted via Electron's `safeStorage` (Windows DPAPI).
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
 * Registers the URL-subtitle IPC bridge (Feature 9): enumerate/acquire the
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
  const initialLaunchPath = videoPathFromArgv(process.argv, process.cwd())
  if (initialLaunchPath) launchPathBuffer.setPath(initialLaunchPath)

  app.on('second-instance', (_event, argv, cwd) => {
    const win = mainWindow
    if (win && !win.isDestroyed()) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
    const launchPath = videoPathFromArgv(argv, cwd)
    if (launchPath) launchPathBuffer.setPath(launchPath)
  })

  ipcMain.on(LAUNCH_CHANNELS.rendererReady, () => launchPathBuffer.markReady())

  app.whenReady().then(() => {
    registerWindowControls<IpcMainEvent, IpcMainInvokeEvent>(
      ipcMain,
      (event) => BrowserWindow.fromWebContents(event.sender),
      screen,
      () => mediaHistory?.flush()
    )

    const binaryPaths = resolveBinaryPaths({
      isPackaged: app.isPackaged,
      resourcesPath: process.resourcesPath,
      appRoot: app.getAppPath()
    })
    // Probe the bundled yt-dlp once at startup (Feature 9): only pass its path
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

  app.on('before-quit', () => {
    handleBeforeQuit(
      session.defaultSession,
      controller,
      () => mediaHistory?.flush(),
      () => powerSave?.dispose(),
      () => systemMedia?.dispose(),
      () => {
        void urlSubtitles?.cleanup()
      }
    )
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
