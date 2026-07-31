// Owner of every file-chooser and playlist-file concern: the Electron dialog
// seams, the per-dialog filter/option builders, the stale-folder retry, and
// reading/writing `.m3u` playlists. mediaService.ts composes this; nothing here
// knows about ffprobe, subtitles, or thumbnails.

import { dirname, join } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { dialog, type OpenDialogOptions, type SaveDialogOptions } from 'electron'
import { parseM3u, serializeM3u } from '../../shared/m3u'
import {
  PLAYLIST_EXTENSIONS,
  SUBTITLE_EXTENSIONS,
  VIDEO_EXTENSIONS
} from '../../shared/mediaFileTypes'

/** The history dependency used by the file picker; durable state remains main-owned. */
export interface MediaHistoryFolderStore {
  getLastOpenFolder(): string | undefined
  setLastOpenFolder(folder: string): void
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
 * Shows the open dialog with `optionsFor(lastOpenFolder)`. A remembered folder
 * can go stale (removable drive, deleted directory) and make the dialog itself
 * reject, so a first failure is retried exactly once without the default path;
 * a second failure propagates.
 */
async function showWithFolderRetry(
  showOpenDialog: ShowOpenDialog,
  optionsFor: (defaultPath?: string) => OpenDialogOptions,
  lastOpenFolder: string | undefined
): Promise<{ canceled: boolean; filePaths: string[] }> {
  try {
    return await showOpenDialog(optionsFor(lastOpenFolder))
  } catch (error) {
    if (!lastOpenFolder) throw error
    return showOpenDialog(optionsFor())
  }
}

/** Single-select pick: the chosen path, or undefined when cancelled. */
async function pickFile(
  showOpenDialog: ShowOpenDialog,
  optionsFor: (defaultPath?: string) => OpenDialogOptions,
  lastOpenFolder: string | undefined
): Promise<string | undefined> {
  const result = await showWithFolderRetry(showOpenDialog, optionsFor, lastOpenFolder)
  if (result.canceled || result.filePaths.length === 0) return undefined
  return result.filePaths[0]
}

/** Multi-select sibling of `pickFile`: every chosen path (empty when cancelled). */
async function pickFiles(
  showOpenDialog: ShowOpenDialog,
  optionsFor: (defaultPath?: string) => OpenDialogOptions,
  lastOpenFolder: string | undefined
): Promise<string[]> {
  const result = await showWithFolderRetry(showOpenDialog, optionsFor, lastOpenFolder)
  if (result.canceled) return []
  return result.filePaths
}

/** The picker/playlist slice of `MediaServiceLike`. */
export interface MediaPicker {
  openFile(): Promise<string | undefined>
  openFiles(): Promise<string[]>
  openFolder(): Promise<string[]>
  readPlaylist(filePath: string): Promise<string[]>
  savePlaylist(paths: string[]): Promise<string | undefined>
  openSubtitleFile(): Promise<string | undefined>
}

export interface MediaPickerDeps {
  showOpenDialog: ShowOpenDialog
  showSaveDialog: ShowSaveDialog
  readPlaylistText: ReadPlaylistText
  writePlaylistText: WritePlaylistText
  /** Naturally-sorted absolute video paths in a chosen folder. */
  listVideosIn: (folder: string) => Promise<string[]>
  mediaHistory?: MediaHistoryFolderStore
}

export function createMediaPicker(deps: MediaPickerDeps): MediaPicker {
  const lastOpenFolder = (): string | undefined => deps.mediaHistory?.getLastOpenFolder()

  return {
    async openFile(): Promise<string | undefined> {
      const selectedPath = await pickFile(deps.showOpenDialog, videoDialogOptions, lastOpenFolder())
      if (selectedPath === undefined) return undefined
      deps.mediaHistory?.setLastOpenFolder(dirname(selectedPath))
      return selectedPath
    },

    async openFiles(): Promise<string[]> {
      const paths = await pickFiles(deps.showOpenDialog, multiFileDialogOptions, lastOpenFolder())
      // Remember the folder of the first pick, exactly as single-select openFile does.
      if (paths.length > 0) deps.mediaHistory?.setLastOpenFolder(dirname(paths[0]))
      return paths
    },

    async openFolder(): Promise<string[]> {
      const result = await showWithFolderRetry(
        deps.showOpenDialog,
        (defaultPath) => ({
          ...(defaultPath ? { defaultPath } : {}),
          properties: ['openDirectory']
        }),
        lastOpenFolder()
      )
      if (result.canceled || result.filePaths.length === 0) return []
      const folder = result.filePaths[0]
      deps.mediaHistory?.setLastOpenFolder(folder)
      return deps.listVideosIn(folder)
    },

    async readPlaylist(filePath: string): Promise<string[]> {
      const text = await deps.readPlaylistText(filePath)
      return parseM3u(text, dirname(filePath))
    },

    async savePlaylist(paths: string[]): Promise<string | undefined> {
      const result = await deps.showSaveDialog(savePlaylistDialogOptions(lastOpenFolder()))
      if (result.canceled || !result.filePath) return undefined
      await deps.writePlaylistText(result.filePath, serializeM3u(paths))
      return result.filePath
    },

    // Opens where the last *video* was picked (a sidecar normally sits next to
    // its video) but never writes the folder back: `lastOpenFolder` is the
    // video picker's memory, and a subtitle picked from elsewhere must not
    // move it.
    openSubtitleFile(): Promise<string | undefined> {
      return pickFile(deps.showOpenDialog, subtitleDialogOptions, lastOpenFolder())
    }
  }
}
