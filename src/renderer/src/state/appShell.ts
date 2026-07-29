import {
  applySubtitleOffsetToFolder,
  loadExternalSubtitle,
  type OpenMediaResult,
  type OpenSession
} from './playerActions'
import { classifyMediaFileName, pickDropTarget } from '../../../shared/mediaFileTypes'
import { computeVideoWindowSize, clampWindowSize, type WindowSize } from '../util/uiHelpers'
import { clampSpeed, type PlayerApi } from '../components/BottomBar'
import type { OptionsDataBridge } from './optionsData'
import type { VideoDimensions } from '../../../shared/track'
import type { Cue } from '../../../shared/cue'
import type { Chapter } from '../../../shared/chapter'
import type { PlayerAction } from './playerState'
import type { McDict } from '../../../shared/mecab'
import type { DictInfo } from '../../../shared/dictionary'
import type { PublicKnowledgeSettings, SyncStatus } from '../../../shared/knowledge'

/** Joins the truthy class names into a className string. */
export function appClassName(
  fullscreen: boolean,
  revealTop: boolean,
  revealBottom: boolean,
  miniPlayer = false
): string {
  return [
    fullscreen ? 'fullscreen' : '',
    revealTop ? 'reveal-top' : '',
    revealBottom ? 'reveal-bottom' : '',
    miniPlayer ? 'mini-player' : ''
  ]
    .filter(Boolean)
    .join(' ')
}

/** Right-click-on-video handler (Options > Playback > "Right-click toggles
 * play/pause"): no-ops when the setting is off, otherwise flips pause the
 * same way the spacebar/play-button do. */
export function toggleFromRightClick(
  enabled: boolean,
  paused: boolean,
  setPause: (paused: boolean) => void
): void {
  if (!enabled) return
  setPause(!paused)
}

/** Sidebar toggle (MenuBar > View): flips the flag and persists the new value
 * so the sidebar comes back in the same state on the next app start. Persisted
 * here rather than from the settings save-effect, which would write the flag
 * straight back on the initial restore. */
export function toggleSidebar(
  open: boolean,
  setOpen: (open: boolean) => void,
  persist: (patch: { sidebarOpen: boolean }) => void
): void {
  const next = !open
  setOpen(next)
  persist({ sidebarOpen: next })
}

/** The two offset maps App keeps outside the render path, as refs. */
export interface SubtitleOffsetRefs {
  subtitleOffsets: { current: Record<string, number> }
  folderSubtitleOffsets: { current: Record<string, number> }
}

/**
 * Subtitle menu > "Apply to folder": stores `offsetMs` as `filePath`'s folder
 * default and clears the per-file offsets it now supersedes (see
 * `applySubtitleOffsetToFolder`), updating both refs in place and persisting
 * them in a single patch so the two maps can never be written half-applied.
 */
export function applyOffsetToFolder(
  refs: SubtitleOffsetRefs,
  filePath: string,
  offsetMs: number,
  persist: (patch: {
    subtitleOffsets: Record<string, number>
    folderSubtitleOffsets: Record<string, number>
  }) => void
): void {
  const next = applySubtitleOffsetToFolder(
    refs.subtitleOffsets.current,
    refs.folderSubtitleOffsets.current,
    filePath,
    offsetMs
  )
  refs.subtitleOffsets.current = next.subtitleOffsets
  refs.folderSubtitleOffsets.current = next.folderSubtitleOffsets
  persist(next)
}

/** A completed text selection takes precedence over subtitle token lookup. */
export function shouldOpenWordPopup(selection: Pick<Selection, 'isCollapsed'> | null): boolean {
  return selection?.isCollapsed !== false
}

/** The one `HTMLElement` capability the outside-click test needs (faked in tests). */
export interface ContainerLike {
  contains(node: Node | null): boolean
}

/**
 * Whether a pointer-down should close the word popup. False while a modal owned
 * by the popup's own mining flow is up: the mined-card picture dialog renders
 * outside `#word-popup`, so without this every click in it (crop, full frame,
 * skip) closed the popup and the mine that ran afterwards found no popup to
 * mine from and silently did nothing. A missing popup element or a click inside
 * the popup also leaves it open.
 */
