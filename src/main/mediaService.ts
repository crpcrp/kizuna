// Real MediaService: the Electron-glue counterpart to mediaBridge.ts's
// MediaServiceLike, mirroring startPlayer's pattern in index.ts. Composes
// enumerateTracks and loadSubtitleCues with a real (or injected) open-file
// dialog.
//
// ffprobePath/ffmpegPath are passed in by the caller; index.ts resolves
// them for packaged vs dev via `resolveBinaryPaths` in resourcePaths.ts.

import { basename, dirname, join } from 'node:path'
import { readFile, readdir, rm, stat, unlink, writeFile } from 'node:fs/promises'
import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { dialog, type OpenDialogOptions, type SaveDialogOptions } from 'electron'
import { parseM3u, serializeM3u } from '../shared/m3u'
import {
  enumerateTracks as enumerateTracksImpl,
  enumerateChapters,
  enumerateVideoDimensions,
  execFfprobe,
  type FfprobeExec
} from './media/ffprobe'
import {
  loadSubtitleCues,
  pickParser,
  readTextFile,
  type ReadTextFile
} from './media/subtitleLoader'
import { decodeSubtitleBytes } from './media/subtitleEncoding'
import { execFfmpeg, type FfmpegExec } from './media/ffmpeg'
import {
  classifyMediaFileName,
  PLAYLIST_EXTENSIONS,
  SUBTITLE_EXTENSIONS,
  VIDEO_EXTENSIONS
} from '../shared/mediaFileTypes'
import type { Track, VideoDimensions } from '../shared/track'
import type { Cue } from '../shared/cue'
import type { SubtitleEncoding } from '../shared/subtitleEncoding'
import type { MediaServiceLike } from './mediaBridge'
import { createFolderNavigation, type ReadDir } from './services/folderNavigation'
import {
  createDebouncedThumbnailEviction,
  createThumbnailService,
  sweepThumbnailCacheAsync,
  THUMBNAIL_CACHE_MAX_BYTES,
  type ThumbnailDirFs,
  type ThumbnailAsyncDirFs,
  type ThumbnailFs,
  type ThumbnailService
} from './services/thumbnails'

/** The history dependency used by the file picker; durable state remains main-owned. */
export interface MediaHistoryFolderStore {
  getLastOpenFolder(): string | undefined
  setLastOpenFolder(folder: string): void
}

/**
 * Builds the temp-extraction path for a subtitle stream:
 * `<tmpDir>/kizuna-sub-<basename(inputPath)>-<streamIndex>-<token>.<ext>`,
 * where `container` picks the extension ('ass' -> '.ass', 'srt' -> '.srt') and
 * `token` is an unguessable crypto-random hex suffix.
 *
 * The random token is the security-relevant part: the path used
 * to be fully predictable from the media filename, so on a shared temp dir a
 * local attacker could pre-create it as a symlink and have ffmpeg's `-y`
 * overwrite clobber a victim file (or read the subtitle another user left
 * behind). An unpredictable suffix defeats both. The token defaults to a fresh
 * 72-bit random value but is injectable so callers/tests can pin it. Pure and
 * side-effect free apart from drawing that randomness — does not touch the
 * filesystem.
 */
export function subtitleTempPath(
  tmpDir: string,
  inputPath: string,
  streamIndex: number,
  container: 'ass' | 'srt',
  token: string = randomBytes(9).toString('hex')
): string {
  const stem = basename(inputPath)
  return join(tmpDir, `kizuna-sub-${stem}-${streamIndex}-${token}.${container}`)
}

/** Injected open-file dialog call (real impl: Electron's `dialog.showOpenDialog`). */
export type ShowOpenDialog = (
  options: OpenDialogOptions
) => Promise<{ canceled: boolean; filePaths: string[] }>

/** Real production implementation of `ShowOpenDialog` (the file-type filter
 * comes from the caller's options, not from here). */
export const showOpenFileDialog: ShowOpenDialog = (options) => dialog.showOpenDialog(options)

/** Injected save-file dialog call (real impl: Electron's `dialog.showSaveDialog`). */
export type ShowSaveDialog = (
  options: SaveDialogOptions
) => Promise<{ canceled: boolean; filePath?: string }>

/** Real production implementation of `ShowSaveDialog`. */
export const showSaveFileDialog: ShowSaveDialog = (options) => dialog.showSaveDialog(options)

/** Reads a playlist file as UTF-8 text (both `.m3u` and `.m3u8`). */
export type ReadPlaylistText = (path: string) => Promise<string>

