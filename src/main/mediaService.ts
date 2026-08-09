// Composition root for the renderer-facing media service. Every concern lives
// in a focused owner under media/ — picking files and playlists
// (media/mediaPicker.ts), subtitles (media/subtitleService.ts), ffprobe
// metadata and folder navigation (media/metadataService.ts), and seekbar
// previews (media/thumbnailPreview.ts). This file only resolves the injected
// implementations to their production defaults and delegates each
// `MediaServiceLike` method to the owner that implements it.
//
// index.ts supplies packaged or development binary paths through
// resourcePaths.ts.

import { readdir } from 'node:fs/promises'
import { execFfprobe, type FfprobeExec } from './media/ffprobe'
import { readTextFile, type ReadTextFile } from './media/subtitleLoader'
import { execFfmpeg, type FfmpegExec } from './media/ffmpeg'
import {
  createMediaPicker,
  readPlaylistText,
  showOpenFileDialog,
  showSaveFileDialog,
  writePlaylistText,
  type MediaHistoryFolderStore,
  type ReadPlaylistText,
  type ShowOpenDialog,
  type ShowSaveDialog,
  type WritePlaylistText
} from './media/mediaPicker'
import {
  createSubtitleService,
  readBinaryFile,
  removeFile,
  type ReadBinaryFile,
  type RemoveFile
} from './media/subtitleService'
import { createMediaMetadataService } from './media/metadataService'
import {
  createCachedThumbnailService,
  createThumbnailPreview,
  readThumbnailBase64,
  type ReadThumbnailBase64
} from './media/thumbnailPreview'
import type { ThumbnailService } from './services/thumbnails/generation'
import type { ReadDir } from './services/folderNavigation'
import type { MediaServiceLike } from './mediaBridge'

export type { MediaHistoryFolderStore, ReadPlaylistText, ShowOpenDialog, ShowSaveDialog }
export type { WritePlaylistText, ReadBinaryFile, RemoveFile, ReadThumbnailBase64 }

/** Configuration for `createMediaService`. */
export interface MediaServiceConfig {
  ffprobePath: string
  ffmpegPath: string
  tmpDir: string
  showOpenDialog?: ShowOpenDialog
  showSaveDialog?: ShowSaveDialog
  mediaHistory?: MediaHistoryFolderStore
  execFfprobeImpl?: FfprobeExec
  execFfmpegImpl?: FfmpegExec
  /** UTF-8 text reader for ffmpeg-extracted subtitle output. */
  readFileImpl?: ReadTextFile
  /** Byte reader for standalone external subtitle files. */
  readExternalFileImpl?: ReadBinaryFile
  /** Deletes an extracted subtitle temp file after its cues are parsed. */
  removeFileImpl?: RemoveFile
  /** UTF-8 text reader for `.m3u`/`.m3u8` playlist files. */
  readPlaylistTextImpl?: ReadPlaylistText
  /** UTF-8 text writer for exported playlists. */
  writePlaylistTextImpl?: WritePlaylistText
  /** Directory reader for same-folder video navigation. */
  readDirImpl?: ReadDir
  /** Cache directory for seekbar hover thumbnails. Omitted → previews disabled
   * (getThumbnail resolves null); index.ts passes `<userData>/thumbnails`. */
  thumbnailCacheDir?: string
  /** Pre-built thumbnail service (tests inject a fake; production builds one
   * from `thumbnailCacheDir` + the node:fs adapters). */
  thumbnailServiceImpl?: ThumbnailService
  /** base64 reader for a generated thumbnail file (tests inject a fake). */
  readThumbnailBase64Impl?: ReadThumbnailBase64
  /** Path semantics for every composed owner; defaults to the host platform. */
  platform?: NodeJS.Platform
}

/**
 * Builds the real `MediaServiceLike` used by index.ts by composing the four
 * media owners and forwarding each bridge method to one of them.
 */
export function createMediaService(config: MediaServiceConfig): MediaServiceLike {
  const execFfmpegFn = config.execFfmpegImpl ?? execFfmpeg

  const metadata = createMediaMetadataService({
    ffprobePath: config.ffprobePath,
    execFfprobe: config.execFfprobeImpl ?? execFfprobe,
    readDir: config.readDirImpl ?? readdir,
    platform: config.platform
  })

  const picker = createMediaPicker({
    showOpenDialog: config.showOpenDialog ?? showOpenFileDialog,
    showSaveDialog: config.showSaveDialog ?? showSaveFileDialog,
    readPlaylistText: config.readPlaylistTextImpl ?? readPlaylistText,
    writePlaylistText: config.writePlaylistTextImpl ?? writePlaylistText,
    listVideosIn: (folder) => metadata.videosIn(folder),
    mediaHistory: config.mediaHistory,
    platform: config.platform
  })

  const subtitles = createSubtitleService({
    ffmpegPath: config.ffmpegPath,
    tmpDir: config.tmpDir,
    execFfmpeg: execFfmpegFn,
    readText: config.readFileImpl ?? readTextFile,
    readBinary: config.readExternalFileImpl ?? readBinaryFile,
    removeFile: config.removeFileImpl ?? removeFile,
    platform: config.platform
  })

  const thumbnails = createThumbnailPreview({
    thumbnails:
      config.thumbnailServiceImpl ??
      (config.thumbnailCacheDir
        ? createCachedThumbnailService({
            cacheDir: config.thumbnailCacheDir,
            ffmpegPath: config.ffmpegPath,
            execFfmpeg: execFfmpegFn,
            platform: config.platform
          })
        : undefined),
    readBase64: config.readThumbnailBase64Impl ?? readThumbnailBase64
  })

  return {
    openFile: () => picker.openFile(),
    openFiles: () => picker.openFiles(),
    openFolder: () => picker.openFolder(),
    readPlaylist: (filePath) => picker.readPlaylist(filePath),
    savePlaylist: (paths) => picker.savePlaylist(paths),
    openSubtitleFile: () => picker.openSubtitleFile(),
    enumerateTracks: (filePath) => metadata.enumerateTracks(filePath),
    loadSubtitle: (filePath, streamIndex) => subtitles.loadSubtitle(filePath, streamIndex),
    loadExternalSubtitle: (subtitlePath, encoding) =>
      subtitles.loadExternalSubtitle(subtitlePath, encoding),
    getVideoDimensions: (filePath) => metadata.getVideoDimensions(filePath),
    getChapters: (filePath) => metadata.getChapters(filePath),
    folderNeighbors: (filePath) => metadata.folderNeighbors(filePath),
    getThumbnail: (filePath, timeSec, durationSec) =>
      thumbnails.getThumbnail(filePath, timeSec, durationSec)
  }
}
