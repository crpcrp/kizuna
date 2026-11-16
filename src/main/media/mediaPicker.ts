import { readFile, writeFile } from 'node:fs/promises'
import { dialog, type OpenDialogOptions, type SaveDialogOptions } from 'electron'
import { parseM3u, serializeM3u } from '../../shared/m3u'
import { pathApiFor, pathPlatformFor } from '../platformPath'
import {
  PLAYLIST_EXTENSIONS,
  SUBTITLE_EXTENSIONS,
  VIDEO_EXTENSIONS
} from '../../shared/mediaFileTypes'

export interface MediaHistoryFolderStore {
  getLastOpenFolder(): string | undefined
  setLastOpenFolder(folder: string): void
}

export type ShowOpenDialog = (
  options: OpenDialogOptions
) => Promise<{ canceled: boolean; filePaths: string[] }>

export const showOpenFileDialog: ShowOpenDialog = (options) => dialog.showOpenDialog(options)

export type ShowSaveDialog = (
  options: SaveDialogOptions
) => Promise<{ canceled: boolean; filePath?: string }>

export const showSaveFileDialog: ShowSaveDialog = (options) => dialog.showSaveDialog(options)

export type ReadPlaylistText = (path: string) => Promise<string>

export const readPlaylistText: ReadPlaylistText = (path) => readFile(path, 'utf-8')

export type WritePlaylistText = (path: string, text: string) => Promise<void>

export const writePlaylistText: WritePlaylistText = (path, text) => writeFile(path, text, 'utf-8')

function videoDialogOptions(defaultPath?: string): OpenDialogOptions {
  return {
    ...(defaultPath ? { defaultPath } : {}),
    properties: ['openFile'],
    filters: [{ name: 'Media', extensions: [...VIDEO_EXTENSIONS, ...PLAYLIST_EXTENSIONS] }]
  }
}

function multiFileDialogOptions(defaultPath?: string): OpenDialogOptions {
  return {
    ...(defaultPath ? { defaultPath } : {}),
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Media', extensions: [...VIDEO_EXTENSIONS, ...PLAYLIST_EXTENSIONS] }]
  }
}

function savePlaylistDialogOptions(
  join: (...segments: string[]) => string,
  defaultPath?: string
): SaveDialogOptions {
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

// A remembered folder can disappear (for example, a removed drive); retry once
// without defaultPath if opening the dialog fails.
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

async function pickFile(
  showOpenDialog: ShowOpenDialog,
  optionsFor: (defaultPath?: string) => OpenDialogOptions,
  lastOpenFolder: string | undefined
): Promise<string | undefined> {
  const result = await showWithFolderRetry(showOpenDialog, optionsFor, lastOpenFolder)
  if (result.canceled || result.filePaths.length === 0) return undefined
  return result.filePaths[0]
}

async function pickFiles(
  showOpenDialog: ShowOpenDialog,
  optionsFor: (defaultPath?: string) => OpenDialogOptions,
  lastOpenFolder: string | undefined
): Promise<string[]> {
  const result = await showWithFolderRetry(showOpenDialog, optionsFor, lastOpenFolder)
  if (result.canceled) return []
  return result.filePaths
}

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
  listVideosIn: (folder: string) => Promise<string[]>
  mediaHistory?: MediaHistoryFolderStore
  platform?: NodeJS.Platform
}

export function createMediaPicker(deps: MediaPickerDeps): MediaPicker {
  const lastOpenFolder = (): string | undefined => deps.mediaHistory?.getLastOpenFolder()
  const { dirname, join } = pathApiFor(deps.platform)

  return {
    async openFile(): Promise<string | undefined> {
      const selectedPath = await pickFile(deps.showOpenDialog, videoDialogOptions, lastOpenFolder())
      if (selectedPath === undefined) return undefined
      deps.mediaHistory?.setLastOpenFolder(dirname(selectedPath))
      return selectedPath
    },

    async openFiles(): Promise<string[]> {
      const paths = await pickFiles(deps.showOpenDialog, multiFileDialogOptions, lastOpenFolder())
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
      return parseM3u(text, dirname(filePath), { platform: pathPlatformFor(deps.platform) })
    },

    async savePlaylist(paths: string[]): Promise<string | undefined> {
      const result = await deps.showSaveDialog(savePlaylistDialogOptions(join, lastOpenFolder()))
      if (result.canceled || !result.filePath) return undefined
      await deps.writePlaylistText(result.filePath, serializeM3u(paths))
      return result.filePath
    },

    // Sidecars usually sit beside the video, but choosing one elsewhere must not
    // change the video picker's remembered folder.
    openSubtitleFile(): Promise<string | undefined> {
      return pickFile(deps.showOpenDialog, subtitleDialogOptions, lastOpenFolder())
    }
  }
}