export function shouldClosePopupOnPointerDown(
  popupElement: ContainerLike | null,
  target: Node | null,
  modalOpen: boolean
): boolean {
  if (modalOpen || !popupElement) return false
  return !popupElement.contains(target)
}

/**
 * Everything the drop handler acts through, injected so its decision logic
 * stays a plain function — no DOM, no bridge (see App.test.tsx). `openPath`
 * and `loadSubtitle` are the recentFilesController / playerActions calls the
 * Media menu already uses; `pathForFile` is the preload's `webUtils` escape
 * hatch (Electron ≥ 32 removed `File.path`).
 */
export interface DropHandlerDeps {
  hasVideo: boolean
  /** Current loaded video identity, read at the point a lone subtitle attaches. */
  currentFilePath: () => string | undefined
  pathForFile: (file: File) => string
  /** Returns the outcome for the specific path it was asked to open. */
  openPath: (path: string) => Promise<OpenMediaResult>
  /** Resolves a sanitized warning to surface, or undefined on success. */
  loadSubtitle: (videoPath: string, subtitlePath: string) => Promise<string | undefined>
  /** Expands a dropped `.m3u`/`.m3u8` into the queue; resolves the entry count
   * appended (0 when the playlist is empty or unreadable). */
  appendPlaylistFile: (path: string) => Promise<number>
  reportError: (message: string) => void
}

/**
 * Handles a file drop on the window: opens a dropped video, appends a dropped
 * `.m3u`/`.m3u8` to the queue, or attaches a dropped subtitle file to the video
 * already playing (`pickDropTarget` picks one target — a video wins over a
 * playlist, which wins over a subtitle, and any further files are ignored). A
 * drag carrying no files at all (dragged text, a URL) is ignored silently; one
 * carrying only files Kizuna cannot open says so.
 *
 * Concurrent drops are not filtered here: `openPath` is the recentFilesController's
 * open, whose synchronous exclusion guard refuses a second one as `busy` before it
 * reaches any bridge. A render snapshot of `mediaOpening` would be a frame stale
 * and could let two same-frame drops both pass.
 */
export async function handleDroppedFiles(files: File[], deps: DropHandlerDeps): Promise<void> {
  if (files.length === 0) return

  const target = pickDropTarget(files.map((file) => file.name))
  if (!target) {
    deps.reportError('Unsupported file type.')
    return
  }

  // Resolve both paths before the asynchronous open: Electron's File objects
  // are only useful at the drop boundary.
  const path = deps.pathForFile(files[target.index])
  if (target.kind === 'video') {
    const sidecarPath =
      target.subtitleIndex === undefined ? undefined : deps.pathForFile(files[target.subtitleIndex])
    const result = await deps.openPath(path)
    if (
      result.status !== 'opened' ||
      result.filePath !== path ||
      sidecarPath === undefined ||
      deps.currentFilePath() !== result.filePath
    )
      return
    const warning = await deps.loadSubtitle(result.filePath, sidecarPath)
    if (warning) deps.reportError(warning)
    return
  }
  if (target.kind === 'playlist') {
    const appended = await deps.appendPlaylistFile(path)
    if (appended === 0) deps.reportError('Playlist is empty or unreadable.')
    return
  }
  if (!deps.hasVideo) {
    deps.reportError('Open a video before adding a subtitle file.')
    return
  }
  const currentFilePath = deps.currentFilePath()
  if (currentFilePath === undefined) return
  const warning = await deps.loadSubtitle(currentFilePath, path)
  if (warning) deps.reportError(warning)
}

/** Copies a sidebar cue without invoking any playback behavior. */
export function copySidebarCue(
  writeText: (text: string) => Promise<void>,
  cue: Cue
): Promise<void> {
  return writeText(cue.text)
}

