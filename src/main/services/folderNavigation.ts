import { classifyMediaFileName } from '../../shared/mediaFileTypes'
import { pathApiFor } from '../platformPath'

export type ReadDir = (folder: string) => Promise<string[]>

/** Natural, case-insensitive filename comparison: `ep2` sorts before `ep10`. */
export function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' })
}

/**
 * Pure neighbor lookup for `currentBasename` among video filenames only.
 * Basename matching is case-insensitive to match Windows/NTFS behavior.
 */
export function videoNeighbors(
  fileNames: string[],
  currentBasename: string
): { prev?: string; next?: string } {
  const videos = fileNames
    .filter((name) => classifyMediaFileName(name) === 'video')
    .sort(naturalCompare)
  const current = currentBasename.toLowerCase()
  const index = videos.findIndex((name) => name.toLowerCase() === current)
  if (index === -1) return {}
  return {
    ...(index > 0 ? { prev: videos[index - 1] } : {}),
    ...(index < videos.length - 1 ? { next: videos[index + 1] } : {})
  }
}

/**
 * Pure: every video file in `folder`, naturally sorted, as absolute paths.
 * The same filter/sort `videoNeighbors` uses, but the whole listing — for
 * "Add folder to playlist".
 */
export function sortedVideoPaths(
  folder: string,
  fileNames: string[],
  platform: NodeJS.Platform = process.platform
): string[] {
  const { join } = pathApiFor(platform)
  return fileNames
    .filter((name) => classifyMediaFileName(name) === 'video')
    .sort(naturalCompare)
    .map((name) => join(folder, name))
}

/** Builds a fakeable folder-navigation service around an injected readdir.
 *  `platform` selects the path semantics used to split and rejoin the folder;
 *  it defaults to the host, so production callers need not pass it. */
export function createFolderNavigation(
  readDir: ReadDir,
  platform: NodeJS.Platform = process.platform
): {
  neighborsOf(filePath: string): Promise<{ prev?: string; next?: string }>
  videosIn(folder: string): Promise<string[]>
} {
  const { basename, dirname, join } = pathApiFor(platform)
  return {
    async neighborsOf(filePath: string): Promise<{ prev?: string; next?: string }> {
      const folder = dirname(filePath)
      let entries: string[]
      try {
        entries = await readDir(folder)
      } catch {
        return {}
      }
      const neighbors = videoNeighbors(entries, basename(filePath))
      return {
        ...(neighbors.prev ? { prev: join(folder, neighbors.prev) } : {}),
        ...(neighbors.next ? { next: join(folder, neighbors.next) } : {})
      }
    },

    async videosIn(folder: string): Promise<string[]> {
      let entries: string[]
      try {
        entries = await readDir(folder)
      } catch {
        return []
      }
      return sortedVideoPaths(folder, entries, platform)
    }
  }
}
