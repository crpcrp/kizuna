// Opening and loading media: the mpv load itself plus the per-file restoration
// (audio track, subtitle track, resume position) that follows a successful
// load, and the three entry points that reach it — the file picker, a playlist
// pick, and a recent-files entry.

import { classifyMediaFileName, isRemoteUrl } from '../../../shared/mediaFileTypes'
import { type MediaPlaybackHistory, getResumePosition } from '../../../shared/mediaHistory'
import { type FileAvailability } from '../../../shared/preloadApi'
import { type Track } from '../../../shared/track'
import { errorMessage } from '../util/errorMessage'
import { defaultSubtitleId } from './playerState'
import {
  type OpenMediaResult,
  type OpenSession,
  type RecentMediaBridge,
  matchStoredTrack,
  noWarningSink
} from './mediaSession'
import { externalSubtitleTrack } from './trackSelection'

const LOCAL_MEDIA_ONLY_MESSAGE = 'URL playback is not supported.'

/**
 * Enumerates `filePath`'s tracks, loads it into the player, and auto-loads
 * the default subtitle track (if any). The supplied path starts a new file
 * request immediately, before its first await.
 *
 * Only the default subtitle track is extracted while opening a file. Other
 * tracks are extracted on their first manual selection and then retained in
 * `cueCache` by `selectSubtitle`.
 *
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
  if (isRemoteUrl(filePath)) {
    return { status: 'failed', filePath, message: LOCAL_MEDIA_ONLY_MESSAGE }
  }
  let tracks: Track[]
  let history: MediaPlaybackHistory | undefined
  try {
    ;[tracks, history] = await Promise.all([
      bridge.media.enumerateTracks(filePath),
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
    return { status: 'failed', filePath, message: errorMessage(err) }
  }
  if (fileToken.current !== loadId) return { status: 'stale' }

  cueCache.clear()
  dispatch({ type: 'fileLoaded', filePath, tracks })

  // Subtitle extraction goes through ffmpeg and can take several seconds.
  // It must not keep the open action (and therefore the recent-files refresh
  // and menu's opening guard) pending after mpv has accepted the new file.
  // restoreSubtitle catches its own failure and remains gated by both request
  // tokens, so it is safe to finish independently in the background — its
  // warning reaches the caller through `onWarning` rather than `warnings`,
  // and the file token is re-checked at delivery so a warning from a
  // superseded open never reaches the file the user now has open.
  void restoreSubtitle(session, filePath, { tracks, history }, loadId).then((warning) => {
    if (warning !== undefined && fileToken.current === loadId) onWarning(warning)
  })
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
  const entries = ((await session.bridge.media.readPlaylist?.(filePath)) ?? []).filter(
    (entry) => !isRemoteUrl(entry)
  )
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
  if (isRemoteUrl(filePath)) {
    return { status: 'failed', filePath, message: LOCAL_MEDIA_ONLY_MESSAGE }
  }
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