/**
 * Pure decision logic behind the Video menu's size presets: the clamped
 * window content size for `scale` × the video's native resolution, or
 * `undefined` when there's nothing to resize against yet (no video
 * dimensions known — e.g. an audio-only file, or still loading).
 *
 * The open side panels' measured widths are part of the target size (the
 * window has to be that much wider for the video itself to still render at
 * `scale`); they default to 0 when no panel is open. Clamping still applies
 * last, so on a display too small for scaled video + panels the video does
 * shrink — that case alone.
 */
export function videoScaleWindowSize(
  videoDimensions: VideoDimensions | undefined,
  scale: number,
  topBarHeight: number,
  bottomBarHeight: number,
  screenSize: WindowSize,
  leftSidebarWidth = 0,
  rightSidebarWidth = 0
): WindowSize | undefined {
  if (!videoDimensions) return undefined
  const size = computeVideoWindowSize(
    videoDimensions,
    scale,
    topBarHeight,
    bottomBarHeight,
    leftSidebarWidth,
    rightSidebarWidth
  )
  return clampWindowSize(size, screenSize.width, screenSize.height)
}

/**
 * The video content rectangle a side-panel transition has to preserve: the
 * window content box minus whatever side panels were open when it was measured.
 * mpv renders the picture inside exactly this rectangle (the top/bottom bars
 * overlay it rather than taking space from it), so holding it constant across a
 * panel toggle is what keeps the visible video the same size.
 */
export interface VideoContentBaseline {
  width: number
  height: number
}

/**
 * Measures the preservation baseline from the current window content size and
 * the side panels open at that moment. Widths are subtracted rather than
 * assumed, so the baseline is equally valid for a window the user hand-resized,
 * a launch geometry, or a size preset's result — the invariant is the rectangle
 * on screen, never a fabricated scale.
 */
export function videoContentBaseline(
  windowSize: WindowSize,
  leftSidebarWidth = 0,
  rightSidebarWidth = 0
): VideoContentBaseline {
  return {
    width: Math.max(0, Math.round(windowSize.width - leftSidebarWidth - rightSidebarWidth)),
    height: Math.max(0, Math.round(windowSize.height))
  }
}

/**
 * The clamped window content size that keeps `baseline` rendering at its
 * measured dimensions with the given side panels open — the default-size
 * counterpart to `videoScaleWindowSize`. Returns `undefined` when there is no
 * usable baseline yet (nothing measured, or a degenerate zero-sized window).
 *
 * Clamping applies last, exactly as it does for the presets: on a work area
 * with no room for video + panels the picture does shrink, and that case alone.
 */
export function sidebarPreservingWindowSize(
  baseline: VideoContentBaseline | undefined,
  screenSize: WindowSize,
  leftSidebarWidth = 0,
  rightSidebarWidth = 0
): WindowSize | undefined {
  if (!baseline || baseline.width <= 0 || baseline.height <= 0) return undefined
  return clampWindowSize(
    {
      width: Math.round(baseline.width + leftSidebarWidth + rightSidebarWidth),
      height: baseline.height
    },
    screenSize.width,
    screenSize.height
  )
}

/** The queue seams needed to expand paths into the playlist. */
export interface PlaylistAppendDeps {
  /** Reads an `.m3u`/`.m3u8` file's entries (main-side `parseM3u`). */
  readPlaylist: (path: string) => Promise<string[]>
  /** Appends the expanded paths to the queue, auto-starting the first one when
   *  the queue was empty and nothing is playing. */
  addPaths: (paths: string[]) => Promise<void>
}

/**
 * Expands a mix of media and playlist paths into the queue: a `.m3u`/`.m3u8`
 * expands to its entries, everything else queues as-is. Duplicate paths are
 * allowed. Returns the number of entries appended (an empty playlist yields 0).
 */
export async function appendPathsToPlaylist(
  paths: string[],
  deps: PlaylistAppendDeps
): Promise<number> {
  const expanded: string[] = []
  for (const path of paths) {
    if (classifyMediaFileName(path) === 'playlist') {
      expanded.push(...(await deps.readPlaylist(path)))
    } else {
      expanded.push(path)
    }
  }
  await deps.addPaths(expanded)
  return expanded.length
}