/** Production adapter: reads the playlist file as UTF-8. */
export const readPlaylistText: ReadPlaylistText = (path) => readFile(path, 'utf-8')

/** Writes serialized playlist text to disk. */
export type WritePlaylistText = (path: string, text: string) => Promise<void>

/** Production adapter: writes the playlist file as UTF-8. */
export const writePlaylistText: WritePlaylistText = (path, text) => writeFile(path, text, 'utf-8')

/** Reads standalone subtitle bytes. Kept separate from ffmpeg's UTF-8 text reader. */
export type ReadBinaryFile = (path: string) => Promise<Uint8Array>

/** Production adapter for standalone external subtitle files. */
export const readBinaryFile: ReadBinaryFile = (path) => readFile(path)

/** Deletes an extracted subtitle temp file once its cues are parsed. Injected
 * so tests never touch a real file. */
export type RemoveFile = (path: string) => Promise<void>

/** Production adapter: unlinks the temp file. */
export const removeFile: RemoveFile = (path) => unlink(path)

/** Reads a generated thumbnail jpg into a base64 string (no `data:` prefix). */
export type ReadThumbnailBase64 = (path: string) => Promise<string>

/** Production adapter: reads a cached jpg directly as base64. */
export const readThumbnailBase64: ReadThumbnailBase64 = (path) =>
  readFile(path, { encoding: 'base64' })

/**
 * The real synchronous filesystem boundary the thumbnail service writes
 * through (stat/exists/mkdir/rename). Mirrors the sweep adapter in index.ts —
 * untested node:fs glue, isolated here so the service itself stays fakeable.
 */
const nodeThumbnailFs: ThumbnailFs & ThumbnailDirFs & { remove(path: string): void } = {
  stat: (path) => {
    const s = statSync(path)
    return { size: s.size, mtimeMs: s.mtimeMs }
  },
  exists: (path) => existsSync(path),
  mkdir: (path) => {
    mkdirSync(path, { recursive: true })
  },
  rename: (from, to) => renameSync(from, to),
  readSubdirs: (dir) =>
    readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name),
  readFiles: (dir) =>
    readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name),
  remove: (path) => rmSync(path, { recursive: true, force: true })
}

