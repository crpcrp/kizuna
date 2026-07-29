// Async orchestration layer between the preload bridge and the player-state
// reducer. Every function here takes an injected `bridge` and `dispatch`, so
// it is unit-testable with a fake bridge — no Electron, no window, no mpv.

import {
  EXTERNAL_SUBTITLE_TRACK_ID,
  URL_SUBTITLE_TRACK_ID,
  soleUrlAudioTrack,
  type Track
} from '../../../shared/track'
import type { Cue } from '../../../shared/cue'
import type { SubtitleEncoding } from '../../../shared/subtitleEncoding'
import type { Token } from '../../../shared/token'
import type { AnkiExistingMatch, AnkiMineResult } from '../../../shared/anki'
import type { KnowledgeLevel } from '../../../shared/knowledge'
import { maxKnowledgeLevel } from '../../../shared/knowledge'
import type { LookupResult, FrequencyMode } from '../../../shared/dictionary'
import type { MineMediaContext, MineRequest, MineScreenshot } from '../../../shared/anki'
import {
  SPEED_MAX,
  SPEED_MIN,
  SPEED_STEP,
  subtitleOffsetFolderKey,
  subtitleOffsetKey,
  type PlayerKeyAction,
  type VideoAdjustments
} from '../../../shared/playerSettings'
import type { FileAvailability } from '../../../shared/preloadApi'
import type { MediaKeyCommand } from '../../../shared/mediaKey'
import type {
  MediaPlaybackHistory,
  StoredSubtitleSelection,
  StoredTrackSelection
} from '../../../shared/mediaHistory'
import {
  createStoredTrackSelection,
  getResumePosition,
  mediaFileBasename
} from '../../../shared/mediaHistory'
import {
  defaultSubtitleId,
  EMPTY_AB_LOOP,
  type AbLoopState,
  type PlayerAction
} from './playerState'
import { togglePause, skipBack, skipAhead, type PlayerApi } from '../components/BottomBar'
import { nextChapterStart, nextCue, prevChapterStart, prevCue, replayCue } from './cueNavigation'
import type { Chapter } from '../../../shared/chapter'
import { classifyMediaFileName, isRemoteUrl } from '../../../shared/mediaFileTypes'

/** Subset of the preload `kizuna` bridge that orchestration needs. */
export interface PlayerBridge {
  media: {
    openFile(): Promise<string | undefined>
    enumerateTracks(filePath: string): Promise<Track[]>
    loadSubtitle(filePath: string, streamIndex: number): Promise<Cue[]>
    loadExternalSubtitle(subtitlePath: string, encoding?: SubtitleEncoding): Promise<Cue[]>
    readPlaylist?(filePath: string): Promise<string[]>
  }
  player: {
    load(path: string): Promise<unknown>
    setAudioTrack(aid: number): Promise<unknown>
    seek(seconds: number, absolute?: boolean): Promise<unknown>
    /**
     * Reads mpv's `track-list`. Only needed on the URL path, where ffprobe
     * never runs — optional so the many local-file fakes need not provide it.
     */
    getTrackList?(): Promise<Track[]>
  }
  mediaHistory: {
    getPlaybackHistory(path: string): Promise<MediaPlaybackHistory | undefined>
    setAudioTrack(path: string, track: StoredTrackSelection): Promise<void>
    setSubtitleTrack(path: string, selection: StoredSubtitleSelection): Promise<void>
  }
}

/** The media-history operations needed before opening a recent path. */
export interface RecentMediaBridge extends PlayerBridge {
  mediaHistory: PlayerBridge['mediaHistory'] & {
    checkFileAvailability(path: string): Promise<FileAvailability>
    removeRecentFile(path: string): Promise<unknown>
  }
}

export type Dispatch = (action: PlayerAction) => void

/**
 * Finds the current stream corresponding to a saved selection. An ID is used
 * only within the requested kind; otherwise stable stream metadata provides a
 * deterministic fallback when a remux changed stream indexes.
 */
export function matchStoredTrack(
  tracks: Track[],
  kind: Track['kind'],
  stored: StoredTrackSelection
): Track | undefined {
  const candidates = tracks.filter((track) => track.kind === kind)
  const idMatch = candidates.find((track) => track.id === stored.id)
  if (idMatch) return idMatch

  const language = comparableMetadata(stored.language)
  const title = comparableMetadata(stored.title)
  const codec = comparableMetadata(stored.codec)
  let best: Track | undefined
  let bestScore = 0

  for (const track of candidates) {
    const trackLanguage = comparableMetadata(track.language)
    if (language && trackLanguage !== language) continue

    let score = language ? 4 : 0
    if (title && comparableMetadata(track.title) === title) score += 2
    if (codec && comparableMetadata(track.codec) === codec) score += 1
    if (score > bestScore) {
      best = track
      bestScore = score
    }
  }
  return best
}

function comparableMetadata(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLocaleLowerCase('en-US')
  return normalized || undefined
}

/**
 * Shared mutable counter used to sequence subtitle-load requests. Subtitle
 * loads go through an async ffmpeg extraction, so two in-flight requests
 * (e.g. openAndLoad's auto-selected default racing a manual pick the user
 * makes before it resolves) can resolve out of request order. Every caller
 * bumps `current` when it starts and only applies its result if `current`
 * still matches — i.e. no newer request has started since. Callers should
 * share one token across openAndLoad/selectSubtitle calls for the same
 * player instance (App.tsx holds it in a ref); tests get a fresh default
 * token per call, which is equivalent to no guarding.
 */
export interface SubtitleRequestToken {
  current: number
}

/**
 * Typed outcome of `loadPath`/`openAndLoad`/`openRecentFile`, so App can show
 * accurate errors without parsing exceptions. `opened.warnings` collects
 * non-fatal audio/resume restoration failures that don't prevent the file
 * from playing. Subtitle extraction completes independently so it cannot
 * delay an otherwise successful open — its own non-fatal failure arrives
 * later, through `OpenWarningSink`, instead of in `warnings`.
 */
export type OpenMediaResult =
  | { status: 'cancelled' }
  | { status: 'opened'; filePath: string; warnings: string[] }
  | { status: 'missing'; filePath: string; message: string }
  | { status: 'failed'; filePath?: string; message: string }
  | { status: 'stale' }
  | { status: 'busy' }

/**
 * Receives a sanitized restoration warning that lands *after* the open result
 * resolved — today only subtitle restoration, which finishes independently of
 * the file opening (see `loadPath`). Only warnings for the file that is still
 * the current request are delivered; a superseded open reports nothing.
 */
export type OpenWarningSink = (message: string) => void

const noWarningSink: OpenWarningSink = () => {}

/**
 * Everything a file-open needs besides the path itself: the bridge and
 * dispatch it drives, the request tokens and cue cache shared across one
 * player instance (App.tsx holds them in refs), and where a late, non-fatal
 * restoration warning goes. Bundling them keeps the open pipeline's
 * signatures short instead of growing another positional parameter each time
 * a slice needs one more piece of per-player state.
 */
export interface OpenSession {
  bridge: PlayerBridge
  dispatch: Dispatch
  subtitleToken: SubtitleRequestToken
  cueCache: Map<number, Cue[]>
  fileToken: SubtitleRequestToken
  /** Encoding to use for a restored external subtitle that saved none. */
  externalSubtitleEncoding?: SubtitleEncoding
  onWarning?: OpenWarningSink
  /** Fires when "Open file…" (via openAndLoad) picks a path, with the entries
   * that pick replaces the queue with — a playlist's expanded entries, or the
   * single picked media file — before the pipeline loads entries[0]. */
  onPlaylistPicked?: (paths: string[]) => void
}

/**
 * Sanitizes a caught value into a short, user-facing message. Never surfaces
 * `err.stack` or an arbitrary `String(err)` of a non-Error thrown value —
 * both could leak internals into the UI.
 */
export function errorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message
  return 'Something went wrong.'
}

/**
 * Whether `path` should be probed with the filesystem-oriented tooling
 * (ffprobe track enumeration, video-dimension and chapter reads). Remote URLs
 * (Feature 9) return false: ffprobe can't read them, so their stream info comes
 * from mpv's `track-list` instead and their video-dimension/chapter probes are
 * skipped. Every renderer call site that probes branches on this.
 */
export function shouldProbe(path: string): boolean {
  return !isRemoteUrl(path)
}

/**
 * Enumerates `filePath`'s tracks, loads it into the player, and auto-loads
 * the default subtitle track (if any). The supplied path starts a new file
 * request immediately, before its first await.
 *
 * Only the default subtitle track is extracted while opening a file. Other
 * tracks are extracted on their first manual selection and then retained in
 * `cueCache` by `selectSubtitle`.
 *
 * Remote URLs skip ffprobe entirely: their audio streams are read from mpv's
 * `track-list` after the load, and embedded-subtitle extraction is skipped
 * (URL subtitles are out of scope — the subtitle sidebar stays empty).
 */
