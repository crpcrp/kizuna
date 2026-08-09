// Preload bridge: the renderer's only path to main. Typed, minimal surface —
// contextIsolation is on and nodeIntegration is off (see windowOptions.ts).
import { contextBridge, ipcRenderer, webUtils } from 'electron'
import {
  ANKI_CHANNELS,
  APP_INFO_CHANNELS,
  CLIPBOARD_CHANNELS,
  DICT_CHANNELS,
  INTEGRATION_CHANNELS,
  KNOWLEDGE_CHANNELS,
  LAUNCH_CHANNELS,
  MECAB_CHANNELS,
  MEDIA_CHANNELS,
  MEDIA_HISTORY_CHANNELS,
  PLAYER_CHANNELS,
  PLAYER_SETTINGS_CHANNELS,
  TRANSLATE_CHANNELS,
  UPDATE_CHANNELS,
  URL_SUBTITLE_CHANNELS,
  WINDOW_CONTROL_CHANNELS
} from '../shared/ipcChannels'
import type { Track, VideoDimensions } from '../shared/track'
import type { Cue } from '../shared/cue'
import type { SubtitleEncoding } from '../shared/subtitleEncoding'
import type { Token } from '../shared/token'
import type { McDict } from '../shared/mecab'
import type {
  ImportResult,
  FrequencyMode,
  LookupResult,
  DictInfo,
  ImportProgress
} from '../shared/dictionary'
import type { PlayerSettings, VideoAdjustments } from '../shared/playerSettings'
import type { BundledBinaryStatus } from '../shared/integrationStatus'
import type { AppInfo, AppInfoLink, NoticeOpenResult } from '../shared/appInfo'
import type { AudioDevice } from '../shared/audioDevice'
import type { YtdlpQuality } from '../shared/ytdlpQuality'
import type {
  UrlSubtitleAsset,
  UrlSubtitleDescriptor,
  UrlSubtitleInventory
} from '../shared/urlSubtitles'
import type { MediaKeyCommand } from '../shared/mediaKey'
import type { SetWindowBoundsRequest, WindowBounds } from '../shared/windowBounds'
import type { WindowShapeRect } from '../shared/windowShape'
import type {
  AnkiExistingMatch,
  AnkiMembershipMatches,
  AnkiMineResult,
  AnkiSettings,
  AnkiPing,
  MineRequest
} from '../shared/anki'
import type {
  KnowledgeLevel,
  KnowledgeDetails,
  KnowledgeSource,
  KnowledgeTuning,
  PublicKnowledgeSettings,
  SyncStatus
} from '../shared/knowledge'
import type { KizunaApi } from '../shared/preloadApi'
import type { StoredSubtitleSelection, StoredTrackSelection } from '../shared/mediaHistory'
import type { UpdateCheckOrigin, UpdateSettings, UpdateState } from '../shared/update'

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

