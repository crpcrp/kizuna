// Shared preload API contract, crossing preload/renderer. Pure type — the
// preload implementation is checked against this with `satisfies`, and the
// renderer's `window.kizuna` uses the same type, so the two can never drift.

import type { Track, VideoDimensions } from './track'
import type { Chapter } from './chapter'
import type { Cue } from './cue'
import type { SubtitleEncoding } from './subtitleEncoding'
import type { Token } from './token'
import type { McDict } from './mecab'
import type {
  ImportResult,
  FrequencyMode,
  LookupResult,
  DictInfo,
  ImportProgress
} from './dictionary'
import type { PlayerSettings, VideoAdjustments } from './playerSettings'
import type { BundledBinaryStatus } from './integrationStatus'
import type { AppInfo, AppInfoLink, NoticeOpenResult } from './appInfo'
import type { AudioDevice } from './audioDevice'
import type { MediaKeyCommand } from './mediaKey'
import type { SetWindowBoundsRequest, WindowBounds } from './windowBounds'
import type { WindowShapeRect } from './windowShape'
import type {
  AnkiJlptBackfillApplyRequest,
  AnkiJlptBackfillPreview,
  AnkiJlptBackfillProgress,
  AnkiJlptBackfillResult,
  AnkiExistingMatch,
  AnkiJlptSetupResult,
  AnkiMembershipMatches,
  AnkiMineResult,
  AnkiSettings,
  AnkiPing,
  MineRequest
} from './anki'
import type {
  KnowledgeDetails,
  KnowledgeLevel,
  KnowledgeSource,
  KnowledgeTuning,
  PublicKnowledgeSettings,
  SyncStatus
} from './knowledge'
import type {
  MediaPlaybackHistory,
  RecentMediaFile,
  StoredSubtitleSelection,
  StoredTrackSelection
} from './mediaHistory'
import type { UpdateCheckOrigin, UpdateSettings, UpdateState } from './update'
import type {
  GameOcrCaptureBytes,
  GameOcrFreezeRequest,
  GameOcrFrozenFrame,
  GameOcrRegionsRendered,
  GameOcrRuntimeStatus
} from './gameOcr'
import type { GameOcrSettings } from './gameOcrSettings'
import type { OcrResult } from './ocr'
import type { AppSurface } from './appShell'
import type { PublicTranslationSettings, TranslationSettingsPatch } from './translation'

export type FileAvailability =
  { status: 'available' } | { status: 'missing' } | { status: 'error'; message: string }