export async function loadPath(
  session: OpenSession,
  filePath: string,
  loadId?: number
): Promise<OpenMediaResult> {
  return runLoadPath(session, filePath, loadId)
}

async function runLoadPath(
  session: OpenSession,
  filePath: string,
  requestedLoadId?: number
): Promise<OpenMediaResult> {
  const { bridge, dispatch, cueCache, fileToken } = session
  const onWarning = session.onWarning ?? noWarningSink
  const loadId = requestedLoadId ?? ++fileToken.current
  const probe = shouldProbe(filePath)
  let tracks: Track[]
  let history: MediaPlaybackHistory | undefined
  try {
    ;[tracks, history] = await Promise.all([
      // ffprobe is filesystem-oriented; a URL's streams come from mpv below.
      // History is URL-safe (Feature 9 slice 1), so resume/track restore stays.
      probe ? bridge.media.enumerateTracks(filePath) : Promise.resolve<Track[]>([]),
      bridge.mediaHistory.getPlaybackHistory(filePath)
    ])
  } catch (err) {
    if (fileToken.current !== loadId) return { status: 'stale' }
    return { status: 'failed', filePath, message: errorMessage(err) }
  }
  if (fileToken.current !== loadId) return { status: 'stale' }

  try {
    await bridge.player.load(filePath)
  } catch (err) {
    if (fileToken.current !== loadId) return { status: 'stale' }
    // A URL load that rejects went through the controller's stop-and-reject
    // path (timeout or user Cancel), leaving mpv idle — or the stream simply
    // failed. Either way nothing is playing, so clear the previous file's
    // identity rather than leaving its tracks/cues on screen. Local failures
    // keep today's behavior (mpv may still hold the prior frame).
    if (!probe) dispatch({ type: 'mediaClosed' })
    return { status: 'failed', filePath, message: errorMessage(err) }
  }
  if (fileToken.current !== loadId) return { status: 'stale' }

  // URL path: mpv is now the only source of stream info. Read its track-list
  // and expose only the single audio stream mpv actually selected — yt-dlp
  // already paired it with the chosen video quality, so mpv's other audio
  // entries would offer switches that no-op or break the stream.
  // A malformed or absent list degrades to no tracks rather than throwing.
  if (!probe) {
    try {
      tracks = soleUrlAudioTrack((await bridge.player.getTrackList?.()) ?? [])
    } catch {
      tracks = []
    }
    if (fileToken.current !== loadId) return { status: 'stale' }
  }

  cueCache.clear()
  dispatch({ type: 'fileLoaded', filePath, tracks })

  // Subtitle extraction goes through ffmpeg and can take several seconds.
  // It must not keep the open action (and therefore the recent-files refresh
  // and menu's opening guard) pending after mpv has accepted the new file.
  // restoreSubtitle catches its own failure and remains gated by both request
  // tokens, so it is safe to finish independently in the background — its
  // warning reaches the caller through `onWarning` rather than `warnings`,
  // and the file token is re-checked at delivery so a warning from a
  // superseded open never reaches the file the user now has open. Skipped for
  // URLs, whose embedded subtitles ffmpeg cannot extract.
  if (probe) {
    void restoreSubtitle(session, filePath, { tracks, history }, loadId).then((warning) => {
      if (warning !== undefined && fileToken.current === loadId) onWarning(warning)
    })
  }
  const results = await Promise.all([
    restoreAudio(session, tracks, history, loadId),
    restoreResume(session, history, loadId)
  ])
  if (fileToken.current !== loadId) return { status: 'stale' }

  const warnings = results.filter((warning): warning is string => warning !== undefined)
  return { status: 'opened', filePath, warnings }
}

/**
 * Restores the file's saved audio track, if any. Reads its bridge, dispatch,
 * and file token from the open session; only the enumerated tracks, the
 * history entry, and this open's load id stay positional, since they belong to
 * one `loadPath` run rather than to the player instance.
 */
async function restoreAudio(
  session: OpenSession,
  tracks: Track[],
  history: MediaPlaybackHistory | undefined,
  loadId: number
): Promise<string | undefined> {
  const { bridge, dispatch, fileToken } = session
  if (!history?.audioTrack) return undefined
  const track = matchStoredTrack(tracks, 'audio', history.audioTrack)
  const defaultId = tracks.find((candidate) => candidate.kind === 'audio')?.id
  if (!track || track.id === defaultId) return undefined

  try {
    await bridge.player.setAudioTrack(track.id)
  } catch (err) {
    if (fileToken.current !== loadId) return undefined
    return errorMessage(err)
  }
  if (fileToken.current !== loadId) return undefined
  dispatch({ type: 'selectAudio', id: track.id })
  return undefined
}

/**
 * Restores the file's saved subtitle selection. Reads its bridge, dispatch,
 * subtitle/file tokens, cue cache, and external-subtitle encoding from the
 * open session; only the enumerated tracks and history (bundled, since they
 * always arrive together from `runLoadPath`'s probe) plus this open's file
 * path and load id stay positional.
 */
async function restoreSubtitle(
  session: OpenSession,
  filePath: string,
  fileInfo: { tracks: Track[]; history: MediaPlaybackHistory | undefined },
  loadId: number
): Promise<string | undefined> {
  const { bridge, dispatch, subtitleToken, cueCache, fileToken } = session
  const externalSubtitleEncoding = session.externalSubtitleEncoding ?? 'auto'
  const { tracks, history } = fileInfo
  const requestId = ++subtitleToken.current
  const superseded = (): boolean =>
    fileToken.current !== loadId || subtitleToken.current !== requestId

  // Restores an embedded stream: the saved track, else this file's default.
  // Also the fallback when a saved external file can no longer be read.
  const restoreEmbedded = async (sid: number | null): Promise<string | undefined> => {
    if (sid === null) return undefined
    try {
      const cues = await bridge.media.loadSubtitle(filePath, sid)
      if (superseded()) return undefined
      cueCache.set(sid, cues)
      dispatch({ type: 'cuesLoaded', cues })
      dispatch({ type: 'selectSubtitle', id: sid })
      return undefined
    } catch (err) {
      if (superseded()) return undefined
      dispatch({ type: 'cuesLoaded', cues: [] })
      dispatch({ type: 'selectSubtitle', id: null })
      return errorMessage(err)
    }
  }

  if (history?.subtitle?.mode === 'off') {
    if (superseded()) return undefined
    dispatch({ type: 'cuesLoaded', cues: [] })
    dispatch({ type: 'selectSubtitle', id: null })
    return undefined
  }

  if (history?.subtitle?.mode === 'external') {
    const subtitlePath = history.subtitle.path
    try {
      // Prefer the encoding persisted with the entry; otherwise honor the
      // encoding the caller passed for this open instead of forcing 'auto'.
      const encoding = history.subtitle.encoding ?? externalSubtitleEncoding
      const cues = await bridge.media.loadExternalSubtitle(subtitlePath, encoding)
      if (superseded()) return undefined
      const track = externalSubtitleTrack(subtitlePath, cues)
      cueCache.set(track.id, cues)
      dispatch({ type: 'externalSubtitleLoaded', path: subtitlePath, track, cues, encoding })
      return undefined
    } catch (err) {
      if (superseded()) return undefined
      // The sidecar moved, was deleted, or no longer parses. Fall back to the
      // file's own default stream rather than leaving it with no subtitles,
      // and let the caller surface why the saved one didn't come back.
      await restoreEmbedded(defaultSubtitleId(tracks))
      return errorMessage(err)
    }
  }

  const sid =
    history?.subtitle?.mode === 'track'
      ? (matchStoredTrack(tracks, 'subtitle', history.subtitle.track)?.id ??
        defaultSubtitleId(tracks))
      : defaultSubtitleId(tracks)
  return restoreEmbedded(sid)
}

/**
 * Applies the smart-resume seek (see `getResumePosition`) for a freshly
 * loaded file. No-ops (no seek) when there is no history or the saved
 * position doesn't clear the resume thresholds. Runs independently of
 * `restoreSubtitle`'s slower ffmpeg extraction — a stale success after a
 * newer file request began reports nothing, matching the other restore
 * branches' token gating. Takes its bridge and file token from the open
 * session, matching `restoreAudio`.
 */
async function restoreResume(
  session: OpenSession,
  history: MediaPlaybackHistory | undefined,
  loadId: number
): Promise<string | undefined> {
  const { bridge, fileToken } = session
  if (!history) return undefined
  const resumeAt = getResumePosition(history)
  if (resumeAt === undefined) return undefined

  try {
    await bridge.player.seek(resumeAt, true)
  } catch (err) {
    if (fileToken.current !== loadId) return undefined
    return errorMessage(err)
  }
  if (fileToken.current !== loadId) return undefined
  return undefined
}

/**
 * Opens a file picker and delegates a selected path to `loadPath`. Either kind
 * of pick replaces the queue via `onPlaylistPicked` first. Resolves
 * `{ status: 'cancelled' }` if the picker is cancelled. Current caller:
 * `recentFilesController.openViaPicker`.
 */
