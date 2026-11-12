// Preload bridge: the renderer's only path to main. Typed, minimal surface —
// contextIsolation is on and nodeIntegration is off (see windowOptions.ts).
import { contextBridge, ipcRenderer, webUtils } from 'electron'
import {
  ANKI_CHANNELS,
  APP_INFO_CHANNELS,
  APP_SHELL_CHANNELS,
  CLIPBOARD_CHANNELS,
  DICT_CHANNELS,
  GAME_OCR_CHANNELS,
  INTEGRATION_CHANNELS,
  JIMAKU_CHANNELS,
  KNOWLEDGE_CHANNELS,
  LAUNCH_CHANNELS,
  MECAB_CHANNELS,
  MEDIA_CHANNELS,
  MEDIA_HISTORY_CHANNELS,
  PLAYER_CHANNELS,
  PLAYER_SETTINGS_CHANNELS,
  TRANSLATE_CHANNELS,
  UPDATE_CHANNELS,
  WINDOW_CONTROL_CHANNELS
} from '../shared/ipcChannels'
import type { KizunaApi } from '../shared/preloadApi'
import type { WindowShapeRect } from '../shared/windowShape'
import { subscribe } from './bridge'

/**
 * The Linux-only `setShape` half of `windowControls`. Shaping applies to the
 * X11 renderer overlay of the two-window pair (see `windowPair.ts`); Windows
 * runs a single embedded window and must not expose the method at all, so the
 * renderer's optional-method check (`useLinuxWindowShape`) stays the one gate.
 *
 * Split out as a pure function with an explicit `platform` so both variants are
 * asserted on either host — reading `process.platform` inline left the Windows
 * shape untested on a Linux runner and vice versa.
 */
export function windowShapeApi(
  setShape: (rects: WindowShapeRect[]) => void,
  platform: NodeJS.Platform = process.platform
): { setShape?(rects: WindowShapeRect[]): void } {
  return platform === 'linux' ? { setShape } : {}
}

