import * as fs from 'node:fs'
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
  legacyMediaHistory,
  type MediaHistoryStore
} from '../services/mediaHistoryStore'
import { createSettingsFile } from '../services/settingsFile'
import type { AppPaths } from './paths'

/**
 * Playback history lives in its own file. On first run it is seeded from the
 * `mediaHistory` key that older versions kept in settings.json; the settings
 * store drops that key on its next write, so read history before any settings
 * write can happen.
 */
export function createAppMediaHistoryStore(paths: AppPaths): MediaHistoryStore {
  const settingsFile = createSettingsFile(paths.settingsFile, fs)
  return createMediaHistoryStore(createMediaHistoryFile(paths.playbackHistoryFile, fs), {
    legacy: () => legacyMediaHistory(settingsFile.read())
  })
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