export async function openAndLoad(session: OpenSession): Promise<OpenMediaResult> {
  return runOpenAndLoad(session)
}

async function runOpenAndLoad(session: OpenSession): Promise<OpenMediaResult> {
  const filePath = await session.bridge.media.openFile()
  if (!filePath) return { status: 'cancelled' }
  if (classifyMediaFileName(filePath) === 'playlist') {
    return openPlaylistPick(session, filePath)
  }
  // A picked plain media file replaces the queue too, through the same seam as
  // the playlist branch: a one-path "playlist" so the stale queue can't keep
  // driving next/previous or EOF advance. Fired before loadPath, matching
  // openPlaylistPick's order.
  session.onPlaylistPicked?.([filePath])
  return loadPath(session, filePath)
}

/**
 * Expands a picked playlist path into its entries, replaces the queue via
 * `onPlaylistPicked`, and loads entry 0 — "Open file…" replaces what's
 * playing, unlike "Add files…"'s append semantics. `readPlaylist` is
 * optional-chained since it's optional on `PlayerBridge` (many test fakes
 * omit it), which this treats the same as an empty playlist.
 */
async function openPlaylistPick(session: OpenSession, filePath: string): Promise<OpenMediaResult> {
  const entries = (await session.bridge.media.readPlaylist?.(filePath)) ?? []
  if (entries.length === 0) {
    return { status: 'failed', filePath, message: 'Playlist is empty or unreadable.' }
  }
  session.onPlaylistPicked?.(entries)
  return loadPath(session, entries[0])
}

/**
 * Checks a recent path before opening it. Confirmed-missing paths are removed
 * from recents; transient availability errors leave the shortcut intact.
 */
export async function openRecentFile(
  session: OpenSession & { bridge: RecentMediaBridge },
  filePath: string
): Promise<OpenMediaResult> {
  return runOpenRecentFile(session, filePath)
}

async function runOpenRecentFile(
  session: OpenSession & { bridge: RecentMediaBridge },
  filePath: string
): Promise<OpenMediaResult> {
  const { bridge, fileToken } = session
  const loadId = ++fileToken.current
  let availability: FileAvailability
  try {
    availability = await bridge.mediaHistory.checkFileAvailability(filePath)
  } catch (err) {
    if (fileToken.current !== loadId) return { status: 'stale' }
    return { status: 'failed', filePath, message: errorMessage(err) }
  }
  if (fileToken.current !== loadId) return { status: 'stale' }

  if (availability.status === 'missing') {
    await bridge.mediaHistory.removeRecentFile(filePath)
    return { status: 'missing', filePath, message: 'This file could no longer be found.' }
  }
  if (availability.status === 'error') {
    return { status: 'failed', filePath, message: availability.message }
  }

  return loadPath(session, filePath, loadId)
}

/**
 * Switches the active audio track in mpv, reflects it in state, then persists
 * the descriptor as the file's manually-chosen audio track. A persistence
 * failure is reported as a sanitized warning string but does not roll back
 * the already-applied player selection; a player failure still rejects
 * (nothing was applied, so nothing to persist).
 */
export async function selectAudio(
  bridge: PlayerBridge,
  dispatch: Dispatch,
  filePath: string,
  track: Track
): Promise<string | undefined> {
  await bridge.player.setAudioTrack(track.id)
  dispatch({ type: 'selectAudio', id: track.id })
  return persistTrackSelection(bridge, filePath, track)
}

async function persistTrackSelection(
  bridge: PlayerBridge,
  filePath: string,
  track: Track
): Promise<string | undefined> {
  const descriptor = createStoredTrackSelection(track)
  if (!descriptor) return undefined
  try {
    await bridge.mediaHistory.setAudioTrack(filePath, descriptor)
    return undefined
  } catch (err) {
    return errorMessage(err)
  }
}

/**
 * Switches the active subtitle track. `track === null` turns subtitles off
 * (clears cues, no ffmpeg extraction); otherwise loads and dispatches the
 * new track's cues. `subtitleToken` should be the same token passed to
 * `openAndLoad` for this player instance, so an in-flight auto-selected
 * default load can't clobber (or be clobbered by) this manual pick — see
 * `SubtitleRequestToken`.
 *
 * `cueCache` should also be shared with `openAndLoad` for this player
 * instance (App.tsx holds it in a ref, cleared by `openAndLoad` on every new
 * file). A track already extracted once for the current file is served from
 * the cache instead of re-running ffmpeg, so switching back to a
 * previously-picked track is instant rather than repeating the extraction.
 *
 * On success (real, cached, or Off) the selection is persisted as the file's
 * manually-chosen subtitle. A stale (superseded) extraction persists nothing.
 * A persistence failure is reported as a sanitized warning string but leaves
 * the already-applied selection visible; an extraction failure still rejects.
 *
 * `externalSubtitlePath` is the sidecar file the synthetic external track
 * stands for (App passes `state.externalSubtitlePath`); it is what re-picking
 * that track from the menu persists, since the track itself carries no stream
 * index to store.
 */
export async function selectSubtitle(
  bridge: PlayerBridge,
  dispatch: Dispatch,
  filePath: string,
  track: Track | null,
  subtitleToken: SubtitleRequestToken = { current: 0 },
  cueCache: Map<number, Cue[]> = new Map(),
  externalSubtitlePath?: string,
  externalSubtitleEncoding: SubtitleEncoding = 'auto'
): Promise<string | undefined> {
  const requestId = ++subtitleToken.current

  if (track === null) {
    dispatch({ type: 'cuesLoaded', cues: [] })
    dispatch({ type: 'selectSubtitle', id: null })
    return persistSubtitleSelection(bridge, filePath, { mode: 'off' })
  }

  const cached = cueCache.get(track.id)
  if (cached) {
    dispatch({ type: 'cuesLoaded', cues: cached })
    dispatch({ type: 'selectSubtitle', id: track.id })
    return persistSubtitleTrack(
      bridge,
      filePath,
      track,
      externalSubtitlePath,
      externalSubtitleEncoding
    )
  }

  const cues = await bridge.media.loadSubtitle(filePath, track.id)
  if (subtitleToken.current !== requestId) return undefined
  cueCache.set(track.id, cues)
  dispatch({ type: 'cuesLoaded', cues })
  dispatch({ type: 'selectSubtitle', id: track.id })
  return persistSubtitleTrack(
    bridge,
    filePath,
    track,
    externalSubtitlePath,
    externalSubtitleEncoding
  )
}

/**
 * Persists a chosen subtitle track. The synthetic external-file track has no
 * stream index to store (`createStoredTrackSelection` rejects its negative
 * id), so it is persisted as `{ mode: 'external', path }` instead — and only
 * when the sidecar's path is known. Persisting it without one would fall
 * through to `{ mode: 'off' }` and silently turn subtitles off on reopen.
 */
async function persistSubtitleTrack(
  bridge: PlayerBridge,
  filePath: string,
  track: Track,
  externalSubtitlePath?: string,
  externalSubtitleEncoding: SubtitleEncoding = 'auto'
): Promise<string | undefined> {
  if (track.id === EXTERNAL_SUBTITLE_TRACK_ID) {
    if (!externalSubtitlePath) return undefined
    return persistSubtitleSelection(bridge, filePath, {
      mode: 'external',
      path: externalSubtitlePath,
      encoding: externalSubtitleEncoding
    })
  }
  return persistSubtitleSelection(bridge, filePath, subtitleSelection(track))
}

function subtitleSelection(track: Track): StoredSubtitleSelection {
  const descriptor = createStoredTrackSelection(track)
  return descriptor ? { mode: 'track', track: descriptor } : { mode: 'off' }
}

/** Kana, kanji (CJK unified ideographs), and CJK extension A. */
const JAPANESE_CHARACTER_RE = /[぀-ヿ㐀-䶿一-鿿]/

/** True when evenly distributed cue samples contain kana or kanji. */
export function detectJapaneseCues(cues: Cue[], sampleSize = 50): boolean {
  if (cues.length === 0 || sampleSize <= 0) return false

  const count = Math.min(50, Math.floor(sampleSize), cues.length)
  if (count <= 0) return false
  if (count === 1) return JAPANESE_CHARACTER_RE.test(cues[0].text)

  const indices = new Set<number>()
  for (let sample = 0; sample < count; sample += 1) {
    indices.add(Math.round((sample * (cues.length - 1)) / (count - 1)))
  }
  for (const index of indices) {
    if (JAPANESE_CHARACTER_RE.test(cues[index].text)) return true
  }
  return false
}

/**
 * Builds the synthetic `Track` standing in for an external subtitle file in
 * the Subtitle menu and in state. Its `language` is set to 'jpn' only when the
 * cues actually look Japanese — that is what drives MeCab tokenization and
 * knowledge coloring through `isJapaneseSubtitleTrack`, so an English sidecar
 * must leave it undefined.
 */
