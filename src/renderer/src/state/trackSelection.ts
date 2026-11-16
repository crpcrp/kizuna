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
  offsetMs?: number
  /** Main-validated provenance for a downloaded external subtitle. */
  provenance?: JimakuSubtitleProvenance
  /** Snapshot captured before this selection began, for one-step revert. */
  previousSnapshot?: SubtitleSelectionSnapshot
  /** Receives `previousSnapshot` once the new selection has parsed and committed. */
  onApplied?: (previous: SubtitleSelectionSnapshot) => void
  /** Re-parsing the already-active subtitle (for example after encoding change) does not create a revert. */
  capturePrevious?: boolean
  /** Drops the result when the owning media session is no longer current. */
  isCurrent?: () => boolean
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

// A persistence failure must not roll back an audio selection already accepted by mpv.
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

// Share the request token and cue cache with media opening so auto-selection cannot overwrite a manual pick.
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
  const isCurrent = options.isCurrent ?? (() => true)

  if (!isCurrent()) return undefined

  if (track === null) {
    if (!isCurrent()) return undefined
    dispatch({ type: 'cuesLoaded', cues: [] })
    dispatch({ type: 'selectSubtitle', id: null })
    applySubtitleOffset(dispatch, options.offsetMs, options.provenance)
    notifyApplied(options)
    const warning = await persistSubtitleSelection(bridge, filePath, { mode: 'off' })
    return isCurrent() ? warning : undefined
  }

  const cached = cueCache.get(track.id)
  if (cached) {
    if (!isCurrent()) return undefined
    dispatch({ type: 'cuesLoaded', cues: cached })
    dispatch({ type: 'selectSubtitle', id: track.id })
    applySubtitleOffset(dispatch, options.offsetMs, options.provenance)
    notifyApplied(options)
    const warning = await persistSubtitleTrack(
      bridge,
      filePath,
      track,
      externalSubtitlePath,
      externalSubtitleEncoding,
      options.provenance
    )
    return isCurrent() ? warning : undefined
  }

  const cues = await bridge.media.loadSubtitle(filePath, track.id)
  if (subtitleToken.current !== requestId || !isCurrent()) return undefined
  cueCache.set(track.id, cues)
  dispatch({ type: 'cuesLoaded', cues })
  dispatch({ type: 'selectSubtitle', id: track.id })
  applySubtitleOffset(dispatch, options.offsetMs, options.provenance)
  notifyApplied(options)
  const warning = await persistSubtitleTrack(
    bridge,
    filePath,
    track,
    externalSubtitlePath,
    externalSubtitleEncoding,
    options.provenance
  )
  return isCurrent() ? warning : undefined
}

// External tracks have no stream index; persist their path or reopening would silently turn subtitles off.
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

// Only Japanese sidecars may enable MeCab and knowledge coloring.
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

// A parse failure leaves the selection untouched; a persistence failure leaves the applied selection visible.
export async function loadExternalSubtitle(
  session: OpenSession,
  filePath: string,
  subtitlePath: string,
  options: SubtitleSelectionOptions = {}
): Promise<string | undefined> {
  const result = await loadExternalSubtitleResult(session, filePath, subtitlePath, options)
  if (result.status === 'error') return result.message
  return result.status === 'applied' ? result.warning : undefined
}

export type ExternalSubtitleLoadResult =
  | { status: 'applied'; warning?: string }
  | { status: 'stale' }
  | { status: 'error'; message: string }

export async function loadExternalSubtitleResult(
  session: OpenSession,
  filePath: string,
  subtitlePath: string,
  options: SubtitleSelectionOptions = {}
): Promise<ExternalSubtitleLoadResult> {
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
): Promise<ExternalSubtitleLoadResult> {
  const { bridge, dispatch, subtitleToken, cueCache } = session
  const externalSubtitleEncoding = session.externalSubtitleEncoding ?? 'auto'
  const requestId = ++subtitleToken.current
  const isCurrent = options.isCurrent ?? (() => true)

  if (!isCurrent()) return { status: 'stale' }

  let cues: Cue[]
  try {
    cues = await bridge.media.loadExternalSubtitle(subtitlePath, externalSubtitleEncoding)
  } catch (err) {
    if (subtitleToken.current !== requestId || !isCurrent()) return { status: 'stale' }
    return { status: 'error', message: errorMessage(err) }
  }
  if (subtitleToken.current !== requestId || !isCurrent()) return { status: 'stale' }

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
      : session.getFileSubtitleOffset?.())
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
  const warning = await persistSubtitleSelection(bridge, filePath, {
    mode: 'external',
    path: subtitlePath,
    encoding: externalSubtitleEncoding,
    ...(options.provenance ? { provenance: options.provenance } : {})
  })
  return isCurrent() ? { status: 'applied', ...(warning ? { warning } : {}) } : { status: 'stale' }
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
  dispatch({ type: 'set', patch: { subtitleOffsetMs: offsetMs } })
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
