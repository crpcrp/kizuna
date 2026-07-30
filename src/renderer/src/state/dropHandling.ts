import { pickDropTarget } from '../../../shared/mediaFileTypes'
import type { OpenMediaResult } from './mediaSession'

interface DropHandlerDeps {
  hasVideo: boolean
  currentFilePath: () => string | undefined
  pathForFile: (file: File) => string
  openPath: (path: string) => Promise<OpenMediaResult>
  loadSubtitle: (videoPath: string, subtitlePath: string) => Promise<string | undefined>
  appendPlaylistFile: (path: string) => Promise<number>
  reportError: (message: string) => void
}

export async function handleDroppedFiles(files: File[], deps: DropHandlerDeps): Promise<void> {
  if (files.length === 0) return

  const target = pickDropTarget(files.map((file) => file.name))
  if (!target) {
    deps.reportError('Unsupported file type.')
    return
  }

  const path = deps.pathForFile(files[target.index])
  if (target.kind === 'video') {
    const sidecarPath =
      target.subtitleIndex === undefined ? undefined : deps.pathForFile(files[target.subtitleIndex])
    const result = await deps.openPath(path)
    if (
      result.status !== 'opened' ||
      result.filePath !== path ||
      sidecarPath === undefined ||
      deps.currentFilePath() !== result.filePath
    )
      return
    const warning = await deps.loadSubtitle(result.filePath, sidecarPath)
    if (warning) deps.reportError(warning)
    return
  }
  if (target.kind === 'playlist') {
    const appended = await deps.appendPlaylistFile(path)
    if (appended === 0) deps.reportError('Playlist is empty or unreadable.')
    return
  }
  if (!deps.hasVideo) {
    deps.reportError('Open a video before adding a subtitle file.')
    return
  }
  const currentFilePath = deps.currentFilePath()
  if (currentFilePath === undefined) return
  const warning = await deps.loadSubtitle(currentFilePath, path)
  if (warning) deps.reportError(warning)
}