export function externalSubtitleTrack(subtitlePath: string, cues: Cue[]): Track {
  const codec = subtitlePath.split('.').pop()?.toLowerCase() ?? ''
  return {
    id: EXTERNAL_SUBTITLE_TRACK_ID,
    kind: 'subtitle',
    codec,
    title: mediaFileBasename(subtitlePath),
    ...(detectJapaneseCues(cues) ? { language: 'jpn' } : {})
  }
}

/**
 * Builds the synthetic `Track` standing in for an acquired online (yt-dlp URL)
 * subtitle track. Like `externalSubtitleTrack` its
 * `language` is set to 'jpn' only when the cues actually look Japanese — that
 * is what drives MeCab tokenization and knowledge coloring through
 * `isJapaneseSubtitleTrack`. Session-only: it never reaches `MediaHistory`.
 */
export function onlineSubtitleTrack(cues: Cue[]): Track {
  return {
    id: URL_SUBTITLE_TRACK_ID,
    kind: 'subtitle',
    codec: 'online',
    title: 'Online subtitle',
    ...(detectJapaneseCues(cues) ? { language: 'jpn' } : {})
  }
}

/**
 * Loads a standalone subtitle file (drag-and-drop, or the Subtitle menu's
 * picker) and makes it the active subtitle track of the video at `filePath`.
 * Token-guarded exactly like `selectSubtitle`, and seeds `cueCache` under the
 * synthetic track id so re-selecting the file from the menu doesn't re-read
 * it. The sidecar is then persisted as the video's subtitle selection, so
 * reopening the video brings it back (see `restoreSubtitle`). Never throws:
 * resolves a sanitized warning for the caller to surface — from a failed read
 * (having dispatched nothing) or a failed persist (selection still applied) —
 * or undefined on success.
 */
export async function loadExternalSubtitle(
  session: OpenSession,
  filePath: string,
  subtitlePath: string
): Promise<string | undefined> {
  return runLoadExternalSubtitle(session, filePath, subtitlePath)
}

async function runLoadExternalSubtitle(
  session: OpenSession,
  filePath: string,
  subtitlePath: string
): Promise<string | undefined> {
  const { bridge, dispatch, subtitleToken, cueCache } = session
  const externalSubtitleEncoding = session.externalSubtitleEncoding ?? 'auto'
  const requestId = ++subtitleToken.current

  let cues: Cue[]
  try {
    cues = await bridge.media.loadExternalSubtitle(subtitlePath, externalSubtitleEncoding)
  } catch (err) {
    if (subtitleToken.current !== requestId) return undefined
    return errorMessage(err)
  }
  if (subtitleToken.current !== requestId) return undefined

  const track = externalSubtitleTrack(subtitlePath, cues)
  cueCache.set(track.id, cues)
  dispatch({
    type: 'externalSubtitleLoaded',
    path: subtitlePath,
    track,
    cues,
    encoding: externalSubtitleEncoding
  })
  return persistSubtitleSelection(bridge, filePath, {
    mode: 'external',
    path: subtitlePath,
    encoding: externalSubtitleEncoding
  })
}

async function persistSubtitleSelection(
  bridge: PlayerBridge,
  filePath: string,
  selection: StoredSubtitleSelection
): Promise<string | undefined> {
  try {
    await bridge.mediaHistory.setSubtitleTrack(filePath, selection)
    return undefined
  } catch (err) {
    return errorMessage(err)
  }
}

/** Subset of the preload `kizuna.mecab` bridge that tokenizeActiveCue needs. */
export interface MecabBridge {
  tokenize(text: string): Promise<Token[]>
}

/** Stable identity for a cue, used both as a cache key and to detect that the
 * active cue changed (vs. the same cue still being active on a later tick). */
export function cueKey(cue: Cue): string {
  return `${cue.start}|${cue.end}|${cue.text}`
}

/**
 * Tokenizes the currently-active cue via MeCab, lazily and with caching: a
 * cue already tokenized (by `cueKey`) is served from `cache` without calling
 * the bridge again, so scrubbing back to a previously-active cue is free.
 * `tokenizeToken` guards against stale resolutions the same way
 * `SubtitleRequestToken` guards subtitle loads — the caller (App.tsx) should
 * share one instance across calls for the same player instance.
 */
export async function tokenizeActiveCue(
  bridge: MecabBridge,
  dispatch: Dispatch,
  cue: Cue | undefined,
  cache: Map<string, Token[]>,
  tokenizeToken: SubtitleRequestToken = { current: 0 }
): Promise<Token[]> {
  if (!cue) {
    dispatch({ type: 'activeTokensLoaded', tokens: [] })
    return []
  }

  const key = cueKey(cue)
  const cached = cache.get(key)
  if (cached) {
    dispatch({ type: 'activeTokensLoaded', tokens: cached })
    return cached
  }

  // Cache miss: clear stale tokens from the previously-active cue synchronously
  // (before awaiting the bridge) so SubtitleOverlay falls back to this cue's
  // plain text while tokenizing is in flight, instead of rendering leftover
  // token spans from whatever cue was active before.
  dispatch({ type: 'activeTokensLoaded', tokens: [] })

  const requestId = ++tokenizeToken.current
  const tokens = await bridge.tokenize(cue.text)
  // Stale: don't dispatch, and return [] rather than these (now-superseded)
  // tokens so a chained caller (e.g. resolveKnownLevels in App.tsx) treats
  // this resolution as a no-op too, instead of resolving levels for a cue
  // that's no longer active.
  if (tokenizeToken.current !== requestId) return []
  cache.set(key, tokens)
  dispatch({ type: 'activeTokensLoaded', tokens })
  return tokens
}

/** Subset of the preload `kizuna.knowledge` bridge that resolveKnownLevels needs. */
export interface KnowledgeBridge {
  levelsFor(lemmas: string[]): Promise<Record<string, KnowledgeLevel>>
}

/**
 * Resolves knowledge levels (unknown/inDeck/learning/known/wellKnown) for a cue's
 * tokens, lazily and with caching — the same shape as `tokenizeActiveCue`.
 * Only lemmas not already present in `cache` are queried, together with each
 * distinct surface that differs from its lemma. A cue repeating a word costs
 * one lookup per distinct key; already-cached lemmas are simply
 * skipped, since `cache` and the reducer's `knownLevels` accumulate over the
 * whole episode rather than resetting per cue (unlike `activeTokens`). If
 * every lemma is already cached (or `tokens` is empty), this is a no-op: no
 * bridge call, no dispatch. `requestToken` guards against a stale resolution
 * the same way `tokenizeActiveCue`'s does — the caller (App.tsx) should share
 * one instance across calls for the same player instance.
 */
export async function resolveKnownLevels(
  bridge: KnowledgeBridge,
  dispatch: Dispatch,
  tokens: Token[],
  cache: Map<string, KnowledgeLevel>,
  requestToken: SubtitleRequestToken = { current: 0 }
): Promise<void> {
  const newTokens = tokens.filter((token) => !cache.has(token.lemma))
  const newLemmas = [...new Set(newTokens.map((token) => token.lemma))]
  if (newLemmas.length === 0) return

  const queryKeys = [
    ...new Set(
      newTokens.flatMap((token) =>
        token.surface === token.lemma ? [token.lemma] : [token.lemma, token.surface]
      )
    )
  ]

  const requestId = ++requestToken.current
  const levels = await bridge.levelsFor(queryKeys)
  if (requestToken.current !== requestId) return

  // The database returns rows only for known lemmas. Cache omitted rows as
  // unknown too, otherwise every visit to an unknown word repeats the lookup.
  const resolved = Object.fromEntries(
    newLemmas.map((lemma) => {
      const surfaces = newTokens
        .filter((token) => token.lemma === lemma)
        .map((token) => token.surface)
      const level = surfaces.reduce<KnowledgeLevel>(
        (current, surface) => maxKnowledgeLevel(current, levels[surface] ?? 'unknown'),
        levels[lemma] ?? 'unknown'
      )
      return [lemma, level] as const
    })
  ) as Record<string, KnowledgeLevel>
  for (const [lemma, level] of Object.entries(resolved)) cache.set(lemma, level)
  dispatch({ type: 'knownLevelsLoaded', levels: resolved })
}

/** Subset of the preload `kizuna.mecab` bridge that tokenizeAllCues needs. */
export interface MecabBatchBridge {
  tokenizeBatch(texts: string[]): Promise<Token[][]>
}

/**
 * Tokenizes *every* cue of a track (for the subtitle sidebar's per-word
 * coloring), reusing the same per-cue `tokenCache` (keyed by `cueKey`) that
 * `tokenizeActiveCue` warms — so cues already tokenized while playing are not
 * re-sent to MeCab. Only the cache-miss cues are batch-tokenized in one bridge
 * round-trip (`tokenizeBatch`). Dispatches `allCueTokensLoaded` with the full
 * `cueKey -> Token[]` map, then resolves knowledge levels for every lemma in
 * the track via the shared `resolveKnownLevels` primitive (which itself only
 * queries lemmas missing from `knownLevelsCache`). `requestToken` guards
 * against a stale resolution the same way the other orchestration functions do
 * — if the track changes mid-flight, the superseded call neither dispatches nor
 * resolves levels. Returns the complete snapshot used for a current request;
 * a stale request returns `undefined`. No-op (empty dispatch) for an empty cue
 * list.
 */
