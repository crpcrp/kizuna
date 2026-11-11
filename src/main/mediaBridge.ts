// IPC and media dependencies are injected for tests; index.ts supplies the
// Electron dialog, ffprobe, and parser implementations.

import { MEDIA_CHANNELS } from '../shared/ipcChannels'
import type { Track, VideoDimensions } from '../shared/track'
import type { Chapter } from '../shared/chapter'
import type { Cue } from '../shared/cue'
import { isSubtitleEncoding, type SubtitleEncoding } from '../shared/subtitleEncoding'
import { isRemoteUrl } from '../shared/mediaFileTypes'
import { isFiniteNumber, isNonEmptyString, isNonNegativeSafeInteger } from '../shared/guards'
import type { IpcMainHandleLike } from './ipc'
import { expect, isStringList } from './ipcValidation'

const LOCAL_MEDIA_ONLY_MESSAGE = 'URL playback is not supported.'

/** Narrows a renderer-supplied path and rejects remote URLs. */
function localPath(channel: string): (value: unknown) => string {
  const check = expect(isNonEmptyString, channel)
  return (value) => {
    const path = check(value)
    if (isRemoteUrl(path)) throw new Error(LOCAL_MEDIA_ONLY_MESSAGE)
    return path
  }
}

/** The slice of the media service this bridge needs (fakeable in tests). */
export interface MediaServiceLike {
  /** Shows an open-file dialog; resolves to the chosen path, or undefined if cancelled. */
  openFile(): Promise<string | undefined>
  /** Shows a multi-select open-file dialog; resolves the chosen paths (empty if cancelled). */
  openFiles(): Promise<string[]>
  /** Shows a directory picker; resolves every naturally-sorted video in it (empty if cancelled). */
  openFolder(): Promise<string[]>
  /** Reads an `.m3u`/`.m3u8` file into absolute media paths. */
  readPlaylist(filePath: string): Promise<string[]>
  /** Shows a save dialog and writes the queue as `.m3u`; resolves the saved
   * path, or undefined if cancelled. */
  savePlaylist(paths: string[]): Promise<string | undefined>
  /** Shows an open-file dialog filtered to subtitle files; resolves to the
   * chosen path, or undefined if cancelled. */
  openSubtitleFile(): Promise<string | undefined>
  /** Enumerates the audio/subtitle tracks of `filePath` via ffprobe. */
  enumerateTracks(filePath: string): Promise<Track[]>
  /** Extracts and parses the subtitle stream at `streamIndex` in `filePath`. */
  loadSubtitle(filePath: string, streamIndex: number): Promise<Cue[]>
  /** Reads and parses a standalone .srt/.ass/.ssa file into cues. */
  loadExternalSubtitle(subtitlePath: string, encoding: SubtitleEncoding): Promise<Cue[]>
  /** Native pixel resolution of `filePath`'s video stream, or undefined. */
  getVideoDimensions(filePath: string): Promise<VideoDimensions | undefined>
  /** Chapter markers/list metadata for `filePath`. */
  getChapters(filePath: string): Promise<Chapter[]>
  /** Natural-sorted previous/next video paths in the same folder. */
  folderNeighbors(filePath: string): Promise<{ prev?: string; next?: string }>
  /** Seekbar hover preview for `timeSec` (of a `durationSec`-long file): a
   * base64 `data:image/jpeg` payload, or null when no preview is available. */
  getThumbnail(
    filePath: string,
    timeSec: number,
    durationSec: number
  ): Promise<{ dataUrl: string } | null>
}

/**
 * Registers the media command channels ('media:openFile', 'media:openFiles',
 * 'media:openFolder', 'media:readPlaylist', 'media:savePlaylist', 'media:openSubtitleFile',
 * 'media:enumerateTracks', 'media:loadSubtitle', 'media:loadExternalSubtitle',
 * 'media:getVideoDimensions') against the ipcMain-like object, forwarding each
 * to `service`.
 */
export function registerMediaBridge<E>(ipc: IpcMainHandleLike<E>, service: MediaServiceLike): void {
  ipc.handle(MEDIA_CHANNELS.openFile, () => service.openFile())
  ipc.handle(MEDIA_CHANNELS.openFiles, () => service.openFiles())
  ipc.handle(MEDIA_CHANNELS.openFolder, () => service.openFolder())
  const C = MEDIA_CHANNELS
  const playlistPath = localPath(C.readPlaylist)
  ipc.handle(C.readPlaylist, (_e, filePath) => service.readPlaylist(playlistPath(filePath)))
  const playlistPaths = expect(isStringList, C.savePlaylist)
  ipc.handle(C.savePlaylist, (_e, paths) => service.savePlaylist(playlistPaths(paths)))
  ipc.handle(C.openSubtitleFile, () => service.openSubtitleFile())
  const tracksPath = localPath(C.enumerateTracks)
  ipc.handle(C.enumerateTracks, (_e, filePath) => service.enumerateTracks(tracksPath(filePath)))
  const subtitlePath = localPath(C.loadSubtitle)
  const streamIndexArg = expect(isNonNegativeSafeInteger, C.loadSubtitle)
  ipc.handle(C.loadSubtitle, (_e, filePath, streamIndex) =>
    service.loadSubtitle(subtitlePath(filePath), streamIndexArg(streamIndex))
  )
  const externalPath = localPath(C.loadExternalSubtitle)
  ipc.handle(C.loadExternalSubtitle, (_e, rawPath, suppliedEncoding) => {
    const path = externalPath(rawPath)
    const encoding = suppliedEncoding === undefined ? 'auto' : suppliedEncoding
    if (!isSubtitleEncoding(encoding)) throw new Error('Unsupported subtitle encoding.')
    return service.loadExternalSubtitle(path, encoding)
  })
  const dimensionsPath = localPath(C.getVideoDimensions)
  ipc.handle(C.getVideoDimensions, (_e, filePath) =>
    service.getVideoDimensions(dimensionsPath(filePath))
  )
  const chaptersPath = localPath(C.getChapters)
  ipc.handle(C.getChapters, (_e, filePath) => service.getChapters(chaptersPath(filePath)))
  const neighborsPath = localPath(C.folderNeighbors)
  ipc.handle(C.folderNeighbors, (_e, filePath) => service.folderNeighbors(neighborsPath(filePath)))
  const thumbnailPath = localPath(C.thumbnail)
  const thumbnailTime = expect(isFiniteNumber, C.thumbnail)
  ipc.handle(C.thumbnail, (_e, filePath, timeSec, durationSec) =>
    service.getThumbnail(
      thumbnailPath(filePath),
      thumbnailTime(timeSec),
      thumbnailTime(durationSec)
    )
  )
}
