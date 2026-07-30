import { MEDIA_HISTORY_CHANNELS } from '../shared/ipcChannels'
import type { FileAvailability } from '../shared/preloadApi'
import type {
  MediaPlaybackHistory,
  RecentMediaFile,
  StoredSubtitleSelection,
  StoredTrackSelection
} from '../shared/mediaHistory'
import type { IpcMainHandleLike } from './ipc'

/** Main-owned history and filesystem operations exposed to the renderer. */
export interface MediaHistoryBridgeService {
  getRecentFiles(): RecentMediaFile[]
  getPlaybackHistory(path: string): MediaPlaybackHistory | undefined
  removeRecentFile(path: string): RecentMediaFile[]
  clearRecentFiles(): void
  checkFileAvailability(path: string): Promise<FileAvailability>
  setAudioTrack(path: string, track: StoredTrackSelection): void
  setSubtitleTrack(path: string, selection: StoredSubtitleSelection): void
}

/** Registers the typed, serializable media-history IPC surface. */
export function registerMediaHistoryBridge<E>(
  ipc: IpcMainHandleLike<E>,
  service: MediaHistoryBridgeService
): void {
  ipc.handle(MEDIA_HISTORY_CHANNELS.getRecentFiles, () => service.getRecentFiles())
  ipc.handle(MEDIA_HISTORY_CHANNELS.getPlaybackHistory, (_event, path: string) =>
    service.getPlaybackHistory(path)
  )
  ipc.handle(MEDIA_HISTORY_CHANNELS.removeRecentFile, (_event, path: string) =>
    service.removeRecentFile(path)
  )
  ipc.handle(MEDIA_HISTORY_CHANNELS.clearRecentFiles, () => service.clearRecentFiles())
  ipc.handle(MEDIA_HISTORY_CHANNELS.checkFileAvailability, (_event, path: string) =>
    service.checkFileAvailability(path)
  )
  ipc.handle(
    MEDIA_HISTORY_CHANNELS.setAudioTrack,
    (_event, path: string, track: StoredTrackSelection) => service.setAudioTrack(path, track)
  )
  ipc.handle(
    MEDIA_HISTORY_CHANNELS.setSubtitleTrack,
    (_event, path: string, selection: StoredSubtitleSelection) =>
      service.setSubtitleTrack(path, selection)
  )
}
