import { MEDIA_HISTORY_CHANNELS } from '../shared/ipcChannels'
import type { FileAvailability } from '../shared/preloadApi'
import {
  isContentVersion,
  normalizeStoredTrackSelection,
  normalizeSubtitleSelection,
  type MediaPlaybackHistory,
  type RecentMediaFile,
  type StoredSubtitleSelection,
  type StoredTrackSelection
} from '../shared/mediaHistory'
import { isFiniteNumber, isNonEmptyString } from '../shared/guards'
import type { IpcMainHandleLike } from './ipc'
import { expect, invalidRequest } from './ipcValidation'

/** Main-owned history and filesystem operations exposed to the renderer. */
export interface MediaHistoryBridgeService {
  getRecentFiles(): RecentMediaFile[]
  getPlaybackHistory(path: string): MediaPlaybackHistory | undefined
  removeRecentFile(path: string): RecentMediaFile[]
  clearRecentFiles(): void
  checkFileAvailability(path: string): Promise<FileAvailability>
  setAudioTrack(path: string, track: StoredTrackSelection): void
  setSubtitleTrack(path: string, selection: StoredSubtitleSelection): void
  setSubtitleVersionOffset(path: string, contentVersion: string, offsetMs: number): void
}

/** Registers the typed, serializable media-history IPC surface. */
export function registerMediaHistoryBridge<E>(
  ipc: IpcMainHandleLike<E>,
  service: MediaHistoryBridgeService
): void {
  const pathFor = (channel: string) => expect(isNonEmptyString, channel)
  const C = MEDIA_HISTORY_CHANNELS

  ipc.handle(C.getRecentFiles, () => service.getRecentFiles())
  const historyPath = pathFor(C.getPlaybackHistory)
  ipc.handle(C.getPlaybackHistory, (_event, path) => service.getPlaybackHistory(historyPath(path)))
  const removePath = pathFor(C.removeRecentFile)
  ipc.handle(C.removeRecentFile, (_event, path) => service.removeRecentFile(removePath(path)))
  ipc.handle(C.clearRecentFiles, () => service.clearRecentFiles())
  const availabilityPath = pathFor(C.checkFileAvailability)
  ipc.handle(C.checkFileAvailability, (_event, path) =>
    service.checkFileAvailability(availabilityPath(path))
  )
  const audioPath = pathFor(C.setAudioTrack)
  ipc.handle(C.setAudioTrack, (_event, path, rawTrack) => {
    const validPath = audioPath(path)
    const track = normalizeStoredTrackSelection(rawTrack)
    if (!track) throw invalidRequest(C.setAudioTrack)
    service.setAudioTrack(validPath, track)
  })
  const subtitlePath = pathFor(C.setSubtitleTrack)
  ipc.handle(C.setSubtitleTrack, (_event, path, rawSelection) => {
    const validPath = subtitlePath(path)
    const selection = normalizeSubtitleSelection(rawSelection)
    if (!selection) throw invalidRequest(C.setSubtitleTrack)
    service.setSubtitleTrack(validPath, selection)
  })
  const offsetPath = pathFor(C.setSubtitleVersionOffset)
  const offsetVersion = expect(isContentVersion, C.setSubtitleVersionOffset)
  const offsetMsArg = expect(isFiniteNumber, C.setSubtitleVersionOffset)
  ipc.handle(C.setSubtitleVersionOffset, (_event, path, contentVersion, offsetMs) =>
    service.setSubtitleVersionOffset(
      offsetPath(path),
      offsetVersion(contentVersion),
      offsetMsArg(offsetMs)
    )
  )
}
