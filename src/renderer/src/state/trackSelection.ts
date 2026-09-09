// Audio and subtitle track selection: applying a track to mpv, reflecting it in
// state, persisting the choice against the file, and building the synthetic
// tracks that external subtitle files are represented by.

import { type Cue } from '../../../shared/cue'
import {
  type JimakuSubtitleProvenance,
  type StoredSubtitleSelection,
  createStoredTrackSelection,
  mediaFileBasename
} from '../../../shared/mediaHistory'
import { type SubtitleEncoding } from '../../../shared/subtitleEncoding'
import { EXTERNAL_SUBTITLE_TRACK_ID, type Track } from '../../../shared/track'
import { errorMessage } from '../util/errorMessage'
import {
  type Dispatch,
  type OpenSession,
  type PlayerBridge,
  type SubtitleRequestToken
} from './mediaSession'

interface SubtitlePickerSessionDeps {
  expectedFilePath: string
  currentFilePath: () => string | undefined
  pickPath: () => Promise<string | undefined>
  session: OpenSession
  reportError: (message: string) => void
}

export interface SubtitleSelectionOptions {
  /** Effective offset to restore after this selection succeeds. */
  offsetMs?: number
  /** Main-validated provenance for a downloaded external subtitle. */
  provenance?: JimakuSubtitleProvenance
  /** Snapshot captured before this selection began, for one-step revert. */
  previousSnapshot?: SubtitleSelectionSnapshot
  /** Receives `previousSnapshot` once the new selection has parsed and committed. */
  onApplied?: (previous: SubtitleSelectionSnapshot) => void
  /** Re-parsing the already-active subtitle (for example after encoding change) does not create a revert. */
  capturePrevious?: boolean
}

export interface SubtitleSelectionSnapshot {
  selection: StoredSubtitleSelection
  offsetMs: number
}

export interface SubtitleSelectionSnapshotState {
  selectedSubtitleId: number | null
  tracks: Track[]
  externalSubtitlePath?: string
  externalSubtitleEncoding: SubtitleEncoding
  externalSubtitleProvenance?: JimakuSubtitleProvenance
  subtitleOffsetMs: number
}

