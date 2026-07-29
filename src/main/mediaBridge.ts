// Media IPC bridge: wires file-selection/track-enumeration/subtitle-loading
// commands to ipcMain.handle channels. Pure injectable wiring — the
// ipcMain-like object and the media service are both injected so tests
// exercise this with fakes instead of live Electron/ffprobe (AGENTS.md law
// 3). Electron glue (real dialog.showOpenDialog, ffprobe/parser wiring) is
// implemented in a later subtask.

import { MEDIA_CHANNELS } from '../shared/ipcChannels'
import type { Track, VideoDimensions } from '../shared/track'
import type { Chapter } from '../shared/chapter'
import type { Cue } from '../shared/cue'
import { isSubtitleEncoding, type SubtitleEncoding } from '../shared/subtitleEncoding'
import type { IpcMainHandleLike } from './playerBridge'

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
  ipc.handle(MEDIA_CHANNELS.readPlaylist, (_e, filePath) => service.readPlaylist(filePath))
  ipc.handle(MEDIA_CHANNELS.savePlaylist, (_e, paths) => service.savePlaylist(paths))
  ipc.handle(MEDIA_CHANNELS.openSubtitleFile, () => service.openSubtitleFile())
  ipc.handle(MEDIA_CHANNELS.enumerateTracks, (_e, filePath) => service.enumerateTracks(filePath))
  ipc.handle(MEDIA_CHANNELS.loadSubtitle, (_e, filePath, streamIndex) =>
    service.loadSubtitle(filePath, streamIndex)
  )
  ipc.handle(MEDIA_CHANNELS.loadExternalSubtitle, (_e, subtitlePath, suppliedEncoding: unknown) => {
    const encoding = suppliedEncoding === undefined ? 'auto' : suppliedEncoding
    if (!isSubtitleEncoding(encoding)) throw new Error('Unsupported subtitle encoding.')
    return service.loadExternalSubtitle(subtitlePath, encoding)
  })
  ipc.handle(MEDIA_CHANNELS.getVideoDimensions, (_e, filePath) =>
    service.getVideoDimensions(filePath)
  )
  ipc.handle(MEDIA_CHANNELS.getChapters, (_e, filePath) => service.getChapters(filePath))
  ipc.handle(MEDIA_CHANNELS.folderNeighbors, (_e, filePath) => service.folderNeighbors(filePath))
  ipc.handle(MEDIA_CHANNELS.thumbnail, (_e, filePath, timeSec, durationSec) =>
    service.getThumbnail(filePath, timeSec, durationSec)
  )
}
