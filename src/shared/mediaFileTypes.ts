// Single source of truth for the file extensions Kizuna opens: the main
// process's open-file dialog filter and the renderer's drag-and-drop
// classification both read them from here. Pure — no I/O, no Electron.

export const VIDEO_EXTENSIONS = ['mkv', 'mp4', 'webm', 'avi', 'mov'] as const
export const SUBTITLE_EXTENSIONS = ['srt', 'ass', 'ssa'] as const
export const PLAYLIST_EXTENSIONS = ['m3u', 'm3u8'] as const

export type DroppedFileKind = 'video' | 'subtitle' | 'playlist' | 'unknown'

/**
 * True when `path` is an `http:`/`https:` network URL rather than a local
 * filesystem path. Feature 9's single source of truth for the remote/local
 * branch: every call site that would otherwise probe with ffprobe, normalize as
 * a filesystem path, or touch `fs` checks this first. Only the two web schemes
 * count — `file:`, `ftp:`, bare hostnames, and Windows drive paths
 * (`C:\…`, whose `C:` is a drive letter, not a URL scheme) all stay local.
 */
export function isRemoteUrl(path: unknown): boolean {
  if (typeof path !== 'string') return false
  return /^https?:\/\//i.test(path.trim())
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
 * with F18 handling the sidecar), else the first `.m3u`/`.m3u8` playlist (its
 * entries are appended to the queue), else the first subtitle, else undefined.
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