/**
 * Expands a single dropped `.m3u`/`.m3u8` into the queue, tolerating an
 * unreadable file: a read failure resolves 0 so the drop handler surfaces the
 * "empty or unreadable" banner instead of throwing.
 */
export async function appendPlaylistFile(path: string, deps: PlaylistAppendDeps): Promise<number> {
  try {
    return await appendPathsToPlaylist([path], deps)
  } catch {
    return 0
  }
}

/**
 * Session-first dependencies of `loadSubtitleFromPicker`: routes the picked
 * path through the same App-level `OpenSession`/`openPath` closure every
 * other direct open uses (see App.tsx's `openPath`), instead of App wrapping
 * `loadExternalSubtitle` in its own closure.
 */
export interface SubtitlePickerSessionDeps {
  /** The video that owned the command when it started. */
  expectedFilePath: string
  /** The video playing *now* — read after the dialog resolves, never captured. */
  currentFilePath: () => string | undefined
  /** Shows the subtitle-file dialog; resolves undefined when it is cancelled. */
  pickPath: () => Promise<string | undefined>
  session: OpenSession
  reportError: (message: string) => void
}

/**
 * Subtitle menu > "Load subtitle file…": picks a subtitle file and attaches it
 * to the video already playing — the same load path a dropped subtitle takes.
 * Cancelling the dialog changes nothing; a file that fails to parse surfaces
 * its warning and leaves the current subtitle selection untouched (the load
 * action dispatches nothing on failure).
 *
 * The native dialog is modeless with respect to our state: another route (a
 * drop, a recent-file open) can swap the video out while it is up. So the video
 * is re-checked against `expectedFilePath` *after* `pickPath` resolves, and a
 * subtitle picked for a video no longer playing is dropped silently — attaching
 * it would show one video's subtitles over another and persist them under the
 * wrong file's history.
 */
export async function loadSubtitleFromPicker(deps: SubtitlePickerSessionDeps): Promise<void> {
  const path = await deps.pickPath()
  if (path === undefined) return
  if (deps.currentFilePath() !== deps.expectedFilePath) return
  const warning = await loadExternalSubtitle(deps.session, deps.expectedFilePath, path)
  if (warning) deps.reportError(warning)
}

export interface ChapterLoadBridge {
  getChapters(filePath: string): Promise<Chapter[]>
}

/** Loads optional chapters and ignores stale completions after another file wins. */
export async function loadChaptersForCurrentFile(
  media: ChapterLoadBridge,
  filePath: string,
  isCurrentFile: () => boolean,
  dispatch: (action: PlayerAction) => void
): Promise<void> {
  try {
    const chapters = await media.getChapters(filePath)
    if (isCurrentFile()) dispatch({ type: 'chaptersLoaded', chapters })
  } catch {
    // Chapters are optional decoration; probing failures must not interrupt playback.
  }
}

export interface LaunchBridge {
  launch: {
    onOpenPath(cb: (path: string) => void): () => void
    onError(cb: (message: string) => void): () => void
    rendererReady(): void
  }
}

/**
 * Session-first launch deps: routes a launch-delivered path through the same
 * App-level OpenSession/openPath closure every other direct open uses (see
 * App.tsx's `openPath`), instead of rebuilding the bridge/dispatch/token
 * bundle here.
 */
export interface LaunchOpenSessionDeps {
  bridge: LaunchBridge
  openPath: (path: string) => Promise<OpenMediaResult>
  reportError: (message: string) => void
}

/** Registers launch-path delivery before notifying main the renderer is ready. */
export function registerLaunchOpenHandler(deps: LaunchOpenSessionDeps): () => void {
  const off = deps.bridge.launch.onOpenPath((path) => {
    void deps.openPath(path)
  })
  // A launch file that can't open because the playback engine failed to start
  // surfaces through the shared media-error banner instead of vanishing.
  const offError = deps.bridge.launch.onError((message) => deps.reportError(message))
  deps.bridge.launch.rendererReady()
  return () => {
    off()
    offError()
  }
}