export async function tokenizeAllCues(
  mecab: MecabBatchBridge,
  knowledge: KnowledgeBridge,
  dispatch: Dispatch,
  cues: Cue[],
  tokenCache: Map<string, Token[]>,
  knownLevelsCache: Map<string, KnowledgeLevel>,
  requestToken: SubtitleRequestToken = { current: 0 },
  levelsToken: SubtitleRequestToken = { current: 0 }
): Promise<Record<string, Token[]> | undefined> {
  const requestId = ++requestToken.current

  const missing = cues.filter((cue) => !tokenCache.has(cueKey(cue)))
  if (missing.length > 0) {
    const batches = await mecab.tokenizeBatch(missing.map((cue) => cue.text))
    // A newer request started while MeCab was running: discard this result
    // rather than writing a superseded track's tokens into state.
    if (requestToken.current !== requestId) return undefined
    missing.forEach((cue, i) => tokenCache.set(cueKey(cue), batches[i] ?? []))
  }

  const allTokens: Record<string, Token[]> = {}
  for (const cue of cues) {
    allTokens[cueKey(cue)] = tokenCache.get(cueKey(cue)) ?? []
  }
  dispatch({ type: 'allCueTokensLoaded', tokens: allTokens })

  const everyToken = cues.flatMap((cue) => tokenCache.get(cueKey(cue)) ?? [])
  await resolveKnownLevels(knowledge, dispatch, everyToken, knownLevelsCache, levelsToken)
  return allTokens
}

/**
 * Pure: the absolute playback time (seconds) to seek to so that `cue` becomes
 * the active/displayed cue under the current subtitle offset. The overlay
 * looks up the active cue at `offsetTimePos(timePos, offsetMs) = timePos -
 * offsetMs/1000`, so seeking to `cue.start + offsetMs/1000` lands playback
 * exactly at the cue's start once the offset is undone — keeping the sidebar's
 * click-to-seek consistent with the highlighted row.
 */
export function seekTargetForCue(cue: Cue, offsetMs: number): number {
  return cue.start + offsetMs / 1000
}

/** Anchor position (viewport px) the word popup renders near. */
export interface WordPopupPosition {
  x: number
  y: number
}

/**
 * Pure: computes the word popup's anchor position. Prefers the subtitle
 * box's own rect (so the popup anchors above the whole subtitle line,
 * staying stable across every token in it) and falls back to the
 * triggering mouse event's coordinates when the box isn't available, then
 * to {0,0} when neither is (e.g. hover fired with no event).
 */
export function wordPopupPosition(
  subtitleRect: { left: number; top: number; width: number } | undefined,
  event?: { clientX: number; clientY: number }
): WordPopupPosition {
  if (subtitleRect) return { x: subtitleRect.left + subtitleRect.width / 2, y: subtitleRect.top }
  if (event) return { x: event.clientX, y: event.clientY }
  return { x: 0, y: 0 }
}

/** Subset of the preload `kizuna.dict` bridge that lookupWordPopup needs. */
export interface DictLookupBridge {
  lookup(
    lemma: string,
    reading?: string,
    freqDictId?: number | null,
    sortMode?: FrequencyMode,
    longestMatchCandidates?: string[],
    surface?: string
  ): Promise<LookupResult[]>
}

/** The complete, serializable input to one dictionary lookup. */
export interface WordLookupRequest {
  lemma: string
  reading: string | undefined
  frequencyDictId: number | null
  sortMode: FrequencyMode | undefined
  longestMatchCandidates: string[] | undefined
  surface: string
}

/**
 * Builds longest-match compound candidates for a clicked/hovered token,
 * given the full token list for the cue it belongs to. MeCab segments purely
 * by its own grammar rules, so a dictionary headword that's a compound of
 * several MeCab tokens (e.g. 閻魔大王 segmented as 閻魔/大王) is invisible to a
 * lookup keyed on just `clickedToken`'s own lemma. Returns merged-surface
 * strings and, for multi-token spans whose final token is inflected, a
 * final-token lemma variant. Both start at `clickedToken`, longest (up to
 * `maxTokens`) down to the clicked token itself. It then appends shorter prefixes within the
 * clicked token, longest first. `Array.from` keeps those prefixes on Unicode
 * code-point boundaries, so supplementary characters are never split. This
 * lets a dictionary entry such as `閻` be found when MeCab emits `閻魔`.
 * Returns `[]` if `clickedToken` isn't found in `cueTokens` (matched by
 * `startOffset`, which is unique within a cue).
 */
export function buildLongestMatchCandidates(
  cueTokens: Token[],
  clickedToken: Token,
  maxTokens = 8
): string[] {
  const startIndex = cueTokens.findIndex((t) => t.startOffset === clickedToken.startOffset)
  if (startIndex === -1) return []

  const endIndex = Math.min(cueTokens.length, startIndex + maxTokens)
  const candidates = new Set<string>()
  for (let end = endIndex; end > startIndex; end--) {
    const spanTokens = cueTokens.slice(startIndex, end)
    candidates.add(spanTokens.map((token) => token.surface).join(''))
    if (spanTokens.length > 1) {
      const last = spanTokens[spanTokens.length - 1]
      if (last.lemma !== '' && last.lemma !== last.surface) {
        candidates.add(
          spanTokens
            .slice(0, -1)
            .map((token) => token.surface)
            .join('') + last.lemma
        )
      }
    }
  }

  // Internal prefixes only hold up as plausible word boundaries when the
  // surface's conjugated tail beyond the lemma is short (e.g. 食べた's -た,
  // or 良かろう's archaic -かろう). A heavily conjugated form like
  // 行きたければ (lemma 行く, four characters of tail beyond it) doesn't trim
  // down to real word boundaries -- 行き, 行 are just fragments of the
  // conjugation and must not outrank the complete surface or the MeCab lemma
  // in the popup.
  const codePoints = Array.from(clickedToken.surface)
  const lemmaLength = Array.from(clickedToken.lemma).length
  if (codePoints.length - lemmaLength <= 2) {
    for (let length = codePoints.length - 1; length > 0; length--) {
      candidates.add(codePoints.slice(0, length).join(''))
    }
  }
  return [...candidates]
}

/** Builds the dictionary request shared by popup and whole-track lookups. */
export function buildWordLookupRequest(
  token: Token,
  freqDictId: number | null,
  sortOrder: 'auto' | FrequencyMode | undefined,
  cueTokens: Token[] = []
): WordLookupRequest {
  const compoundCandidates = buildLongestMatchCandidates(cueTokens, token)
  const candidates =
    token.surface !== token.lemma && !compoundCandidates.includes(token.surface)
      ? [...compoundCandidates, token.surface]
      : compoundCandidates
  return {
    lemma: token.lemma,
    reading: token.reading || undefined,
    frequencyDictId: freqDictId,
    sortMode: sortOrder && sortOrder !== 'auto' ? sortOrder : undefined,
    longestMatchCandidates: candidates.length > 0 ? candidates : undefined,
    surface: token.surface
  }
}

/** Performs a previously built dictionary request. */
export function lookupWord(
  bridge: DictLookupBridge,
  request: WordLookupRequest
): Promise<LookupResult[]> {
  return bridge.lookup(
    request.lemma,
    request.reading,
    request.frequencyDictId,
    request.sortMode,
    request.longestMatchCandidates,
    request.surface
  )
}

/**
 * Given the resolved `expression` a lookup matched on (e.g. `results[0].expression`),
 * finds the contiguous run of tokens starting at `clickedToken` whose
 * concatenated surface or lemmas equal it — so the UI can visually highlight the same
 * compound the popup's content actually describes (e.g. highlight both 閻魔
 * and 大王 when the popup is showing the 閻魔大王 entry, even though the click
 * landed on the 閻魔 token alone). Falls back to `[clickedToken]` when
 * `expression` doesn't correspond to any prefix run of `cueTokens`' surfaces
 * — the ordinary case where the match came from `token.lemma` itself (with or
 * without deinflection), not a `buildLongestMatchCandidates` compound hit.
 */
export function matchedTokenSpan(
  cueTokens: Token[],
  clickedToken: Token,
  expression: string
): Token[] {
  const startIndex = cueTokens.findIndex((t) => t.startOffset === clickedToken.startOffset)
  if (startIndex === -1) return [clickedToken]

  let mergedSurface = ''
  let mergedLemma = ''
  for (let end = startIndex; end < cueTokens.length; end++) {
    mergedSurface += cueTokens[end].surface
    mergedLemma += cueTokens[end].lemma
    if (mergedSurface === expression || mergedLemma === expression) {
      return cueTokens.slice(startIndex, end + 1)
    }
    if (mergedSurface.length >= expression.length && mergedLemma.length >= expression.length) break
  }
  return [clickedToken]
}