export interface KizunaApi {
  windowControls: {
    minimize(): void
    close(): void
    setFullscreen(flag: boolean): void
    toggleFullscreen(): void
    onFullscreenChange(cb: (value: boolean) => void): () => void
    setSize(width: number, height: number): void
    setAlwaysOnTop(flag: boolean): void
    setShape?(rects: WindowShapeRect[]): void
    getBounds(): Promise<WindowBounds | null>
    setBounds(request: SetWindowBoundsRequest): Promise<WindowBounds | null>
  }
  player: {
    load(path: string): Promise<unknown>
    setPause(paused: boolean): Promise<unknown>
    seek(seconds: number, absolute?: boolean): Promise<unknown>
    setVolume(volume: number): Promise<unknown>
    setSpeed(speed: number): Promise<unknown>
    setMuted(muted: boolean): Promise<unknown>
    setAudioDelay(delayMs: number): Promise<unknown>
    setAudioTrack(aid: number): Promise<unknown>
    /** Reads mpv's `audio-device-list` for the Audio > Device menu. */
    getAudioDevices(): Promise<AudioDevice[]>
    /** Switches the active output device live; `'auto'` follows the OS default. */
    setAudioDevice(name: string): Promise<unknown>
    /** Toggles the dynaudnorm loudness-normalization filter. */
    setLoudnessNorm(on: boolean): Promise<unknown>
    /** Sets/clears mpv's native A–B loop; endpoints in seconds, `null` clears. */
    setAbLoop(a: number | null, b: number | null): Promise<unknown>
    setVideoMargins(top: number, bottom: number, right?: number, left?: number): Promise<unknown>
    /** Applies the whole picture-adjustments block (equalizer values, rotate,
     * deinterlace) in one call; main fans it out to mpv's properties. */
    setVideoAdjustments(adjustments: VideoAdjustments): Promise<unknown>
    /** Advances one frame then pauses (mpv `frame-step`). */
    frameStep(): Promise<unknown>
    /** Steps back one frame then pauses (mpv `frame-back-step`). */
    frameBackStep(): Promise<unknown>
    /** Captures the current frame to a PNG under the screenshot folder;
     * resolves the saved file's absolute path. */
    screenshot(mediaPath: string, timePos: number): Promise<string>
    /** Captures the current frame as raw base64 PNG data for the Anki picture
     * flow (nothing is written to the screenshot folder); null when no frame
     * could be captured. */
    captureFrame(): Promise<string | null>
    onTimePos(cb: (value: number) => void): () => void
    onDuration(cb: (value: number) => void): () => void
    onEofReached(cb: (value: unknown) => void): () => void
    /** mpv's authoritative pause state, including self-pauses (frame-step, EOF)
     * the renderer never commanded. */
    onPause(cb: (value: boolean) => void): () => void
    /** A system media surface (keyboard media key or taskbar thumbnail button)
     * was activated; routed through the same handlers the in-window keys use. */
    onMediaKey(cb: (value: MediaKeyCommand) => void): () => void
  }
  launch: {
    onOpenPath(cb: (path: string) => void): () => void
    onError(cb: (message: string) => void): () => void
    rendererReady(): void
  }
  appShell: {
    getSurface(): Promise<AppSurface>
    showSplash(): Promise<AppSurface>
    showPlayer(): Promise<AppSurface>
    showOptions(): Promise<AppSurface>
    dismissOptions(): Promise<AppSurface>
    quit(): void
    onSurfaceChanged(cb: (surface: AppSurface) => void): () => void
  }
  gameOcr: {
    /** True only on the Windows runtime where the experimental feature exists. */
    supported: boolean
    getSettings(): Promise<GameOcrSettings>
    setSettings(patch: Partial<GameOcrSettings>): Promise<GameOcrSettings>
    getStatus(): Promise<GameOcrRuntimeStatus>
    start(): Promise<GameOcrRuntimeStatus>
    stop(): Promise<GameOcrRuntimeStatus>
    retry(): Promise<GameOcrRuntimeStatus>
    onStatusChange(cb: (status: GameOcrRuntimeStatus) => void): () => void
    /** Freeze the display this frame streams; the screenshot goes the other way. */
    onFreeze(cb: (request: GameOcrFreezeRequest) => void): () => void
    /** The frame is drawn and can be shown. Sent before the encode. */
    frozen(value: GameOcrFrozenFrame): void
    /** The encoded screenshot, for the OCR worker only. */
    captureBytes(value: GameOcrCaptureBytes): void
    onDiscard(cb: () => void): () => void
    onRecognitionState(cb: (recognizing: boolean) => void): () => void
    /** The accepted OCR regions for the screenshot currently presented. */
    onRegions(cb: (result: OcrResult) => void): () => void
    /** Reports that React committed the regions and the browser reached a paint. */
    regionsRendered(value: GameOcrRegionsRendered): void
    /**
     * Copy the frame's current text selection. The frozen frame is never
     * focused, so Ctrl+C arrives as a global shortcut rather than as a key
     * event the page could handle itself.
     */
    onCopySelection(cb: () => void): () => void
    rendererReady(): void
    close(): void
  }
  media: {
    openFile(): Promise<string | undefined>
    /** Multi-select open-file dialog; resolves the chosen paths (empty if cancelled). */
    openFiles(): Promise<string[]>
    /** Directory picker; resolves every naturally-sorted video in the folder (empty if cancelled). */
    openFolder(): Promise<string[]>
    /** Reads an `.m3u`/`.m3u8` file into absolute media paths. */
    readPlaylist(filePath: string): Promise<string[]>
    /** Save dialog + write the queue as `.m3u`; resolves the saved path, or undefined if cancelled. */
    savePlaylist(paths: string[]): Promise<string | undefined>
    /** Open-file dialog filtered to subtitle files; undefined if cancelled. */
    openSubtitleFile(): Promise<string | undefined>
    enumerateTracks(filePath: string): Promise<Track[]>
    loadSubtitle(filePath: string, streamIndex: number): Promise<Cue[]>
    /** Reads and parses a standalone .srt/.ass/.ssa file into cues. */
    loadExternalSubtitle(subtitlePath: string, encoding?: SubtitleEncoding): Promise<Cue[]>
    getVideoDimensions(filePath: string): Promise<VideoDimensions | undefined>
    getChapters(filePath: string): Promise<Chapter[]>
    folderNeighbors(filePath: string): Promise<{ prev?: string; next?: string }>
    /** Seekbar hover preview for `timeSec`: a base64 `data:image/jpeg` payload,
     * or null when no preview is available (short/unknown duration, no video
     * stream, or ffmpeg failure). */
    getThumbnail(
      filePath: string,
      timeSec: number,
      durationSec: number
    ): Promise<{ dataUrl: string } | null>
  }
  mediaHistory: {
    getRecentFiles(): Promise<RecentMediaFile[]>
    getPlaybackHistory(path: string): Promise<MediaPlaybackHistory | undefined>
    removeRecentFile(path: string): Promise<RecentMediaFile[]>
    clearRecentFiles(): Promise<void>
    checkFileAvailability(path: string): Promise<FileAvailability>
    setAudioTrack(path: string, track: StoredTrackSelection): Promise<void>
    setSubtitleTrack(path: string, selection: StoredSubtitleSelection): Promise<void>
  }
  mecab: {
    tokenize(text: string): Promise<Token[]>
    tokenizeBatch(texts: string[]): Promise<Token[][]>
    listDicts(): Promise<McDict[]>
    selectDict(id: string): Promise<'ipadic' | 'unidic'>
    currentDict(): Promise<'ipadic' | 'unidic'>
    /** Creates and reveals the persistent UniDic folder in the OS file manager. */
    openUserUnidicDir(): Promise<string>
  }
  dict: {
    importDict(zipBytes: Uint8Array): Promise<ImportResult>
    lookup(
      lemma: string,
      reading?: string,
      freqDictId?: number | null,
      sortMode?: FrequencyMode,
      longestMatchCandidates?: string[],
      surface?: string
    ): Promise<LookupResult[]>
    listDicts(): Promise<DictInfo[]>
    setEnabled(id: number, enabled: boolean): Promise<void>
    setFallbackOnly(id: number, fallbackOnly: boolean): Promise<void>
    reorder(orderedIds: number[]): Promise<void>
    removeDict(id: number): Promise<void>
    /** Advisory progress push while an importDict call is in flight. */
    onImportProgress(cb: (value: ImportProgress) => void): () => void
  }
  anki: {
    ping(): Promise<AnkiPing>
    deckNames(): Promise<string[]>
    modelNames(): Promise<string[]>
    modelFieldNames(modelName: string): Promise<string[]>
    setupJlptField(): Promise<AnkiJlptSetupResult>
    previewJlptBackfill(): Promise<AnkiJlptBackfillPreview>
    applyJlptBackfill(request: AnkiJlptBackfillApplyRequest): Promise<AnkiJlptBackfillResult>
    onJlptBackfillProgress(cb: (value: AnkiJlptBackfillProgress) => void): () => void
    addNote(req: MineRequest): Promise<AnkiMineResult>
    findExisting(token: Token, word?: string): Promise<AnkiExistingMatch | null>
    findTargetDeckMembership(expressions: string[]): Promise<AnkiMembershipMatches>
    openCard(cardId: number): Promise<void>
    getSettings(): Promise<AnkiSettings>
    setSettings(patch: Partial<AnkiSettings>): Promise<AnkiSettings>
  }
  knowledge: {
    levelsFor(lemmas: string[]): Promise<Record<string, KnowledgeLevel>>
    detailsFor(lemmas: string[]): Promise<Record<string, KnowledgeDetails>>
    sync(source?: KnowledgeSource, opts?: { force?: boolean }): Promise<SyncStatus>
    syncStatus(): Promise<SyncStatus>
    getSettings(): Promise<PublicKnowledgeSettings>
    setSettings(
      patch: Partial<KnowledgeTuning> & {
        wanikaniToken?: string
      }
    ): Promise<PublicKnowledgeSettings>
  }
  playerSettings: {
    getSettings(): Promise<PlayerSettings>
    setSettings(patch: Partial<PlayerSettings>): Promise<PlayerSettings>
    /** Creates (if needed) and reveals Kizuna's mpv config folder in the OS
     * file manager; resolves the `shell.openPath` result (empty on success). */
    openMpvConfigDir(): Promise<string>
  }
  integration: {
    /** Read-only diagnostics for the "Setup & integrations" tab: which optional
     * bundled binaries are present on disk. Never mutates anything. */
    binaryStatus(): Promise<BundledBinaryStatus>
  }
  appInfo: {
    get(): Promise<AppInfo>
    openLink(link: AppInfoLink): Promise<void>
    openNotices(): Promise<NoticeOpenResult>
  }
  updates: {
    getState(): Promise<UpdateState>
    getSettings(): Promise<UpdateSettings>
    setSettings(patch: Partial<UpdateSettings>): Promise<UpdateSettings>
    check(origin: UpdateCheckOrigin): Promise<UpdateState>
    download(): Promise<UpdateState>
    install(): Promise<void>
    onStateChange(cb: (state: UpdateState) => void): () => void
  }
  clipboard: {
    writeText(text: string): Promise<void>
  }
  translate: {
    translate(text: string, requestId: string): Promise<string>
    cancel(requestId: string): void
    getSettings(): Promise<PublicTranslationSettings>
    setSettings(patch: TranslationSettingsPatch): Promise<PublicTranslationSettings>
  }
  files: {
    /** Real filesystem path of a dropped `File` (Electron's `webUtils.getPathForFile`). */
    pathForFile(file: File): string
  }
}