/** Captures all renderer-owned information needed for one-step subtitle revert. */
export function captureSubtitleSelectionSnapshot(
  state: SubtitleSelectionSnapshotState
): SubtitleSelectionSnapshot {
  let selection: StoredSubtitleSelection = { mode: 'off' }
  if (state.selectedSubtitleId === EXTERNAL_SUBTITLE_TRACK_ID && state.externalSubtitlePath) {
    selection = {
      mode: 'external',
      path: state.externalSubtitlePath,
      encoding: state.externalSubtitleEncoding,
      ...(state.externalSubtitleProvenance ? { provenance: state.externalSubtitleProvenance } : {})
    }
  } else if (state.selectedSubtitleId !== null) {
    const track = state.tracks.find(
      (candidate) => candidate.kind === 'subtitle' && candidate.id === state.selectedSubtitleId
    )
    const descriptor = track ? createStoredTrackSelection(track) : undefined
    if (descriptor) selection = { mode: 'track', track: descriptor }
  }
  return { selection, offsetMs: state.subtitleOffsetMs }
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
  externalSubtitleEncoding: SubtitleEncoding = 'auto',
  options: SubtitleSelectionOptions = {}
): Promise<string | undefined> {
  const requestId = ++subtitleToken.current

  if (track === null) {
    dispatch({ type: 'cuesLoaded', cues: [] })
    dispatch({ type: 'selectSubtitle', id: null })
    applySubtitleOffset(dispatch, options.offsetMs, options.provenance)
    notifyApplied(options)
    return persistSubtitleSelection(bridge, filePath, { mode: 'off' })
  }

  const cached = cueCache.get(track.id)
  if (cached) {
    dispatch({ type: 'cuesLoaded', cues: cached })
    dispatch({ type: 'selectSubtitle', id: track.id })
    applySubtitleOffset(dispatch, options.offsetMs, options.provenance)
    notifyApplied(options)
    return persistSubtitleTrack(
      bridge,
      filePath,
      track,
      externalSubtitlePath,
      externalSubtitleEncoding,
      options.provenance
    )
  }

  const cues = await bridge.media.loadSubtitle(filePath, track.id)
  if (subtitleToken.current !== requestId) return undefined
  cueCache.set(track.id, cues)
  dispatch({ type: 'cuesLoaded', cues })
  dispatch({ type: 'selectSubtitle', id: track.id })
  applySubtitleOffset(dispatch, options.offsetMs, options.provenance)
  notifyApplied(options)
  return persistSubtitleTrack(
    bridge,
    filePath,
    track,
    externalSubtitlePath,
    externalSubtitleEncoding,
    options.provenance
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
  externalSubtitleEncoding: SubtitleEncoding = 'auto',
  provenance?: JimakuSubtitleProvenance
): Promise<string | undefined> {
  if (track.id === EXTERNAL_SUBTITLE_TRACK_ID) {
    if (!externalSubtitlePath) return undefined
    return persistSubtitleSelection(bridge, filePath, {
      mode: 'external',
      path: externalSubtitlePath,
      encoding: externalSubtitleEncoding,
      ...(provenance ? { provenance } : {})
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
  subtitlePath: string,
  options: SubtitleSelectionOptions = {}
): Promise<string | undefined> {
  return runLoadExternalSubtitle(session, filePath, subtitlePath, options)
}

export async function loadSubtitleFromPicker(deps: SubtitlePickerSessionDeps): Promise<void> {
  const path = await deps.pickPath()
  if (path === undefined) return
  if (deps.currentFilePath() !== deps.expectedFilePath) return
  const warning = await loadExternalSubtitle(deps.session, deps.expectedFilePath, path)
  if (warning) deps.reportError(warning)
}

async function runLoadExternalSubtitle(
  session: OpenSession,
  filePath: string,
  subtitlePath: string,
  options: SubtitleSelectionOptions
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
  const previousSnapshot =
    options.capturePrevious === false ? undefined : session.captureSubtitleSelection?.()
  dispatch({
    type: 'externalSubtitleLoaded',
    path: subtitlePath,
    track,
    cues,
    encoding: externalSubtitleEncoding,
    ...(options.provenance ? { provenance: options.provenance } : {})
  })
  const offsetMs =
    options.offsetMs ??
    (options.provenance
      ? (session.getSubtitleVersionOffset?.(options.provenance.contentVersion) ?? 0)
      : session.getLegacySubtitleOffset?.())
  if (options.provenance) {
    if (offsetMs !== undefined) {
      dispatch({
        type: 'setSubtitleVersionOffset',
        contentVersion: options.provenance.contentVersion,
        value: offsetMs
      })
    }
  } else {
    applySubtitleOffset(dispatch, offsetMs)
  }
  if (previousSnapshot) session.onSubtitleSelectionApplied?.(previousSnapshot)
  return persistSubtitleSelection(bridge, filePath, {
    mode: 'external',
    path: subtitlePath,
    encoding: externalSubtitleEncoding,
    ...(options.provenance ? { provenance: options.provenance } : {})
  })
}

function notifyApplied(options: SubtitleSelectionOptions): void {
  if (options.previousSnapshot) options.onApplied?.(options.previousSnapshot)
}

function applySubtitleOffset(
  dispatch: Dispatch,
  offsetMs: number | undefined,
  provenance?: JimakuSubtitleProvenance
): void {
  if (offsetMs === undefined) return
  if (provenance) {
    dispatch({
      type: 'setSubtitleVersionOffset',
      contentVersion: provenance.contentVersion,
      value: offsetMs
    })
    return
  }
  dispatch({ type: 'setSubtitleOffset', value: offsetMs })
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