const INFLECTION_CONTINUATIONS = new Set(['て', 'で', 'ば', 'たり', 'だり', 'そう'])

/** Resolves the subtitle span described by a popup result, including split inflections. */
export function resolvePopupHighlightSpan(
  cueTokens: Token[],
  clickedToken: Token,
  result: Pick<LookupResult, 'expression' | 'matchedSurface'>
): Token[] {
  if (result.matchedSurface) {
    const matched = matchedTokenSpan(cueTokens, clickedToken, result.matchedSurface)
    if (matched.length > 1 || matched[0]?.surface === result.matchedSurface) return matched
  }

  const exact = matchedTokenSpan(cueTokens, clickedToken, result.expression)
  if (exact.length > 1) {
    if (exact.map((token) => token.surface).join('') === result.expression) return exact
    const endIndex = cueTokens.findIndex((token) => token.startOffset === exact.at(-1)?.startOffset)
    const extended = [...exact]
    for (let index = endIndex + 1; index < cueTokens.length; index++) {
      const token = cueTokens[index]
      if (!token.pos.includes('助動詞') && !INFLECTION_CONTINUATIONS.has(token.surface)) break
      extended.push(token)
    }
    return extended
  }
  if (result.expression === clickedToken.surface || result.expression === clickedToken.lemma)
    return exact

  const startIndex = cueTokens.findIndex((token) => token.startOffset === clickedToken.startOffset)
  if (startIndex === -1) return [clickedToken]

  const span = [clickedToken]
  let surface = clickedToken.surface
  let diverged = !result.expression.startsWith(surface)
  let inflectionClosed = false
  let addedMainVerbs = 0
  for (let index = startIndex + 1; index < cueTokens.length; index++) {
    const token = cueTokens[index]
    const nextSurface = surface + token.surface
    const isVerb = token.pos.includes('動詞') && !token.pos.includes('助動詞')
    const isSuffix = token.pos.includes('助動詞') || INFLECTION_CONTINUATIONS.has(token.surface)
    if (!diverged && result.expression.startsWith(nextSurface)) {
      if (isVerb && addedMainVerbs >= 1) break
      span.push(token)
      surface = nextSurface
      if (isVerb) addedMainVerbs++
      continue
    }

    const continuesInflection = isSuffix || (isVerb && !inflectionClosed && addedMainVerbs < 1)
    if (!continuesInflection) break

    span.push(token)
    surface = nextSurface
    diverged = true
    if (isVerb) addedMainVerbs++
    if (isSuffix) inflectionClosed = true
  }
  return span
}

/**
 * Looks up `token`'s dictionary entries and resolves the popup payload
 * (results + the already-computed anchor position + which tokens to visually
 * highlight) for the caller to store in state. Shared by both App.tsx's
 * hover-settle callback and its click handler, so both paths open the same
 * popup shape. `sortOrder: 'auto'` (or omitted) forwards no override, so the
 * main-process lookup falls back to the frequency dictionary's own
 * rank-based/occurrence-based mode. `cueTokens` (the full token list for the
 * active cue, if available) is used both to build longest-match compound
 * candidates (`buildLongestMatchCandidates`) and, once results come back, to
 * resolve `highlightedTokens` (`matchedTokenSpan`) — so the highlighted span
 * always matches whichever word the popup ends up displaying.
 */
export async function lookupWordPopup(
  bridge: DictLookupBridge,
  token: Token,
  position: WordPopupPosition,
  freqDictId: number | null,
  sortOrder?: 'auto' | FrequencyMode,
  cueTokens: Token[] = []
): Promise<{ results: LookupResult[]; position: WordPopupPosition; highlightedTokens: Token[] }> {
  const results = await lookupWord(
    bridge,
    buildWordLookupRequest(token, freqDictId, sortOrder, cueTokens)
  )
  const highlightedTokens =
    results.length > 0 ? resolvePopupHighlightSpan(cueTokens, token, results[0]) : [token]
  return { results, position, highlightedTokens }
}

/**
 * Looks up a glossary cross-reference link's target term directly (see
 * WordPopup.tsx's `onLinkClick`/`parseInternalLinkQuery`) — unlike
 * `lookupWordPopup`, `expression` isn't a subtitle `Token`, so there are no
 * `cueTokens` to build longest-match candidates from or highlight; it's
 * looked up as-is, same as a single-token `lookup()` fallback.
 */
export async function lookupLinkedWord(
  bridge: DictLookupBridge,
  expression: string,
  freqDictId: number | null,
  sortOrder?: 'auto' | FrequencyMode
): Promise<LookupResult[]> {
  return bridge.lookup(
    expression,
    undefined,
    freqDictId,
    sortOrder && sortOrder !== 'auto' ? sortOrder : undefined
  )
}

/**
 * Looks up the stored subtitle offset (ms) for `filePath`: the file's own
 * `subtitleOffsets` entry wins; otherwise its folder's `folderSubtitleOffsets`
 * entry (set by `applySubtitleOffsetToFolder`) applies; otherwise 0 (no
 * offset). Keys are canonicalized with `subtitleOffsetKey` /
 * `subtitleOffsetFolderKey`, so the same file found via the picker and via
 * recent files (which stores lowercase paths on win32) resolves to one entry.
 */
export function subtitleOffsetForFile(
  offsets: Record<string, number>,
  folderOffsets: Record<string, number>,
  filePath: string
): number {
  const fileOffset = offsets[subtitleOffsetKey(filePath)]
  if (fileOffset !== undefined) return fileOffset
  return folderOffsets[subtitleOffsetFolderKey(filePath)] ?? 0
}

/**
 * Pure: the result of "apply this offset to every video in `filePath`'s
 * folder". Stores `offsetMs` under the folder's key and drops every per-file
 * entry in that same folder — those would otherwise shadow the folder value
 * (see `subtitleOffsetForFile`), so dropping them is what makes the new offset
 * reach files that already had one of their own. Only the immediate folder is
 * affected: entries in subfolders keep their own offsets. Inputs are left
 * untouched; a `filePath` with no folder component (no separator) is a no-op
 * and returns the maps as they were.
 */
export function applySubtitleOffsetToFolder(
  offsets: Record<string, number>,
  folderOffsets: Record<string, number>,
  filePath: string,
  offsetMs: number
): { subtitleOffsets: Record<string, number>; folderSubtitleOffsets: Record<string, number> } {
  const folderKey = subtitleOffsetFolderKey(filePath)
  if (folderKey === '') return { subtitleOffsets: offsets, folderSubtitleOffsets: folderOffsets }

  const subtitleOffsets = Object.fromEntries(
    Object.entries(offsets).filter(([key]) => subtitleOffsetFolderKey(key) !== folderKey)
  )
  return {
    subtitleOffsets,
    folderSubtitleOffsets: { ...folderOffsets, [folderKey]: offsetMs }
  }
}

/**
 * Pure: returns a new offsets map with `filePath`'s entry set to `offsetMs`,
 * leaving every other file's stored offset untouched. Used both to update the
 * in-memory map App.tsx holds and to build the patch persisted via
 * `playerSettings.setSettings`. The entry is written under the canonical
 * `subtitleOffsetKey(filePath)`, matching `subtitleOffsetForFile`'s lookup.
 */
export function nextSubtitleOffsets(
  offsets: Record<string, number>,
  filePath: string,
  offsetMs: number
): Record<string, number> {
  return { ...offsets, [subtitleOffsetKey(filePath)]: offsetMs }
}

/**
 * Looks up the stored audio delay (ms) for `filePath`, 0 when unset. Keys are
 * canonicalized with `subtitleOffsetKey` (a generic lexical path canonicalizer
 * despite its name — reused so the same file found via the picker and via
 * recent files resolves to one entry), matching `nextAudioDelays`' write.
 */
export function audioDelayForFile(delays: Record<string, number>, filePath: string): number {
  return delays[subtitleOffsetKey(filePath)] ?? 0
}

/**
 * Pure: returns a new delays map with `filePath`'s entry set to `delayMs`,
 * leaving every other file's stored delay untouched. Written under the
 * canonical `subtitleOffsetKey(filePath)`, matching `audioDelayForFile`'s
 * lookup. Twin of `nextSubtitleOffsets`.
 */
export function nextAudioDelays(
  delays: Record<string, number>,
  filePath: string,
  delayMs: number
): Record<string, number> {
  return { ...delays, [subtitleOffsetKey(filePath)]: delayMs }
}

/** Seconds of lead-in/lead-out kept around a mined line, so the clip does not
 * clip the speaker's first or last mora. */
export const SENTENCE_AUDIO_PAD_SEC = 0.25
/** Hard ceiling on one mined clip, guarding against a pathological cue that
 * spans minutes of the file. */
export const SENTENCE_AUDIO_MAX_SEC = 60

