import type { IpcMain } from 'electron'
import { LAUNCH_CHANNELS } from '../../shared/ipcChannels'
import { scheduleStartupThumbnailSweep } from '../media/thumbnailPreview'
import { registerMediaBridge } from '../mediaBridge'
import { registerMediaHistoryBridge } from '../mediaHistoryBridge'
import { createMediaService } from '../mediaService'
import type { BinaryPaths } from '../resourcePaths'
import { isJimakuManagedSubtitlePath } from '../services/jimaku/downloadStore'
import { createMediaHistoryService, type MediaHistoryService } from '../services/mediaHistory'
import {
  createMediaHistoryFile,
  createMediaHistoryStore,
  type MediaHistoryStore
} from '../services/mediaHistoryStore'
import type { AppPaths } from './paths'

export function createAppMediaHistoryStore(paths: AppPaths): MediaHistoryStore {
  return createMediaHistoryStore(createMediaHistoryFile(paths.playbackHistoryFile))
}

/** Builds playback history over `store` and registers its IPC bridge. */
export function startMediaHistory(deps: {
  ipcMain: IpcMain
  paths: AppPaths
  store: MediaHistoryStore
}): MediaHistoryService {
  const { jimakuCacheRoot } = deps.paths
  const history = createMediaHistoryService({
    store: deps.store,
    isKnownManagedSubtitle: (path, provenance) =>
      isJimakuManagedSubtitlePath(path, provenance, jimakuCacheRoot)
  })
  registerMediaHistoryBridge(deps.ipcMain, history)
  return history
}

/**
 * Schedules the thumbnail-cache sweep and registers the media IPC bridge
 * (open-file dialog, ffprobe track enumeration, ffmpeg subtitle extraction).
 */
export function startMedia(deps: {
  ipcMain: IpcMain
  paths: AppPaths
  binaryPaths: BinaryPaths
  mediaHistory: MediaHistoryService
}): void {
  const { ipcMain, paths, binaryPaths } = deps
  scheduleStartupThumbnailSweep({
    onceRendererReady: (listener) => ipcMain.once(LAUNCH_CHANNELS.rendererReady, listener),
    cacheDir: paths.thumbnailCacheDir
  })
  registerMediaBridge(
    ipcMain,
    createMediaService({
      ffprobePath: binaryPaths.ffprobePath,
      ffmpegPath: binaryPaths.ffmpegPath,
      tmpDir: paths.temp,
      mediaHistory: deps.mediaHistory,
      thumbnailCacheDir: paths.thumbnailCacheDir
    })
  )
}
