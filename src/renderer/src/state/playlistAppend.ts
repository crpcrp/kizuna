import { classifyMediaFileName, isRemoteUrl } from '../../../shared/mediaFileTypes'

export interface PlaylistAppendDeps {
  readPlaylist: (path: string) => Promise<string[]>
  addPaths: (paths: string[]) => Promise<void>
}

export type PlaylistAppendResult =
  { status: 'added'; count: number } | { status: 'empty' } | { status: 'unreadable' }

export async function appendPathsToPlaylist(
  paths: string[],
  deps: PlaylistAppendDeps
): Promise<PlaylistAppendResult> {
  const expanded: string[] = []
  for (const path of paths) {
    if (classifyMediaFileName(path) === 'playlist') {
      try {
        expanded.push(...(await deps.readPlaylist(path)))
      } catch {
        return { status: 'unreadable' }
      }
    } else {
      expanded.push(path)
    }
  }
  const localPaths = expanded.filter((path) => !isRemoteUrl(path))
  if (localPaths.length === 0) return { status: 'empty' }
  await deps.addPaths(localPaths)
  return { status: 'added', count: localPaths.length }
}

export async function appendPlaylistFile(
  path: string,
  deps: PlaylistAppendDeps
): Promise<PlaylistAppendResult> {
  return appendPathsToPlaylist([path], deps)
}