/**
 * Pure: converts a subtitle cue into the media-clock window its audio should be
 * clipped from. The overlay shows `cue` at `cue.start - offsetMs/1000` on the
 * media clock (see `seekTargetForCue`), so the audio actually belongs at
 * `cue.start + offsetMs/1000` — this undoes a user-applied subtitle offset
 * without touching subtitle timing anywhere else. `SENTENCE_AUDIO_PAD_SEC` is
 * added on both sides, the start is clamped to zero, and the clip is capped at
 * `SENTENCE_AUDIO_MAX_SEC`. Returns `null` for missing, non-finite, or inverted
 * timing — the mine then simply carries no sentence audio.
 */
export function sentenceAudioWindow(
  cue: { start: number; end: number },
  subtitleOffsetMs: number
): { startSec: number; endSec: number } | null {
  const offsetSec = subtitleOffsetMs / 1000
  if (!Number.isFinite(cue.start) || !Number.isFinite(cue.end) || !Number.isFinite(offsetSec)) {
    return null
  }
  if (cue.end < cue.start) return null

  const startSec = Math.max(0, cue.start + offsetSec - SENTENCE_AUDIO_PAD_SEC)
  const endSec = Math.min(
    cue.end + offsetSec + SENTENCE_AUDIO_PAD_SEC,
    startSec + SENTENCE_AUDIO_MAX_SEC
  )
  return endSec > startSec ? { startSec, endSec } : null
}

/**
 * What the renderer knows about the currently-loaded media when a mine starts.
 * Threaded explicitly (rather than read from a module-level store) so both the
 * popup and bulk paths form their context the same way and stay testable.
 */
export interface MineMediaSource {
  /** Loaded media path. Undefined when nothing is loaded. */
  filePath?: string
  /** Absolute stream index of the selected audio track, if one is selected. */
  audioStreamIndex?: number
  subtitleOffsetMs: number
}

/**
 * Pure: the sentence-audio media context for one mined cue, or `undefined`
 * when this mine cannot produce one — nothing loaded, a remote URL (ffmpeg
 * cannot clip it), no selected audio stream, or unusable cue timing. Shared by
 * the popup and bulk mining paths so both omit it under identical conditions.
 */
export function mineMediaContext(
  cue: { start?: number; end?: number } | undefined,
  source: MineMediaSource | undefined
): MineMediaContext | undefined {
  if (!source?.filePath || source.audioStreamIndex === undefined) return undefined
  if (isRemoteUrl(source.filePath)) return undefined
  if (cue?.start === undefined || cue.end === undefined) return undefined

  const window = sentenceAudioWindow({ start: cue.start, end: cue.end }, source.subtitleOffsetMs)
  if (!window) return undefined
  return {
    path: source.filePath,
    audioStreamIndex: source.audioStreamIndex,
    startSec: window.startSec,
    endSec: window.endSec
  }
}

/** Subset of the preload `kizuna.anki` bridge that addTokenToAnki needs. */
export interface AnkiMineBridge {
  addNote(req: MineRequest): Promise<AnkiMineResult>
}

/** Outcome WordPopup's `ankiStatus`/`ankiError` props are driven from. */
export type AnkiMineStatus = AnkiMineResult['operation'] | 'error'

export interface AnkiMineOutcome {
  status: AnkiMineStatus
  error?: string
}

/**
 * Mines a dictionary result into Anki via the injected bridge — the
 * "＋ Anki" button's click handler. Card audio is derived entirely from
 * `token` by the main-process note builder, so no video path/cue
 * timings/audio track need to be threaded through here. Never throws:
 * resolves `{status: 'error', error}` on a rejected `addNote` call so the
 * caller can drive WordPopup's transient status without its own try/catch.
 * `screenshot` carries a captured frame the user accepted in the crop dialog;
 * `media` carries where the line's audio can be clipped from (see
 * `mineMediaContext`). Without either, the note is mined exactly as before.
 */
export async function addTokenToAnki(
  bridge: AnkiMineBridge,
  token: Token,
  result: LookupResult,
  sentence: string,
  screenshot?: MineScreenshot,
  media?: MineMediaContext
): Promise<AnkiMineOutcome> {
  try {
    const mined = await bridge.addNote({
      token,
      result,
      sentence,
      ...(screenshot && { screenshot }),
      ...(media && { media })
    })
    return { status: mined.operation }
  } catch (err) {
    return { status: 'error', error: err instanceof Error ? err.message : String(err) }
  }
}

/** Subset of the preload `kizuna.anki` bridge that checkAnkiExisting needs. */
export interface AnkiExistingBridge {
  findExisting(token: Token, word?: string): Promise<AnkiExistingMatch | null>
}

/**
 * Checks whether `token` already has a note in Anki — drives WordPopup's
 * "Open in Anki" vs "＋ Anki" button. Never throws: resolves `null` (as if
 * not found) on a rejected `findExisting` call (e.g. Anki not running), so
 * the popup just falls back to the ordinary add flow.
 */
export async function checkAnkiExisting(
  bridge: AnkiExistingBridge,
  token: Token,
  word?: string
): Promise<AnkiExistingMatch | null> {
  try {
    return word === undefined
      ? await bridge.findExisting(token)
      : await bridge.findExisting(token, word)
  } catch {
    return null
  }
}

/**
 * Pure: the next A–B loop phase for one `abLoop` key press, given the current
 * stored endpoints and the current playback time (seconds). The cycle is
 * no-loop → set A → set B (loop armed) → cleared. Endpoints are clamped to a
 * non-negative time. When B would land *before* A (the user seeked back before
 * A), the endpoints are swapped so the returned pair always satisfies `a < b`
 * — that same normalized pair is both stored and sent to mpv, so the seekbar
 * overlay can trust the ordering and never derives a negative width. When B
 * would land *exactly on* A (e.g. two presses at the same time while paused),
 * a zero-length loop is rejected: A stays armed so the next press at a
 * different time can still close a valid range.
 */
export function cycleAbLoop(current: AbLoopState, timeSec: number): AbLoopState {
  const now = Math.max(0, timeSec)
  if (current.a === null) return { a: now, b: null }
  if (current.b === null) {
    if (now === current.a) return { a: current.a, b: null } // keep A armed; never store a==b
    return now < current.a ? { a: now, b: current.a } : { a: current.a, b: now }
  }
  return EMPTY_AB_LOOP
}

/** Subset of the preload `kizuna.player` bridge that the A–B loop needs. */
export interface AbLoopBridge {
  setAbLoop(a: number | null, b: number | null): Promise<unknown>
}

/**
 * Runs one A–B loop key press end to end: computes the next phase
 * (`cycleAbLoop`), pushes the normalized pair to mpv, stores it via `dispatch`,
 * and — when the A–B loop is being engaged (the resulting A is set) — clears any
 * active per-cue loop, since the two loops fighting produces stutter. Returns
 * the next state for the caller/tests. Never throws: the mpv push is
 * fire-and-forget like the other transport commands.
 */
export function cycleAbLoopAction(
  bridge: AbLoopBridge,
  dispatch: Dispatch,
  current: AbLoopState,
  timeSec: number,
  clearLoopLine: () => void
): AbLoopState {
  const next = cycleAbLoop(current, timeSec)
  void bridge.setAbLoop(next.a, next.b)
  dispatch({ type: 'setAbLoop', value: next })
  if (next.a !== null) clearLoopLine()
  return next
}

/** Subset of the preload `kizuna.player` bridge that frame stepping needs. */
export interface FrameStepBridge {
  frameStep(): Promise<unknown>
  frameBackStep(): Promise<unknown>
}

/**
 * Mutable in-flight latch, shared across frame-step presses for one player
 * instance (App.tsx holds it in a ref). While a step's IPC invoke is pending,
 * further presses are dropped so holding the key down can't pile commands into
 * mpv's queue faster than they complete.
 */
export interface FrameStepGuard {
  inFlight: boolean
}

/**
 * Issues a single frame step — `'forward'` (`frame-step`) or `'back'`
 * (`frame-back-step`). mpv pauses on a successful step and pushes that through
 * the pause observer (`player:pause` → App's `onPause` → `setPaused`), so this
 * deliberately does **not** optimistically flip pause state itself: mpv is the
 * source of truth. That keeps the play button honest in the cases where a step
 * does *not* pause — an audio-only file mpv ignores the command for, or an
 * invoke that rejects — where an optimistic `paused: true` would otherwise stick
 * with no observer to correct it. No-ops when no file is loaded (the same guard
 * the other transport actions use) or while a previous step is still in flight
 * (`guard.inFlight`), so a held key never floods mpv's command queue. Never
 * throws: the invoke is fire-and-forget, and the latch is released whether it
 * resolves or rejects.
 */
export function frameStepAction(
  bridge: FrameStepBridge,
  direction: 'forward' | 'back',
  fileLoaded: boolean,
  guard: FrameStepGuard
): void {
  if (!fileLoaded || guard.inFlight) return
  guard.inFlight = true
  const invoke = direction === 'forward' ? bridge.frameStep() : bridge.frameBackStep()
  const release = (): void => {
    guard.inFlight = false
  }
  // Fire-and-forget like the other transport commands: swallow a rejected
  // invoke (both arms release the latch) so a failed step never surfaces an
  // unhandled rejection.
  void invoke.then(release, release)
}

