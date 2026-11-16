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

// Extract only the default subtitle on open; other tracks load lazily on selection.
export async function loadPath(
  session: OpenSession,
  filePath: string,
  loadId?: number
): Promise<OpenMediaResult> {
  if (loadId === undefined) session.onMediaOpenStarted?.()
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
  dispatch({ type: 'fileLoaded', filePath, tracks, ...(history ? { history } : {}) })

  // Subtitle extraction can take seconds; finish opening independently and deliver token-guarded warnings later.
  session.onSubtitleRestoreStarted?.()
  void restoreSubtitle(session, filePath, { tracks, history }, loadId)
    .then((warning) => {
      if (warning !== undefined && fileToken.current === loadId) onWarning(warning)
    })
    .catch(() => undefined)
    .finally(() => {
      if (fileToken.current === loadId) session.onSubtitleRestoreSettled?.()
    })
  const results = await Promise.all([
    restoreAudio(session, tracks, history, loadId),
    restoreResume(session, history, loadId)
  ])
  if (fileToken.current !== loadId) return { status: 'stale' }

  const warnings = results.filter((warning): warning is string => warning !== undefined)
  return { status: 'opened', filePath, warnings }
}

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
    const restoreFileOffset = (): void => {
      const offsetMs = session.getFileSubtitleOffset?.()
      if (offsetMs !== undefined) dispatch({ type: 'set', patch: { subtitleOffsetMs: offsetMs } })
    }
    if (sid === null) {
      if (!superseded()) restoreFileOffset()
      return undefined
    }
    try {
      const cues = await bridge.media.loadSubtitle(filePath, sid)
      if (superseded()) return undefined
      cueCache.set(sid, cues)
      dispatch({ type: 'cuesLoaded', cues })
      dispatch({ type: 'selectSubtitle', id: sid })
      restoreFileOffset()
      return undefined
    } catch (err) {
      if (superseded()) return undefined
      dispatch({ type: 'cuesLoaded', cues: [] })
      dispatch({ type: 'selectSubtitle', id: null })
      restoreFileOffset()
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
      const provenance = history.subtitle.provenance
      dispatch({
        type: 'externalSubtitleLoaded',
        path: subtitlePath,
        track,
        cues,
        encoding,
        ...(provenance ? { provenance } : {})
      })
      if (provenance) {
        const offsetMs =
          history.subtitleOffsetsByVersion?.[provenance.contentVersion] ??
          session.getFileSubtitleOffset?.() ??
          0
        dispatch({
          type: 'setSubtitleVersionOffset',
          contentVersion: provenance.contentVersion,
          value: offsetMs
        })
      } else {
        const offsetMs = session.getFileSubtitleOffset?.()
        if (offsetMs !== undefined) dispatch({ type: 'set', patch: { subtitleOffsetMs: offsetMs } })
      }
      return undefined
    } catch (err) {
      if (superseded()) return undefined
      // If the saved sidecar is unavailable, restore embedded subtitles and report the failure.
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

// Resume independently of subtitle extraction so slow ffmpeg work cannot delay playback.
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

export async function openAndLoad(session: OpenSession): Promise<OpenMediaResult> {
  return runOpenAndLoad(session)
}

async function runOpenAndLoad(session: OpenSession): Promise<OpenMediaResult> {
  const filePath = await session.bridge.media.openFile()
  if (!filePath) return { status: 'cancelled' }
  if (classifyMediaFileName(filePath) === 'playlist') {
    return openPlaylistPick(session, filePath)
  }
  // A plain file pick also replaces the queue, or stale entries could drive next/previous and EOF advance.
  session.onPlaylistPicked?.([filePath])
  return loadPath(session, filePath)
}

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
  session.onMediaOpenStarted?.()
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
