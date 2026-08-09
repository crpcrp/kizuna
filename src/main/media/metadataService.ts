// Owner of read-only media metadata and same-folder navigation: everything the
// renderer asks about a file that comes from ffprobe or from listing its
// folder. The ffprobe argv/parsing lives in ffprobe.ts and the sorting rules in
// services/folderNavigation.ts; this module binds them to the configured
// binary and directory reader.

import {
  enumerateTracks,
  enumerateChapters,
  enumerateVideoDimensions,
  type FfprobeExec
} from './ffprobe'
import { createFolderNavigation, type ReadDir } from '../services/folderNavigation'
import type { Chapter } from '../../shared/chapter'
import type { Track, VideoDimensions } from '../../shared/track'

/** The metadata/navigation slice of `MediaServiceLike`, plus the folder listing
 * the picker needs for "open folder". */
export interface MediaMetadataService {
  enumerateTracks(filePath: string): Promise<Track[]>
  getVideoDimensions(filePath: string): Promise<VideoDimensions | undefined>
  getChapters(filePath: string): Promise<Chapter[]>
  folderNeighbors(filePath: string): Promise<{ prev?: string; next?: string }>
  /** Naturally-sorted absolute video paths in `folder`. */
  videosIn(folder: string): Promise<string[]>
}

export interface MediaMetadataDeps {
  ffprobePath: string
  execFfprobe: FfprobeExec
  readDir: ReadDir
  /** Path semantics for folder navigation; defaults to the host platform. */
  platform?: NodeJS.Platform
}

export function createMediaMetadataService(deps: MediaMetadataDeps): MediaMetadataService {
  const folderNavigation = createFolderNavigation(deps.readDir, deps.platform)

  return {
    enumerateTracks(filePath: string): Promise<Track[]> {
      return enumerateTracks(deps.ffprobePath, filePath, deps.execFfprobe)
    },

    getVideoDimensions(filePath: string): Promise<VideoDimensions | undefined> {
      return enumerateVideoDimensions(deps.ffprobePath, filePath, deps.execFfprobe)
    },

    getChapters(filePath: string): Promise<Chapter[]> {
      return enumerateChapters(deps.ffprobePath, filePath, deps.execFfprobe)
    },

    folderNeighbors(filePath: string): Promise<{ prev?: string; next?: string }> {
      return folderNavigation.neighborsOf(filePath)
    },

    videosIn(folder: string): Promise<string[]> {
      return folderNavigation.videosIn(folder)
    }
  }
}