function subscribe<T>(channel: string, callback: (value: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, value: T): void => callback(value)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api = {
  // The frameless window has no OS buttons; custom chrome calls these.
  windowControls: {
    minimize: (): void => ipcRenderer.send(WINDOW_CONTROL_CHANNELS.minimize),
    close: (): void => ipcRenderer.send(WINDOW_CONTROL_CHANNELS.close),
    setFullscreen: (flag: boolean): void =>
      ipcRenderer.send(WINDOW_CONTROL_CHANNELS.setFullscreen, flag),
    toggleFullscreen: (): void => ipcRenderer.send(WINDOW_CONTROL_CHANNELS.toggleFullscreen),
    onFullscreenChange: (cb: (value: boolean) => void): (() => void) =>
      subscribe(WINDOW_CONTROL_CHANNELS.fullscreenChanged, cb),
    setSize: (width: number, height: number): void =>
      ipcRenderer.send(WINDOW_CONTROL_CHANNELS.setSize, width, height),
    setAlwaysOnTop: (flag: boolean): void =>
      ipcRenderer.send(WINDOW_CONTROL_CHANNELS.setAlwaysOnTop, flag),
    ...windowShapeApi((rects) => ipcRenderer.send(WINDOW_CONTROL_CHANNELS.setShape, rects)),
    getBounds: (): Promise<WindowBounds | null> =>
      ipcRenderer.invoke(WINDOW_CONTROL_CHANNELS.getBounds),
    setBounds: (request: SetWindowBoundsRequest): Promise<WindowBounds | null> =>
      ipcRenderer.invoke(WINDOW_CONTROL_CHANNELS.setBounds, request)
  },
  // mpv playback bridge: commands invoke main's ipcMain.handle channels;
  // subscriptions listen for main's property-observer pushes and return an
  // unsubscribe function so callers can clean up (e.g. on unmount).
  player: {
    load: (path: string): Promise<unknown> => ipcRenderer.invoke(PLAYER_CHANNELS.load, path),
    cancelLoad: (): Promise<void> => ipcRenderer.invoke(PLAYER_CHANNELS.cancelLoad),
    getTrackList: (): Promise<Track[]> => ipcRenderer.invoke(PLAYER_CHANNELS.getTrackList),
    getVideoDimensions: (): Promise<VideoDimensions | undefined> =>
      ipcRenderer.invoke(PLAYER_CHANNELS.getVideoDimensions),
    setPause: (paused: boolean): Promise<unknown> =>
      ipcRenderer.invoke(PLAYER_CHANNELS.setPause, paused),
    seek: (seconds: number, absolute?: boolean): Promise<unknown> =>
      ipcRenderer.invoke(PLAYER_CHANNELS.seek, seconds, absolute),
    setVolume: (volume: number): Promise<unknown> =>
      ipcRenderer.invoke(PLAYER_CHANNELS.setVolume, volume),
    setSpeed: (speed: number): Promise<unknown> =>
      ipcRenderer.invoke(PLAYER_CHANNELS.setSpeed, speed),
    setMuted: (muted: boolean): Promise<unknown> =>
      ipcRenderer.invoke(PLAYER_CHANNELS.setMuted, muted),
    setAudioDelay: (delayMs: number): Promise<unknown> =>
      ipcRenderer.invoke(PLAYER_CHANNELS.setAudioDelay, delayMs),
    setAudioTrack: (aid: number): Promise<unknown> =>
      ipcRenderer.invoke(PLAYER_CHANNELS.setAudioTrack, aid),
    getAudioDevices: (): Promise<AudioDevice[]> =>
      ipcRenderer.invoke(PLAYER_CHANNELS.getAudioDevices),
    setAudioDevice: (name: string): Promise<unknown> =>
      ipcRenderer.invoke(PLAYER_CHANNELS.setAudioDevice, name),
    setLoudnessNorm: (on: boolean): Promise<unknown> =>
      ipcRenderer.invoke(PLAYER_CHANNELS.setLoudnessNorm, on),
    setYtdlpQuality: (quality: YtdlpQuality): Promise<unknown> =>
      ipcRenderer.invoke(PLAYER_CHANNELS.setYtdlpQuality, quality),
    setAbLoop: (a: number | null, b: number | null): Promise<unknown> =>
      ipcRenderer.invoke(PLAYER_CHANNELS.setAbLoop, a, b),
    setVideoMargins: (
      top: number,
      bottom: number,
      right?: number,
      left?: number
    ): Promise<unknown> =>
      ipcRenderer.invoke(PLAYER_CHANNELS.setVideoMargins, top, bottom, right, left),
    setVideoAdjustments: (adjustments: VideoAdjustments): Promise<unknown> =>
      ipcRenderer.invoke(PLAYER_CHANNELS.setVideoAdjustments, adjustments),
    frameStep: (): Promise<unknown> => ipcRenderer.invoke(PLAYER_CHANNELS.frameStep),
    frameBackStep: (): Promise<unknown> => ipcRenderer.invoke(PLAYER_CHANNELS.frameBackStep),
    screenshot: (mediaPath: string, timePos: number): Promise<string> =>
      ipcRenderer.invoke(PLAYER_CHANNELS.screenshot, mediaPath, timePos),
    captureFrame: (): Promise<string | null> => ipcRenderer.invoke(PLAYER_CHANNELS.captureFrame),
    onTimePos: (cb: (value: number) => void): (() => void) =>
      subscribe(PLAYER_CHANNELS.timePos, cb),
    onDuration: (cb: (value: number) => void): (() => void) =>
      subscribe(PLAYER_CHANNELS.duration, cb),
    onEofReached: (cb: (value: unknown) => void): (() => void) =>
      subscribe(PLAYER_CHANNELS.eofReached, cb),
    onPause: (cb: (value: boolean) => void): (() => void) => subscribe(PLAYER_CHANNELS.pause, cb),
    onMediaKey: (cb: (value: MediaKeyCommand) => void): (() => void) =>
      subscribe(PLAYER_CHANNELS.mediaKey, cb)
  },
  launch: {
    onOpenPath: (cb: (path: string) => void): (() => void) =>
      subscribe(LAUNCH_CHANNELS.openPath, cb),
    onError: (cb: (message: string) => void): (() => void) => subscribe(LAUNCH_CHANNELS.error, cb),
    rendererReady: (): void => ipcRenderer.send(LAUNCH_CHANNELS.rendererReady)
  },

  // Media bridge: file-selection, ffprobe track enumeration, and ffmpeg
  // subtitle-loading — all renderer→main invoke/handle round-trips.
  media: {
    openFile: (): Promise<string | undefined> => ipcRenderer.invoke(MEDIA_CHANNELS.openFile),
    openFiles: (): Promise<string[]> => ipcRenderer.invoke(MEDIA_CHANNELS.openFiles),
    openFolder: (): Promise<string[]> => ipcRenderer.invoke(MEDIA_CHANNELS.openFolder),
    readPlaylist: (filePath: string): Promise<string[]> =>
      ipcRenderer.invoke(MEDIA_CHANNELS.readPlaylist, filePath),
    savePlaylist: (paths: string[]): Promise<string | undefined> =>
      ipcRenderer.invoke(MEDIA_CHANNELS.savePlaylist, paths),
    openSubtitleFile: (): Promise<string | undefined> =>
      ipcRenderer.invoke(MEDIA_CHANNELS.openSubtitleFile),
    enumerateTracks: (filePath: string): Promise<Track[]> =>
      ipcRenderer.invoke(MEDIA_CHANNELS.enumerateTracks, filePath),
    loadSubtitle: (filePath: string, streamIndex: number): Promise<Cue[]> =>
      ipcRenderer.invoke(MEDIA_CHANNELS.loadSubtitle, filePath, streamIndex),
    loadExternalSubtitle: (
      subtitlePath: string,
      encoding: SubtitleEncoding = 'auto'
    ): Promise<Cue[]> =>
      ipcRenderer.invoke(MEDIA_CHANNELS.loadExternalSubtitle, subtitlePath, encoding),
    getVideoDimensions: (filePath: string): Promise<VideoDimensions | undefined> =>
      ipcRenderer.invoke(MEDIA_CHANNELS.getVideoDimensions, filePath),
    getChapters: (filePath) => ipcRenderer.invoke(MEDIA_CHANNELS.getChapters, filePath),
    folderNeighbors: (filePath: string): Promise<{ prev?: string; next?: string }> =>
      ipcRenderer.invoke(MEDIA_CHANNELS.folderNeighbors, filePath),
    getThumbnail: (
      filePath: string,
      timeSec: number,
      durationSec: number
    ): Promise<{ dataUrl: string } | null> =>
      ipcRenderer.invoke(MEDIA_CHANNELS.thumbnail, filePath, timeSec, durationSec)
  },
  mediaHistory: {
    getRecentFiles: () => ipcRenderer.invoke(MEDIA_HISTORY_CHANNELS.getRecentFiles),
    getPlaybackHistory: (path: string) =>
      ipcRenderer.invoke(MEDIA_HISTORY_CHANNELS.getPlaybackHistory, path),
    removeRecentFile: (path: string) =>
      ipcRenderer.invoke(MEDIA_HISTORY_CHANNELS.removeRecentFile, path),
    clearRecentFiles: () => ipcRenderer.invoke(MEDIA_HISTORY_CHANNELS.clearRecentFiles),
    checkFileAvailability: (path: string) =>
      ipcRenderer.invoke(MEDIA_HISTORY_CHANNELS.checkFileAvailability, path),
    setAudioTrack: (path: string, track: StoredTrackSelection) =>
      ipcRenderer.invoke(MEDIA_HISTORY_CHANNELS.setAudioTrack, path, track),
    setSubtitleTrack: (path: string, selection: StoredSubtitleSelection) =>
      ipcRenderer.invoke(MEDIA_HISTORY_CHANNELS.setSubtitleTrack, path, selection)
  },
  mecab: {
    tokenize: (text: string): Promise<Token[]> => ipcRenderer.invoke(MECAB_CHANNELS.tokenize, text),
    tokenizeBatch: (texts: string[]): Promise<Token[][]> =>
      ipcRenderer.invoke(MECAB_CHANNELS.tokenizeBatch, texts),
    listDicts: (): Promise<McDict[]> => ipcRenderer.invoke(MECAB_CHANNELS.listDicts),
    selectDict: (id: string): Promise<'ipadic' | 'unidic'> =>
      ipcRenderer.invoke(MECAB_CHANNELS.selectDict, id),
    currentDict: (): Promise<'ipadic' | 'unidic'> => ipcRenderer.invoke(MECAB_CHANNELS.currentDict)
  },
  // Yomitan dictionary bridge: import a dictionary zip (already read into
  // bytes by the renderer's file picker), look up a term, and manage the
  // installed dictionaries (list/enable/reorder/remove).
  dict: {
    importDict: (zipBytes: Uint8Array): Promise<ImportResult> =>
      ipcRenderer.invoke(DICT_CHANNELS.importDict, zipBytes),
    lookup: (
      lemma: string,
      reading?: string,
      freqDictId?: number | null,
      sortMode?: FrequencyMode,
      longestMatchCandidates?: string[],
      surface?: string
    ): Promise<LookupResult[]> =>
      ipcRenderer.invoke(
        DICT_CHANNELS.lookup,
        lemma,
        reading,
        freqDictId,
        sortMode,
        longestMatchCandidates,
        surface
      ),
    listDicts: (): Promise<DictInfo[]> => ipcRenderer.invoke(DICT_CHANNELS.listDicts),
    setEnabled: (id: number, enabled: boolean): Promise<void> =>
      ipcRenderer.invoke(DICT_CHANNELS.setEnabled, id, enabled),
    setFallbackOnly: (id: number, fallbackOnly: boolean): Promise<void> =>
      ipcRenderer.invoke(DICT_CHANNELS.setFallbackOnly, id, fallbackOnly),
    reorder: (orderedIds: number[]): Promise<void> =>
      ipcRenderer.invoke(DICT_CHANNELS.reorder, orderedIds),
    removeDict: (id: number): Promise<void> => ipcRenderer.invoke(DICT_CHANNELS.remove, id),
    onImportProgress: (cb: (value: ImportProgress) => void): (() => void) =>
      subscribe(DICT_CHANNELS.importProgress, cb)
  },
  // AnkiConnect bridge: test the connection, populate Options selects from
  // the running Anki (decks/models/fields), add a note from the WordPopup,
  // and read/write the `anki` settings block.
  anki: {
    ping: (): Promise<AnkiPing> => ipcRenderer.invoke(ANKI_CHANNELS.ping),
    deckNames: (): Promise<string[]> => ipcRenderer.invoke(ANKI_CHANNELS.deckNames),
    modelNames: (): Promise<string[]> => ipcRenderer.invoke(ANKI_CHANNELS.modelNames),
    modelFieldNames: (modelName: string): Promise<string[]> =>
      ipcRenderer.invoke(ANKI_CHANNELS.modelFieldNames, modelName),
    addNote: (req: MineRequest): Promise<AnkiMineResult> =>
      ipcRenderer.invoke(ANKI_CHANNELS.addNote, req),
    findExisting: (token: Token, word?: string): Promise<AnkiExistingMatch | null> =>
      ipcRenderer.invoke(ANKI_CHANNELS.findExisting, token, word),
    findTargetDeckMembership: (expressions: string[]): Promise<AnkiMembershipMatches> =>
      ipcRenderer.invoke(ANKI_CHANNELS.findTargetDeckMembership, expressions),
    openCard: (cardId: number): Promise<void> => ipcRenderer.invoke(ANKI_CHANNELS.openCard, cardId),
    getSettings: (): Promise<AnkiSettings> => ipcRenderer.invoke(ANKI_CHANNELS.getSettings),
    setSettings: (patch: Partial<AnkiSettings>): Promise<AnkiSettings> =>
      ipcRenderer.invoke(ANKI_CHANNELS.setSettings, patch)
  },
  // Knowledge bridge: query known-word levels for subtitle coloring, trigger
  // a WaniKani/Anki sync, read sync status, and read/write the `knowledge`
  // settings block (WaniKani token stays encrypted server-side).
  knowledge: {
    levelsFor: (lemmas: string[]): Promise<Record<string, KnowledgeLevel>> =>
      ipcRenderer.invoke(KNOWLEDGE_CHANNELS.levelsFor, lemmas),
    detailsFor: (lemmas: string[]): Promise<Record<string, KnowledgeDetails>> =>
      ipcRenderer.invoke(KNOWLEDGE_CHANNELS.detailsFor, lemmas),
    sync: (source?: KnowledgeSource, opts?: { force?: boolean }): Promise<SyncStatus> =>
      ipcRenderer.invoke(KNOWLEDGE_CHANNELS.sync, source, opts),
    syncStatus: (): Promise<SyncStatus> => ipcRenderer.invoke(KNOWLEDGE_CHANNELS.syncStatus),
    getSettings: (): Promise<PublicKnowledgeSettings> =>
      ipcRenderer.invoke(KNOWLEDGE_CHANNELS.getSettings),
    setSettings: (
      patch: Partial<KnowledgeTuning> & {
        wanikaniToken?: string
      }
    ): Promise<PublicKnowledgeSettings> => ipcRenderer.invoke(KNOWLEDGE_CHANNELS.setSettings, patch)
  },
  // Player-settings bridge: read/write the `player` settings block (the
  // Options menu's contents — keybindings, skip amount, popup/subtitle
  // display), persisted to settings.json instead of localStorage.
  playerSettings: {
    getSettings: (): Promise<PlayerSettings> =>
      ipcRenderer.invoke(PLAYER_SETTINGS_CHANNELS.getSettings),
    setSettings: (patch: Partial<PlayerSettings>): Promise<PlayerSettings> =>
      ipcRenderer.invoke(PLAYER_SETTINGS_CHANNELS.setSettings, patch),
    openMpvConfigDir: (): Promise<string> =>
      ipcRenderer.invoke(PLAYER_SETTINGS_CHANNELS.openMpvConfigDir)
  },
  // Integration-status bridge: read-only "is this bundled binary on disk?"
  // diagnostics for the Options dialog's "Setup & integrations" tab.
  integration: {
    binaryStatus: (): Promise<BundledBinaryStatus> =>
      ipcRenderer.invoke(INTEGRATION_CHANNELS.binaryStatus)
  },
  appInfo: {
    get: (): Promise<AppInfo> => ipcRenderer.invoke(APP_INFO_CHANNELS.get),
    openLink: (link: AppInfoLink): Promise<void> =>
      ipcRenderer.invoke(APP_INFO_CHANNELS.openLink, link),
    openNotices: (): Promise<NoticeOpenResult> => ipcRenderer.invoke(APP_INFO_CHANNELS.openNotices)
  },
  updates: {
    getState: (): Promise<UpdateState> => ipcRenderer.invoke(UPDATE_CHANNELS.getState),
    getSettings: (): Promise<UpdateSettings> => ipcRenderer.invoke(UPDATE_CHANNELS.getSettings),
    setSettings: (patch: Partial<UpdateSettings>): Promise<UpdateSettings> =>
      ipcRenderer.invoke(UPDATE_CHANNELS.setSettings, patch),
    check: (origin: UpdateCheckOrigin): Promise<UpdateState> =>
      ipcRenderer.invoke(UPDATE_CHANNELS.check, origin),
    download: (): Promise<UpdateState> => ipcRenderer.invoke(UPDATE_CHANNELS.download),
    install: (): Promise<void> => ipcRenderer.invoke(UPDATE_CHANNELS.install),
    onStateChange: (cb: (state: UpdateState) => void): (() => void) =>
      subscribe(UPDATE_CHANNELS.stateChanged, cb)
  },
  clipboard: {
    writeText: (text: string): Promise<void> =>
      ipcRenderer.invoke(CLIPBOARD_CHANNELS.writeText, text)
  },
  translate: {
    translate: (text: string, requestId: string): Promise<string> =>
      ipcRenderer.invoke(TRANSLATE_CHANNELS.translate, { text, requestId }),
    cancel: (requestId: string): void => ipcRenderer.send(TRANSLATE_CHANNELS.cancel, { requestId })
  },
  // URL-subtitle bridge (yt-dlp): enumerate/acquire the active extractor URL's
  // provided/auto tracks; cancel is fire-and-forget. Main validates every input.
  urlSubtitles: {
    enumerate: (url: string): Promise<UrlSubtitleInventory> =>
      ipcRenderer.invoke(URL_SUBTITLE_CHANNELS.enumerate, url),
    acquire: (descriptor: UrlSubtitleDescriptor): Promise<UrlSubtitleAsset> =>
      ipcRenderer.invoke(URL_SUBTITLE_CHANNELS.acquire, descriptor),
    cancel: (): void => ipcRenderer.send(URL_SUBTITLE_CHANNELS.cancel)
  },
  // Drag-and-drop plumbing: Electron >= 32 removed `File.path`, so the real
  // filesystem path of a dropped file can only be recovered here, in the
  // preload world (the File object is proxied across the context bridge).
  files: {
    pathForFile: (file: File): string => webUtils.getPathForFile(file)
  }
} satisfies KizunaApi

declare global {
  interface Window {
    kizuna: KizunaApi
  }
}

contextBridge.exposeInMainWorld('kizuna', api)
