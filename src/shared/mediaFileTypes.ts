// Single source of truth for the file extensions Kizuna opens: the main
// process's open-file dialog filter and the renderer's drag-and-drop
// classification both read them from here. Pure — no I/O, no Electron.

export const VIDEO_EXTENSIONS = ['mkv', 'mp4', 'webm', 'avi', 'mov'] as const
export const SUBTITLE_EXTENSIONS = ['srt', 'ass', 'ssa'] as const
export const PLAYLIST_EXTENSIONS = ['m3u', 'm3u8'] as const

export type DroppedFileKind = 'video' | 'subtitle' | 'playlist' | 'unknown'

/**
 * True when `path` begins with a URL scheme rather than naming a local
 * filesystem path. Every playback entry point uses this check before probing,
 * normalizing, or passing a path to mpv. Windows drive paths are explicitly
 * excluded because their leading letter and colon are not a URL scheme.
 */
export function isRemoteUrl(path: unknown): boolean {
  if (typeof path !== 'string') return false
  const trimmed = path.trim()
  if (/^[A-Za-z]:[\\/]/.test(trimmed)) return false
  return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(trimmed)
}

function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  // A leading dot is a dotfile ('.gitignore'), not an extension.
  if (dot <= 0) return ''
  return fileName.slice(dot + 1).toLowerCase()
}

function basenameWithoutExtension(fileName: string): string {
  const dot = fileName.lastIndexOf('.')
  return dot <= 0 ? fileName : fileName.slice(0, dot)
}

/** Classifies by extension, case-insensitive; no extension → 'unknown'. */
export function classifyMediaFileName(fileName: string): DroppedFileKind {
  const ext = extensionOf(fileName)
  if ((VIDEO_EXTENSIONS as readonly string[]).includes(ext)) return 'video'
  if ((SUBTITLE_EXTENSIONS as readonly string[]).includes(ext)) return 'subtitle'
  if ((PLAYLIST_EXTENSIONS as readonly string[]).includes(ext)) return 'playlist'
  return 'unknown'
}

/**
 * Picks what a multi-file drop should act on. Precedence: the first video (it
 * always wins — dropping a video next to its subtitle should play the video,
 * with the subtitle handled as a sidecar), else the first `.m3u`/`.m3u8`
 * playlist (its entries are appended to the queue), else the first
 * subtitle, else undefined.
 */
export function pickDropTarget(
  fileNames: string[]
):
  | { kind: 'video'; index: number; subtitleIndex?: number }
  | { kind: 'playlist'; index: number }
  | { kind: 'subtitle'; index: number }
  | undefined {
  let playlistIndex = -1
  let subtitleIndex = -1
  for (let i = 0; i < fileNames.length; i++) {
    const kind = classifyMediaFileName(fileNames[i])
    if (kind === 'video') {
      const videoBasename = basenameWithoutExtension(fileNames[i]).toLowerCase()
      const matchingSubtitleIndex = fileNames.findIndex(
        (fileName, index) =>
          index !== i &&
          classifyMediaFileName(fileName) === 'subtitle' &&
          basenameWithoutExtension(fileName).toLowerCase() === videoBasename
      )
      return matchingSubtitleIndex === -1
        ? { kind: 'video', index: i }
        : { kind: 'video', index: i, subtitleIndex: matchingSubtitleIndex }
    }
    if (kind === 'playlist' && playlistIndex === -1) playlistIndex = i
    if (kind === 'subtitle' && subtitleIndex === -1) subtitleIndex = i
  }
  if (playlistIndex !== -1) return { kind: 'playlist', index: playlistIndex }
  return subtitleIndex === -1 ? undefined : { kind: 'subtitle', index: subtitleIndex }
}