const api = {
  // The frameless window has no OS buttons; custom chrome calls these.
  windowControls: {
    minimize: () => ipcRenderer.send(WINDOW_CONTROL_CHANNELS.minimize),
    close: () => ipcRenderer.send(WINDOW_CONTROL_CHANNELS.close),
    setFullscreen: (flag) => ipcRenderer.send(WINDOW_CONTROL_CHANNELS.setFullscreen, flag),
    toggleFullscreen: () => ipcRenderer.send(WINDOW_CONTROL_CHANNELS.toggleFullscreen),
    onFullscreenChange: (cb) => subscribe(WINDOW_CONTROL_CHANNELS.fullscreenChanged, cb),
    setSize: (width, height) => ipcRenderer.send(WINDOW_CONTROL_CHANNELS.setSize, width, height),
    setAlwaysOnTop: (flag) => ipcRenderer.send(WINDOW_CONTROL_CHANNELS.setAlwaysOnTop, flag),
    ...windowShapeApi((rects) => ipcRenderer.send(WINDOW_CONTROL_CHANNELS.setShape, rects)),
    getBounds: () => ipcRenderer.invoke(WINDOW_CONTROL_CHANNELS.getBounds),
    setBounds: (request) => ipcRenderer.invoke(WINDOW_CONTROL_CHANNELS.setBounds, request)
  },
  // mpv playback bridge: commands invoke main's ipcMain.handle channels;
  // subscriptions listen for main's property-observer pushes and return an
  // unsubscribe function so callers can clean up (e.g. on unmount).
  player: {
    load: (path) => ipcRenderer.invoke(PLAYER_CHANNELS.load, path),
    setPause: (paused) => ipcRenderer.invoke(PLAYER_CHANNELS.setPause, paused),
    seek: (seconds, absolute) => ipcRenderer.invoke(PLAYER_CHANNELS.seek, seconds, absolute),
    setVolume: (volume) => ipcRenderer.invoke(PLAYER_CHANNELS.setVolume, volume),
    setSpeed: (speed) => ipcRenderer.invoke(PLAYER_CHANNELS.setSpeed, speed),
    setMuted: (muted) => ipcRenderer.invoke(PLAYER_CHANNELS.setMuted, muted),
    setAudioDelay: (delayMs) => ipcRenderer.invoke(PLAYER_CHANNELS.setAudioDelay, delayMs),
    setAudioTrack: (aid) => ipcRenderer.invoke(PLAYER_CHANNELS.setAudioTrack, aid),
    getAudioDevices: () => ipcRenderer.invoke(PLAYER_CHANNELS.getAudioDevices),
    setAudioDevice: (name) => ipcRenderer.invoke(PLAYER_CHANNELS.setAudioDevice, name),
    setLoudnessNorm: (on) => ipcRenderer.invoke(PLAYER_CHANNELS.setLoudnessNorm, on),
    setAbLoop: (a, b) => ipcRenderer.invoke(PLAYER_CHANNELS.setAbLoop, a, b),
    setVideoMargins: (top, bottom, right, left) =>
      ipcRenderer.invoke(PLAYER_CHANNELS.setVideoMargins, top, bottom, right, left),
    setVideoAdjustments: (adjustments) =>
      ipcRenderer.invoke(PLAYER_CHANNELS.setVideoAdjustments, adjustments),
    frameStep: () => ipcRenderer.invoke(PLAYER_CHANNELS.frameStep),
    frameBackStep: () => ipcRenderer.invoke(PLAYER_CHANNELS.frameBackStep),
    screenshot: (mediaPath, timePos) =>
      ipcRenderer.invoke(PLAYER_CHANNELS.screenshot, mediaPath, timePos),
    captureFrame: () => ipcRenderer.invoke(PLAYER_CHANNELS.captureFrame),
    onTimePos: (cb) => subscribe(PLAYER_CHANNELS.timePos, cb),
    onDuration: (cb) => subscribe(PLAYER_CHANNELS.duration, cb),
    onEofReached: (cb) => subscribe(PLAYER_CHANNELS.eofReached, cb),
    onPause: (cb) => subscribe(PLAYER_CHANNELS.pause, cb),
    onMediaKey: (cb) => subscribe(PLAYER_CHANNELS.mediaKey, cb)
  },
  launch: {
    onOpenPath: (cb) => subscribe(LAUNCH_CHANNELS.openPath, cb),
    onError: (cb) => subscribe(LAUNCH_CHANNELS.error, cb),
    rendererReady: () => ipcRenderer.send(LAUNCH_CHANNELS.rendererReady)
  },

  appShell: {
    getSurface: () => ipcRenderer.invoke(APP_SHELL_CHANNELS.getSurface),
    showSplash: () => ipcRenderer.invoke(APP_SHELL_CHANNELS.showSplash),
    showPlayer: () => ipcRenderer.invoke(APP_SHELL_CHANNELS.showPlayer),
    showOptions: () => ipcRenderer.invoke(APP_SHELL_CHANNELS.showOptions),
    dismissOptions: () => ipcRenderer.invoke(APP_SHELL_CHANNELS.dismissOptions),
    quit: () => ipcRenderer.send(APP_SHELL_CHANNELS.quit),
    onSurfaceChanged: (cb) => subscribe(APP_SHELL_CHANNELS.surfaceChanged, cb)
  },

  gameOcr: {
    supported: process.platform === 'win32',
    getSettings: () => ipcRenderer.invoke(GAME_OCR_CHANNELS.getSettings),
    setSettings: (patch) => ipcRenderer.invoke(GAME_OCR_CHANNELS.setSettings, patch),
    getStatus: () => ipcRenderer.invoke(GAME_OCR_CHANNELS.getStatus),
    start: () => ipcRenderer.invoke(GAME_OCR_CHANNELS.start),
    stop: () => ipcRenderer.invoke(GAME_OCR_CHANNELS.stop),
    retry: () => ipcRenderer.invoke(GAME_OCR_CHANNELS.retry),
    onStatusChange: (cb) => subscribe(GAME_OCR_CHANNELS.statusChanged, cb),
    onFreeze: (cb) => subscribe(GAME_OCR_CHANNELS.freeze, cb),
    frozen: (value) => ipcRenderer.send(GAME_OCR_CHANNELS.frozen, value),
    captureBytes: (value) => ipcRenderer.send(GAME_OCR_CHANNELS.captureBytes, value),
    onDiscard: (cb) => subscribe(GAME_OCR_CHANNELS.discard, cb),
    onRecognitionState: (cb) => subscribe(GAME_OCR_CHANNELS.recognitionState, cb),
    onRegions: (cb) => subscribe(GAME_OCR_CHANNELS.regions, cb),
    onCopySelection: (cb) => subscribe(GAME_OCR_CHANNELS.copySelection, cb),
    rendererReady: () => ipcRenderer.send(GAME_OCR_CHANNELS.rendererReady),
    close: () => ipcRenderer.send(GAME_OCR_CHANNELS.close)
  },

  // Media bridge: file-selection, ffprobe track enumeration, and ffmpeg
  // subtitle-loading — all renderer→main invoke/handle round-trips.
  media: {
    openFile: () => ipcRenderer.invoke(MEDIA_CHANNELS.openFile),
    openFiles: () => ipcRenderer.invoke(MEDIA_CHANNELS.openFiles),
    openFolder: () => ipcRenderer.invoke(MEDIA_CHANNELS.openFolder),
    readPlaylist: (filePath) => ipcRenderer.invoke(MEDIA_CHANNELS.readPlaylist, filePath),
    savePlaylist: (paths) => ipcRenderer.invoke(MEDIA_CHANNELS.savePlaylist, paths),
    openSubtitleFile: () => ipcRenderer.invoke(MEDIA_CHANNELS.openSubtitleFile),
    enumerateTracks: (filePath) => ipcRenderer.invoke(MEDIA_CHANNELS.enumerateTracks, filePath),
    loadSubtitle: (filePath, streamIndex) =>
      ipcRenderer.invoke(MEDIA_CHANNELS.loadSubtitle, filePath, streamIndex),
    loadExternalSubtitle: (subtitlePath, encoding = 'auto') =>
      ipcRenderer.invoke(MEDIA_CHANNELS.loadExternalSubtitle, subtitlePath, encoding),
    getVideoDimensions: (filePath) =>
      ipcRenderer.invoke(MEDIA_CHANNELS.getVideoDimensions, filePath),
    getChapters: (filePath) => ipcRenderer.invoke(MEDIA_CHANNELS.getChapters, filePath),
    folderNeighbors: (filePath) => ipcRenderer.invoke(MEDIA_CHANNELS.folderNeighbors, filePath),
    getThumbnail: (filePath, timeSec, durationSec) =>
      ipcRenderer.invoke(MEDIA_CHANNELS.thumbnail, filePath, timeSec, durationSec)
  },
  mediaHistory: {
    getRecentFiles: () => ipcRenderer.invoke(MEDIA_HISTORY_CHANNELS.getRecentFiles),
    getPlaybackHistory: (path) =>
      ipcRenderer.invoke(MEDIA_HISTORY_CHANNELS.getPlaybackHistory, path),
    removeRecentFile: (path) => ipcRenderer.invoke(MEDIA_HISTORY_CHANNELS.removeRecentFile, path),
    clearRecentFiles: () => ipcRenderer.invoke(MEDIA_HISTORY_CHANNELS.clearRecentFiles),
    checkFileAvailability: (path) =>
      ipcRenderer.invoke(MEDIA_HISTORY_CHANNELS.checkFileAvailability, path),
    setAudioTrack: (path, track) =>
      ipcRenderer.invoke(MEDIA_HISTORY_CHANNELS.setAudioTrack, path, track),
    setSubtitleTrack: (path, selection) =>
      ipcRenderer.invoke(MEDIA_HISTORY_CHANNELS.setSubtitleTrack, path, selection),
    setSubtitleVersionOffset: (path, contentVersion, offsetMs) =>
      ipcRenderer.invoke(
        MEDIA_HISTORY_CHANNELS.setSubtitleVersionOffset,
        path,
        contentVersion,
        offsetMs
      )
  },
  mecab: {
    tokenize: (text) => ipcRenderer.invoke(MECAB_CHANNELS.tokenize, text),
    tokenizeBatch: (texts) => ipcRenderer.invoke(MECAB_CHANNELS.tokenizeBatch, texts),
    listDicts: () => ipcRenderer.invoke(MECAB_CHANNELS.listDicts),
    selectDict: (id) => ipcRenderer.invoke(MECAB_CHANNELS.selectDict, id),
    currentDict: () => ipcRenderer.invoke(MECAB_CHANNELS.currentDict),
    openUserUnidicDir: () => ipcRenderer.invoke(MECAB_CHANNELS.openUserUnidicDir)
  },
  // Yomitan dictionary bridge: import a dictionary zip by its on-disk path
  // (main reads the file, so the archive never crosses IPC), look up a term, and manage the
  // installed dictionaries (list/enable/reorder/remove).
  dict: {
    importDictFile: (zipPath) => ipcRenderer.invoke(DICT_CHANNELS.importDictFile, zipPath),
    lookup: (lemma, reading, freqDictId, sortMode, longestMatchCandidates, surface) =>
      ipcRenderer.invoke(
        DICT_CHANNELS.lookup,
        lemma,
        reading,
        freqDictId,
        sortMode,
        longestMatchCandidates,
        surface
      ),
    listDicts: () => ipcRenderer.invoke(DICT_CHANNELS.listDicts),
    setEnabled: (id, enabled) => ipcRenderer.invoke(DICT_CHANNELS.setEnabled, id, enabled),
    setFallbackOnly: (id, fallbackOnly) =>
      ipcRenderer.invoke(DICT_CHANNELS.setFallbackOnly, id, fallbackOnly),
    reorder: (orderedIds) => ipcRenderer.invoke(DICT_CHANNELS.reorder, orderedIds),
    removeDict: (id) => ipcRenderer.invoke(DICT_CHANNELS.remove, id),
    onImportProgress: (cb) => subscribe(DICT_CHANNELS.importProgress, cb)
  },
  // AnkiConnect bridge: test the connection, populate Options selects from
  // the running Anki (decks/models/fields), add a note from the WordPopup,
  // and read/write the `anki` settings block.
  anki: {
    ping: () => ipcRenderer.invoke(ANKI_CHANNELS.ping),
    deckNames: () => ipcRenderer.invoke(ANKI_CHANNELS.deckNames),
    modelNames: () => ipcRenderer.invoke(ANKI_CHANNELS.modelNames),
    modelFieldNames: (modelName) => ipcRenderer.invoke(ANKI_CHANNELS.modelFieldNames, modelName),
    setupJlptField: () => ipcRenderer.invoke(ANKI_CHANNELS.setupJlptField),
    previewJlptBackfill: () => ipcRenderer.invoke(ANKI_CHANNELS.previewJlptBackfill),
    applyJlptBackfill: (request) => ipcRenderer.invoke(ANKI_CHANNELS.applyJlptBackfill, request),
    onJlptBackfillProgress: (cb) => subscribe(ANKI_CHANNELS.jlptBackfillProgress, cb),
    addNote: (req) => ipcRenderer.invoke(ANKI_CHANNELS.addNote, req),
    findExisting: (token, word) => ipcRenderer.invoke(ANKI_CHANNELS.findExisting, token, word),
    findTargetDeckMembership: (expressions) =>
      ipcRenderer.invoke(ANKI_CHANNELS.findTargetDeckMembership, expressions),
    openCard: (cardId) => ipcRenderer.invoke(ANKI_CHANNELS.openCard, cardId),
    getSettings: () => ipcRenderer.invoke(ANKI_CHANNELS.getSettings),
    setSettings: (patch) => ipcRenderer.invoke(ANKI_CHANNELS.setSettings, patch)
  },
  // Knowledge bridge: query known-word levels for subtitle coloring, trigger
  // a WaniKani/Anki sync, read sync status, and read/write the `knowledge`
  // settings block (WaniKani token stays encrypted server-side).
  knowledge: {
    levelsFor: (lemmas) => ipcRenderer.invoke(KNOWLEDGE_CHANNELS.levelsFor, lemmas),
    detailsFor: (lemmas) => ipcRenderer.invoke(KNOWLEDGE_CHANNELS.detailsFor, lemmas),
    jlptCoverageReport: () => ipcRenderer.invoke(KNOWLEDGE_CHANNELS.jlptCoverageReport),
    jlptUnknownItems: (request) => ipcRenderer.invoke(KNOWLEDGE_CHANNELS.jlptUnknownItems, request),
    sync: (source, opts) => ipcRenderer.invoke(KNOWLEDGE_CHANNELS.sync, source, opts),
    syncStatus: () => ipcRenderer.invoke(KNOWLEDGE_CHANNELS.syncStatus),
    getSettings: () => ipcRenderer.invoke(KNOWLEDGE_CHANNELS.getSettings),
    setSettings: (patch) => ipcRenderer.invoke(KNOWLEDGE_CHANNELS.setSettings, patch)
  },
  // Player-settings bridge: read/write the `player` settings block (the
  // Options menu's contents — keybindings, skip amount, popup/subtitle
  // display), persisted to settings.json instead of localStorage.
  playerSettings: {
    getSettings: () => ipcRenderer.invoke(PLAYER_SETTINGS_CHANNELS.getSettings),
    setSettings: (patch) => ipcRenderer.invoke(PLAYER_SETTINGS_CHANNELS.setSettings, patch),
    openMpvConfigDir: () => ipcRenderer.invoke(PLAYER_SETTINGS_CHANNELS.openMpvConfigDir)
  },
  // Integration-status bridge: read-only "is this bundled binary on disk?"
  // diagnostics for the Options dialog's "Setup & integrations" tab.
  integration: {
    binaryStatus: () => ipcRenderer.invoke(INTEGRATION_CHANNELS.binaryStatus)
  },
  appInfo: {
    get: () => ipcRenderer.invoke(APP_INFO_CHANNELS.get),
    openLink: (link) => ipcRenderer.invoke(APP_INFO_CHANNELS.openLink, link),
    openNotices: () => ipcRenderer.invoke(APP_INFO_CHANNELS.openNotices)
  },
  updates: {
    getState: () => ipcRenderer.invoke(UPDATE_CHANNELS.getState),
    getSettings: () => ipcRenderer.invoke(UPDATE_CHANNELS.getSettings),
    setSettings: (patch) => ipcRenderer.invoke(UPDATE_CHANNELS.setSettings, patch),
    check: (origin) => ipcRenderer.invoke(UPDATE_CHANNELS.check, origin),
    download: () => ipcRenderer.invoke(UPDATE_CHANNELS.download),
    install: () => ipcRenderer.invoke(UPDATE_CHANNELS.install),
    onStateChange: (cb) => subscribe(UPDATE_CHANNELS.stateChanged, cb)
  },
  clipboard: {
    writeText: (text) => ipcRenderer.invoke(CLIPBOARD_CHANNELS.writeText, text)
  },
  translate: {
    translate: (text, requestId) =>
      ipcRenderer.invoke(TRANSLATE_CHANNELS.translate, { text, requestId }),
    cancel: (requestId) => ipcRenderer.send(TRANSLATE_CHANNELS.cancel, { requestId }),
    getSettings: () => ipcRenderer.invoke(TRANSLATE_CHANNELS.getSettings),
    setSettings: (patch) => ipcRenderer.invoke(TRANSLATE_CHANNELS.setSettings, patch)
  },
  jimaku: {
    getStatus: () => ipcRenderer.invoke(JIMAKU_CHANNELS.getStatus),
    setApiKey: (value) => ipcRenderer.invoke(JIMAKU_CHANNELS.setApiKey, value),
    clearApiKey: () => ipcRenderer.invoke(JIMAKU_CHANNELS.clearApiKey),
    testConnection: () => ipcRenderer.invoke(JIMAKU_CHANNELS.testConnection),
    getFolderHint: (mediaPath, season) =>
      ipcRenderer.invoke(JIMAKU_CHANNELS.getFolderHint, mediaPath, season),
    setFolderHint: (mediaPath, hint) =>
      ipcRenderer.invoke(JIMAKU_CHANNELS.setFolderHint, mediaPath, hint),
    clearFolderHint: (mediaPath, season) =>
      ipcRenderer.invoke(JIMAKU_CHANNELS.clearFolderHint, mediaPath, season),
    beginSession: (mediaPath, mediaGeneration) =>
      ipcRenderer.invoke(JIMAKU_CHANNELS.beginSession, mediaPath, mediaGeneration),
    searchTitles: (sessionId, request) =>
      ipcRenderer.invoke(JIMAKU_CHANNELS.searchTitles, sessionId, request),
    listFiles: (sessionId, entryId, refresh) =>
      ipcRenderer.invoke(JIMAKU_CHANNELS.listFiles, sessionId, entryId, refresh),
    prepareFile: (sessionId, candidateId) =>
      ipcRenderer.invoke(JIMAKU_CHANNELS.prepareFile, sessionId, candidateId),
    prepareArchiveMember: (sessionId, packageId, memberId) =>
      ipcRenderer.invoke(JIMAKU_CHANNELS.prepareArchiveMember, sessionId, packageId, memberId),
    cancelPending: (sessionId) => ipcRenderer.invoke(JIMAKU_CHANNELS.cancelPending, sessionId),
    endSession: (sessionId) => ipcRenderer.invoke(JIMAKU_CHANNELS.endSession, sessionId),
    openSourcePage: (sessionId, entryId) =>
      ipcRenderer.invoke(JIMAKU_CHANNELS.openSourcePage, sessionId, entryId),
    commitPreparedSubtitle: (sessionId, handle) =>
      ipcRenderer.invoke(JIMAKU_CHANNELS.commitPreparedSubtitle, sessionId, handle),
    exportActiveSubtitle: (request) =>
      ipcRenderer.invoke(JIMAKU_CHANNELS.exportActiveSubtitle, request)
  },
  // Drag-and-drop plumbing: Electron >= 32 removed `File.path`, so the real
  // filesystem path of a dropped file can only be recovered here, in the
  // preload world (the File object is proxied across the context bridge).
  files: {
    pathForFile: (file) => webUtils.getPathForFile(file)
  }
} satisfies KizunaApi

declare global {
  interface Window {
    kizuna: KizunaApi
  }
}

contextBridge.exposeInMainWorld('kizuna', api)
