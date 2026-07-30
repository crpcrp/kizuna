import { classifyMediaFileName } from '../../../shared/mediaFileTypes'

export interface PlaylistAppendDeps {
  readPlaylist: (path: string) => Promise<string[]>
  addPaths: (paths: string[]) => Promise<void>
}

export async function appendPathsToPlaylist(
  paths: string[],
  deps: PlaylistAppendDeps
): Promise<number> {
  const expanded: string[] = []
  for (const path of paths) {
    if (classifyMediaFileName(path) === 'playlist') {
      expanded.push(...(await deps.readPlaylist(path)))
    } else {
      expanded.push(path)
    }
  }
  await deps.addPaths(expanded)
  return expanded.length
}

export async function appendPlaylistFile(path: string, deps: PlaylistAppendDeps): Promise<number> {
  try {
    return await appendPathsToPlaylist([path], deps)
  } catch {
    return 0
  }
}
