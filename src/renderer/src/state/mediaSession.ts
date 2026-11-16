import { type Cue } from '../../../shared/cue'
import {
  type MediaPlaybackHistory,
  type StoredSubtitleSelection,
  type StoredTrackSelection
} from '../../../shared/mediaHistory'
import { type FileAvailability } from '../../../shared/preloadApi'
import { type SubtitleEncoding } from '../../../shared/subtitleEncoding'
import { type Track } from '../../../shared/track'
import { type PlayerAction } from './playerState'
import type { SubtitleSelectionSnapshot } from './trackSelection'

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
  }
  mediaHistory: {
    getPlaybackHistory(path: string): Promise<MediaPlaybackHistory | undefined>
    setAudioTrack(path: string, track: StoredTrackSelection): Promise<void>
    setSubtitleTrack(path: string, selection: StoredSubtitleSelection): Promise<void>
    setSubtitleVersionOffset(path: string, contentVersion: string, offsetMs: number): Promise<void>
  }
}

export interface RecentMediaBridge extends PlayerBridge {
  mediaHistory: PlayerBridge['mediaHistory'] & {
    checkFileAvailability(path: string): Promise<FileAvailability>
    removeRecentFile(path: string): Promise<unknown>
  }
}

export type Dispatch = (action: PlayerAction) => void

// Stream indexes may change after remuxing; fall back to stable metadata within the requested track kind.
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

// Share one request counter across automatic and manual subtitle loads so late extraction cannot overwrite a newer pick.
export interface SubtitleRequestToken {
  current: number
}

// Subtitle restoration finishes independently; its warnings arrive through OpenWarningSink after opening.
export type OpenMediaResult =
  | { status: 'cancelled' }
  | { status: 'opened'; filePath: string; warnings: string[] }
  | { status: 'missing'; filePath: string; message: string }
  | { status: 'failed'; filePath?: string; message: string }
  | { status: 'stale' }
  | { status: 'busy' }

// Deliver late restoration warnings only while their file request is current.
export type OpenWarningSink = (message: string) => void

export const noWarningSink: OpenWarningSink = () => {}

export interface OpenSession {
  bridge: PlayerBridge
  dispatch: Dispatch
  subtitleToken: SubtitleRequestToken
  cueCache: Map<number, Cue[]>
  fileToken: SubtitleRequestToken
  /** Encoding to use for a restored external subtitle that saved none. */
  externalSubtitleEncoding?: SubtitleEncoding
  /** Current video's per-file/folder offset for local and embedded subtitles. */
  getFileSubtitleOffset?: () => number
  /** Existing per-video downloaded-version offset, or the file/folder fallback. */
  getSubtitleVersionOffset?: (contentVersion: string) => number
  /** Captures the active selection immediately before a successful replacement. */
  captureSubtitleSelection?: () => SubtitleSelectionSnapshot
  /** Receives the one-step revert snapshot after a replacement commits. */
  onSubtitleSelectionApplied?: (previous: SubtitleSelectionSnapshot) => void
  /** Fires when a new media-open attempt invalidates the previous restore. */
  onMediaOpenStarted?: () => void
  /** Brackets the asynchronous subtitle restoration started by a media open. */
  onSubtitleRestoreStarted?: () => void
  onSubtitleRestoreSettled?: () => void
  onWarning?: OpenWarningSink
  // Replace the queue before loading the picked file or the first expanded playlist entry.
  onPlaylistPicked?: (paths: string[]) => void
}