/** Runtime eviction adapter: unlike startup cleanup, every cache operation is async. */
const nodeThumbnailAsyncFs: ThumbnailAsyncDirFs = {
  readSubdirs: async (dir) =>
    (await readdir(dir, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name),
  readFiles: async (dir) =>
    (await readdir(dir, { withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name),
  stat: async (path) => {
    const result = await stat(path)
    return { size: result.size, mtimeMs: result.mtimeMs }
  },
  remove: async (path) => rm(path, { recursive: true, force: true })
}

function videoDialogOptions(defaultPath?: string): OpenDialogOptions {
  return {
    ...(defaultPath ? { defaultPath } : {}),
    properties: ['openFile'],
    filters: [{ name: 'Media', extensions: [...VIDEO_EXTENSIONS, ...PLAYLIST_EXTENSIONS] }]
  }
}

/** Multi-select variant for "Add files…": videos and playlist files, so a
 * selection can queue several media at once (playlists are expanded caller-side). */
function multiFileDialogOptions(defaultPath?: string): OpenDialogOptions {
  return {
    ...(defaultPath ? { defaultPath } : {}),
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Media', extensions: [...VIDEO_EXTENSIONS, ...PLAYLIST_EXTENSIONS] }]
  }
}

function savePlaylistDialogOptions(defaultPath?: string): SaveDialogOptions {
  return {
    ...(defaultPath ? { defaultPath: join(defaultPath, 'playlist.m3u') } : {}),
    filters: [{ name: 'Playlist', extensions: [...PLAYLIST_EXTENSIONS] }]
  }
}

function subtitleDialogOptions(defaultPath?: string): OpenDialogOptions {
  return {
    ...(defaultPath ? { defaultPath } : {}),
    properties: ['openFile'],
    filters: [{ name: 'Subtitles', extensions: [...SUBTITLE_EXTENSIONS] }]
  }
}

/**
 * Shows the open dialog with `optionsFor(lastOpenFolder)` and resolves the
 * chosen path (undefined if cancelled). A remembered folder can go stale
 * (removable drive, deleted directory) and make the dialog itself reject, so
 * a first failure is retried exactly once without the default path; a second
 * failure propagates.
 */
async function pickFile(
  showOpenDialog: ShowOpenDialog,
  optionsFor: (defaultPath?: string) => OpenDialogOptions,
  lastOpenFolder: string | undefined
): Promise<string | undefined> {
  let result: { canceled: boolean; filePaths: string[] }
  try {
    result = await showOpenDialog(optionsFor(lastOpenFolder))
  } catch (error) {
    if (!lastOpenFolder) throw error
    result = await showOpenDialog(optionsFor())
  }
  if (result.canceled || result.filePaths.length === 0) return undefined
  return result.filePaths[0]
}

/**
 * Multi-select sibling of `pickFile`: resolves every chosen path (empty when
 * cancelled). Retries once without the stale default folder on a first failure,
 * mirroring `pickFile`.
 */
async function pickFiles(
  showOpenDialog: ShowOpenDialog,
  optionsFor: (defaultPath?: string) => OpenDialogOptions,
  lastOpenFolder: string | undefined
): Promise<string[]> {
  let result: { canceled: boolean; filePaths: string[] }
  try {
    result = await showOpenDialog(optionsFor(lastOpenFolder))
  } catch (error) {
    if (!lastOpenFolder) throw error
    result = await showOpenDialog(optionsFor())
  }
  if (result.canceled) return []
  return result.filePaths
}

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
   * from `thumbnailCacheDir` + the node:fs adapter). */
  thumbnailServiceImpl?: ThumbnailService
  /** base64 reader for a generated thumbnail file (tests inject a fake). */
  readThumbnailBase64Impl?: ReadThumbnailBase64
}

/**
 * Builds the real `MediaServiceLike` used by index.ts, wiring together the
 * open-file dialog, ffprobe track enumeration, and ffmpeg subtitle
 * extraction+parsing. Subtitles are always extracted as '.ass': MKV's
 * default subtitle codec is ASS/SSA, and ffmpeg's subtitle conversion
 * (see ffmpeg.ts's `subtitleCodecForOutput`) losslessly re-muxes an ASS
 * stream into a '.ass' file, so defaulting to '.ass' avoids lossy
 * ASS->SRT conversion for the common case.
 */
export function createMediaService(config: MediaServiceConfig): MediaServiceLike {
  const showOpenDialog = config.showOpenDialog ?? showOpenFileDialog
  const showSaveDialog = config.showSaveDialog ?? showSaveFileDialog
  const execFfprobeFn = config.execFfprobeImpl ?? execFfprobe
  const execFfmpegFn = config.execFfmpegImpl ?? execFfmpeg
  const readFileFn = config.readFileImpl ?? readTextFile
  const readExternalFileFn = config.readExternalFileImpl ?? readBinaryFile
  const removeFileFn = config.removeFileImpl ?? removeFile
  const readPlaylistTextFn = config.readPlaylistTextImpl ?? readPlaylistText
  const writePlaylistTextFn = config.writePlaylistTextImpl ?? writePlaylistText
  const folderNavigation = createFolderNavigation(config.readDirImpl ?? readdir)
  const readThumbnailBase64Fn = config.readThumbnailBase64Impl ?? readThumbnailBase64
  const thumbnailService =
    config.thumbnailServiceImpl ??
    (config.thumbnailCacheDir
      ? createThumbnailService({
          exec: execFfmpegFn,
          fs: nodeThumbnailFs,
          cacheDir: config.thumbnailCacheDir,
          ffmpegPath: config.ffmpegPath,
          evictionScheduler: createDebouncedThumbnailEviction({
            sweep: async () => {
              try {
                await sweepThumbnailCacheAsync({
                  cacheDir: config.thumbnailCacheDir!,
                  maxBytes: THUMBNAIL_CACHE_MAX_BYTES,
                  fs: nodeThumbnailAsyncFs
                })
              } catch (error) {
                console.warn('[kizuna] thumbnail cache sweep failed:', error)
              }
            }
          })
        })
      : undefined)

  return {
    async openFile(): Promise<string | undefined> {
      const selectedPath = await pickFile(
        showOpenDialog,
        videoDialogOptions,
        config.mediaHistory?.getLastOpenFolder()
      )
      if (selectedPath === undefined) return undefined
      config.mediaHistory?.setLastOpenFolder(dirname(selectedPath))
      return selectedPath
    },

    async openFiles(): Promise<string[]> {
      const paths = await pickFiles(
        showOpenDialog,
        multiFileDialogOptions,
        config.mediaHistory?.getLastOpenFolder()
      )
      // Remember the folder of the first pick, exactly as single-select openFile does.
      if (paths.length > 0) config.mediaHistory?.setLastOpenFolder(dirname(paths[0]))
      return paths
    },

    async openFolder(): Promise<string[]> {
      const lastOpenFolder = config.mediaHistory?.getLastOpenFolder()
      let result: { canceled: boolean; filePaths: string[] }
      try {
        result = await showOpenDialog({
          ...(lastOpenFolder ? { defaultPath: lastOpenFolder } : {}),
          properties: ['openDirectory']
        })
      } catch (error) {
        if (!lastOpenFolder) throw error
        result = await showOpenDialog({ properties: ['openDirectory'] })
      }
      if (result.canceled || result.filePaths.length === 0) return []
      const folder = result.filePaths[0]
      config.mediaHistory?.setLastOpenFolder(folder)
      return folderNavigation.videosIn(folder)
    },

    async readPlaylist(filePath: string): Promise<string[]> {
      const text = await readPlaylistTextFn(filePath)
      return parseM3u(text, dirname(filePath))
    },

    async savePlaylist(paths: string[]): Promise<string | undefined> {
      const result = await showSaveDialog(
        savePlaylistDialogOptions(config.mediaHistory?.getLastOpenFolder())
      )
      if (result.canceled || !result.filePath) return undefined
      await writePlaylistTextFn(result.filePath, serializeM3u(paths))
      return result.filePath
    },

    // Opens where the last *video* was picked (a sidecar normally sits next to
    // its video) but never writes the folder back: `lastOpenFolder` is the
    // video picker's memory, and a subtitle picked from elsewhere must not
    // move it.
    openSubtitleFile(): Promise<string | undefined> {
      return pickFile(
        showOpenDialog,
        subtitleDialogOptions,
        config.mediaHistory?.getLastOpenFolder()
      )
    },

    enumerateTracks(filePath: string): Promise<Track[]> {
      return enumerateTracksImpl(config.ffprobePath, filePath, execFfprobeFn)
    },

    async loadSubtitle(filePath: string, streamIndex: number): Promise<Cue[]> {
      const outputPath = subtitleTempPath(config.tmpDir, filePath, streamIndex, 'ass')
      try {
        return await loadSubtitleCues(
          { ffmpegPath: config.ffmpegPath, inputPath: filePath, streamIndex, outputPath },
          { exec: execFfmpegFn, readFile: readFileFn }
        )
      } finally {
        // The extracted subtitle is only needed until it is parsed into cues;
        // remove it so it does not linger in the temp dir. A missing/failed
        // extraction leaves nothing to delete, so swallow unlink errors.
        await removeFileFn(outputPath).catch(() => {})
      }
    },

    async loadExternalSubtitle(
      subtitlePath: string,
      encoding: SubtitleEncoding = 'auto'
    ): Promise<Cue[]> {
      if (classifyMediaFileName(subtitlePath) !== 'subtitle') {
        throw new Error('Unsupported subtitle file type.')
      }
      // No ffmpeg here: a standalone subtitle file is already in a format the
      // parsers read, so it goes straight from disk through pickParser.
      const content = decodeSubtitleBytes(await readExternalFileFn(subtitlePath), encoding)
      const cues = pickParser(subtitlePath)(content)
      if (cues.length === 0) throw new Error('No subtitles found in this file.')
      return cues
    },

    getVideoDimensions(filePath: string): Promise<VideoDimensions | undefined> {
      return enumerateVideoDimensions(config.ffprobePath, filePath, execFfprobeFn)
    },

    getChapters(filePath: string) {
      return enumerateChapters(config.ffprobePath, filePath, execFfprobeFn)
    },

    folderNeighbors(filePath: string): Promise<{ prev?: string; next?: string }> {
      return folderNavigation.neighborsOf(filePath)
    },

    // Resolves the cached frame to a base64 data URL — the renderer can't read
    // arbitrary file:// paths, so the encoded image crosses IPC inline. The
    // service memoizes the cache-key stat per path and caches misses/failures,
    // so a cache hit here never re-runs ffmpeg (see thumbnails.ts).
    async getThumbnail(
      filePath: string,
      timeSec: number,
      durationSec: number
    ): Promise<{ dataUrl: string } | null> {
      if (!thumbnailService) return null
      const cachePath = await thumbnailService.getThumbnail(filePath, timeSec, durationSec)
      if (cachePath === null) return null
      const base64 = await readThumbnailBase64Fn(cachePath)
      return { dataUrl: `data:image/jpeg;base64,${base64}` }
    }
  }
}