/** Subset of the preload `kizuna.player` bridge that video adjustments need. */
export interface VideoAdjustmentsBridge {
  setVideoAdjustments(adjustments: VideoAdjustments): Promise<unknown>
}

/**
 * Re-applies the stored picture adjustments to mpv. This is the single "what to
 * apply after load" decision, kept pure here rather than inlined in App.tsx: mpv
 * resets its equalizer per process and `video-rotate`/`deinterlace` per file, so
 * the whole block must be re-pushed after every successful load (and mpv
 * restart), even when neutral, to clear whatever the previous file left set.
 * Returns the adjustments it pushed for the caller/tests. Never throws: the mpv
 * push is fire-and-forget like the other transport commands.
 */
export function applyVideoAdjustments(
  bridge: VideoAdjustmentsBridge,
  adjustments: VideoAdjustments
): VideoAdjustments {
  void bridge.setVideoAdjustments(adjustments)
  return adjustments
}

/** Subset of the preload `kizuna.windowControls` bridge that performKeyAction needs. */
export interface WindowControlsBridge {
  toggleFullscreen(): void
  setFullscreen(fullscreen: boolean): void
}

export interface KeyActionDeps {
  player: PlayerApi
  windowControls: WindowControlsBridge
  paused: boolean
  fullscreen: boolean
  skipSeconds: number
  speed: number
  cues: Cue[]
  chapters: Chapter[]
  timePos: number
  subtitleOffsetMs: number
  onToggleLoopLine: () => void
  /** Advances the A–B loop cycle (no-loop → A → B → clear); see `cycleAbLoopAction`. */
  onCycleAbLoop: () => void
  /** Steps one frame forward and pauses; see `frameStepAction`. */
  onFrameStep: () => void
  /** Steps one frame back and pauses; see `frameStepAction`. */
  onFrameBack: () => void
  onNavigateLine: () => void
  onPrevFile: () => void
  onNextFile: () => void
  onScreenshot: () => void
  /** Toggles compact mini-player (picture-in-picture) mode; see `state/miniPlayer.ts`. */
  onToggleMiniPlayer: () => void
}

/**
 * Runs the side effect for a keyboard-shortcut `action` (from `keyToAction`) —
 * App.tsx's keydown effect boils down to `keyToAction` + this. Returns whether
 * the triggering key event should have `preventDefault()` called on it: true
 * for the play/pause and skip actions, whose bound keys (Space, arrows) would
 * otherwise also trigger the browser's own default handling; false for the
 * fullscreen actions, which have no conflicting default.
 */
export function performKeyAction(action: PlayerKeyAction, deps: KeyActionDeps): boolean {
  switch (action) {
    case 'togglePause':
      togglePause(deps.player, deps.paused)
      return true
    case 'toggleFullscreen':
      deps.windowControls.toggleFullscreen()
      return false
    case 'exitFullscreen':
      if (!deps.fullscreen) return false
      deps.windowControls.setFullscreen(false)
      return false
    case 'skipBack':
      skipBack(deps.player, deps.skipSeconds)
      return true
    case 'skipForward':
      skipAhead(deps.player, deps.skipSeconds)
      return true
    case 'speedDown':
      void deps.player.setSpeed(Math.max(SPEED_MIN, deps.speed - SPEED_STEP))
      return false
    case 'speedUp':
      void deps.player.setSpeed(Math.min(SPEED_MAX, deps.speed + SPEED_STEP))
      return false
    case 'speedReset':
      void deps.player.setSpeed(1)
      return false
    case 'replayLine': {
      const cue = replayCue(deps.cues, deps.timePos, deps.subtitleOffsetMs)
      if (cue) void deps.player.seek(seekTargetForCue(cue, deps.subtitleOffsetMs), true)
      return true
    }
    case 'prevLine': {
      const cue = prevCue(deps.cues, deps.timePos, deps.subtitleOffsetMs)
      if (cue) {
        deps.onNavigateLine()
        void deps.player.seek(seekTargetForCue(cue, deps.subtitleOffsetMs), true)
      }
      return true
    }
    case 'nextLine': {
      const cue = nextCue(deps.cues, deps.timePos, deps.subtitleOffsetMs)
      if (cue) {
        deps.onNavigateLine()
        void deps.player.seek(seekTargetForCue(cue, deps.subtitleOffsetMs), true)
      }
      return true
    }
    case 'loopLine':
      deps.onToggleLoopLine()
      return false
    case 'abLoop':
      deps.onCycleAbLoop()
      return false
    case 'frameStep':
      deps.onFrameStep()
      return true
    case 'frameBack':
      deps.onFrameBack()
      return true
    case 'prevFile':
      deps.onPrevFile()
      return false
    case 'nextFile':
      deps.onNextFile()
      return false
    case 'prevChapter': {
      const start = prevChapterStart(deps.chapters, deps.timePos)
      if (start !== undefined) void deps.player.seek(start, true)
      return true
    }
    case 'nextChapter': {
      const start = nextChapterStart(deps.chapters, deps.timePos)
      if (start !== undefined) void deps.player.seek(start, true)
      return true
    }
    case 'screenshot':
      deps.onScreenshot()
      return false
    case 'miniPlayer':
      deps.onToggleMiniPlayer()
      return false
  }
}

/** Dependencies for file navigation routing. */
export interface FileNavigationDeps {
  playlistActive: boolean
  onNextFile: () => void
  onPrevFile: () => void
  onPlaylistNext: () => void
  onPlaylistPrev: () => void
}

/**
 * Routes explicit previous/next navigation to the active playlist when it owns
 * playback, otherwise to the same-folder neighbor handlers.
 */
export function performFileNavigation(direction: 'prev' | 'next', deps: FileNavigationDeps): void {
  if (direction === 'next') {
    if (deps.playlistActive) deps.onPlaylistNext()
    else deps.onNextFile()
    return
  }
  if (deps.playlistActive) deps.onPlaylistPrev()
  else deps.onPrevFile()
}

/** Dependencies `performMediaKey` routes a system media command to.
 * `next`/`prev` split on `playlistActive`: when the play queue owns playback
 * (`playlistController.isPlaybackCurrent`, mirroring the EOF path) they advance
 * the queue via `onPlaylistNext`/`onPlaylistPrev`; otherwise they fall back to
 * App's same-folder `onNextFile`/`onPrevFile`. So a hardware media key or a
 * taskbar Next button advances the active playlist instead of leaving it for
 * the adjacent folder file. */
export interface MediaKeyDeps extends FileNavigationDeps {
  player: PlayerApi
  paused: boolean
}

/**
 * Pure: runs the side effect for a system media command (a keyboard media key
 * or a taskbar thumbnail-toolbar button — see `main/services/systemMedia.ts`).
 * `playPause` toggles pause through the same helper the play button uses;
 * `next`/`prev` advance the play queue when it owns playback, else the
 * same-folder neighbor (see `MediaKeyDeps`); `stop` pauses and seeks to the
 * start, matching a player's Stop button. Never throws: the player calls are
 * fire-and-forget like the other transport actions.
 */
export function performMediaKey(command: MediaKeyCommand, deps: MediaKeyDeps): void {
  switch (command) {
    case 'playPause':
      togglePause(deps.player, deps.paused)
      return
    case 'next':
      performFileNavigation('next', deps)
      return
    case 'prev':
      performFileNavigation('prev', deps)
      return
    case 'stop':
      void deps.player.setPause(true)
      void deps.player.seek(0, true)
      return
  }
}

/**
 * True only on the false→true EOF edge while folder auto-advance can safely
 * open. An active playlist (`playlistActive`) suppresses folder-advance: the
 * queue decides what plays next and takes precedence (see
 * `playlistController.handleEof`).
 */
export function shouldAutoAdvance(
  prevEof: boolean,
  eof: boolean,
  autoPlayNext: boolean,
  mediaOpening: boolean,
  filePath: string | undefined,
  playlistActive = false
): boolean {
  return (
    !prevEof && eof && autoPlayNext && !mediaOpening && filePath !== undefined && !playlistActive
  )
}

export type EofAction = 'playlist' | 'folder' | 'none'

// Decides who handles an EOF rising edge. An explicit play queue is a
// deliberate "what plays next" statement and takes EOF precedence over the
// folder-advance option — so the queue branch is NOT gated by autoPlayNext
// (only by the open lock). Folder auto-advance stays gated by autoPlayNext
// via shouldAutoAdvance.
export function eofAction(
  prevEof: boolean,
  eof: boolean,
  autoPlayNext: boolean,
  mediaOpening: boolean,
  filePath: string | undefined,
  queueDriving: boolean
): EofAction {
  const risingEdge = !prevEof && eof
  if (queueDriving && risingEdge && !mediaOpening) return 'playlist'
  if (shouldAutoAdvance(prevEof, eof, autoPlayNext, mediaOpening, filePath, queueDriving)) {
    return 'folder'
  }
  return 'none'
}
