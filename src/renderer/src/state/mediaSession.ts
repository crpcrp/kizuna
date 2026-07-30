// Contracts shared by the renderer's media orchestration: the slice of the
// preload bridge these actions need, the reducer dispatch alias, the request
// token that invalidates superseded async work, and the open-session bundle the
// load/open paths thread through. Also holds the two predicates every one of
// them consults (`errorMessage`, `shouldProbe`).
//
// Every module in this group takes an injected `bridge` and `dispatch`, so it is
// unit-testable with a fake bridge — no Electron, no window, no mpv.

import { type Cue } from '../../../shared/cue'
import { isRemoteUrl } from '../../../shared/mediaFileTypes'
import {
  type MediaPlaybackHistory,
  type StoredSubtitleSelection,
  type StoredTrackSelection
} from '../../../shared/mediaHistory'
import { type FileAvailability } from '../../../shared/preloadApi'
import { type SubtitleEncoding } from '../../../shared/subtitleEncoding'
import { type Track } from '../../../shared/track'
import { type PlayerAction } from './playerState'

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

export const noWarningSink: OpenWarningSink = () => {}

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
 * Whether `path` should be probed with the filesystem-oriented tooling
 * (ffprobe track enumeration, video-dimension and chapter reads). Remote URLs
 * (Feature 9) return false: ffprobe can't read them, so their stream info comes
 * from mpv's `track-list` instead and their video-dimension/chapter probes are
 * skipped. Every renderer call site that probes branches on this.
 */
export function shouldProbe(path: string): boolean {
  return !isRemoteUrl(path)
}