/** Subset of the preload player bridge that buildPlayerAdapter needs. */
export interface PlayerBridgePlayer {
  setPause: (paused: boolean) => Promise<unknown>
  seek: (seconds: number, absolute?: boolean) => Promise<unknown>
  setVolume: (volume: number) => Promise<unknown>
  setSpeed: (speed: number) => Promise<unknown>
  setMuted: (muted: boolean) => Promise<unknown>
}

/**
 * Pure factory for the adapter BottomBar uses. Keeps the reducer's
 * paused/volume/muted mirror in sync with the mpv bridge; seek is
 * fire-and-forget since timePos updates arrive via the onTimePos subscription
 * instead. `resolvePlayer` defaults to the preload bridge but is only invoked
 * when a method actually fires — never at import or render time.
 */
export function buildPlayerAdapter(
  dispatch: (action: PlayerAction) => void,
  resolvePlayer: () => PlayerBridgePlayer = () => window.kizuna.player
): PlayerApi {
  return {
    setPause: async (paused: boolean) => {
      const result = await resolvePlayer().setPause(paused)
      dispatch({ type: 'setPaused', value: paused })
      return result
    },
    seek: async (seconds: number, absolute?: boolean) => {
      return resolvePlayer().seek(seconds, absolute)
    },
    setVolume: async (volume: number) => {
      const result = await resolvePlayer().setVolume(volume)
      dispatch({ type: 'setVolume', value: volume })
      return result
    },
    setMuted: async (muted: boolean) => {
      const result = await resolvePlayer().setMuted(muted)
      dispatch({ type: 'setMuted', value: muted })
      return result
    },
    setSpeed: async (speed: number) => {
      const clamped = clampSpeed(speed)
      const result = await resolvePlayer().setSpeed(clamped)
      dispatch({ type: 'setSpeed', value: clamped })
      return result
    }
  }
}

/** Rendered while the 'dictionaries' options-data domain hasn't loaded yet. */
export const DEFAULT_DICTIONARIES_DATA: {
  mecabDicts: McDict[]
  currentMecabDictId: 'ipadic' | 'unidic'
  yomitanDicts: DictInfo[]
} = {
  mecabDicts: [],
  currentMecabDictId: 'ipadic',
  yomitanDicts: []
}

/** Rendered while the 'knowledge' options-data domain hasn't loaded yet. */
// `encryptionAvailable` is deliberately omitted (undefined = not loaded yet):
// only the main process knows it, and guessing `false` here would show a false
// "saved unencrypted" warning until the knowledge domain loads.
export const DEFAULT_KNOWLEDGE_SETTINGS: PublicKnowledgeSettings = {
  hasWanikaniToken: false,
  ankiKnownDecks: [],
  ankiKnownField: '',
  knownIntervalDays: 21,
  wellKnownIntervalDays: 90,
  coloringEnabled: true,
  staleAfterHours: 23
}

export const DEFAULT_SYNC_STATUS: SyncStatus = {
  wanikani: { lastSyncAt: null, count: 0, configured: false },
  anki: { lastSyncAt: null, count: 0, configured: false }
}

/** Lazily forwards each call to `window.kizuna` so constructing the
 * controller (during render, via useRef) never itself touches `window` —
 * only the deferred call sites do, matching buildPlayerAdapter's pattern. */
export const optionsDataBridge: OptionsDataBridge = {
  mecab: {
    listDicts: () => window.kizuna.mecab.listDicts(),
    currentDict: () => window.kizuna.mecab.currentDict()
  },
  dict: {
    listDicts: () => window.kizuna.dict.listDicts()
  },
  anki: {
    ping: () => window.kizuna.anki.ping(),
    getSettings: () => window.kizuna.anki.getSettings(),
    deckNames: () => window.kizuna.anki.deckNames(),
    modelNames: () => window.kizuna.anki.modelNames(),
    modelFieldNames: (modelName) => window.kizuna.anki.modelFieldNames(modelName)
  },
  knowledge: {
    getSettings: () => window.kizuna.knowledge.getSettings(),
    syncStatus: () => window.kizuna.knowledge.syncStatus()
  },
  integration: {
    binaryStatus: () => window.kizuna.integration.binaryStatus()
  }
}
