import { describe, expect, it, vi } from 'vitest'
import { appendPathsToPlaylist, appendPlaylistFile } from '@src/renderer/src/state/playlistAppend'

function makeDeps(readPlaylist: (path: string) => Promise<string[]>) {
  const addPaths = vi.fn<(paths: string[]) => Promise<void>>().mockResolvedValue(undefined)
  return { deps: { readPlaylist: vi.fn(readPlaylist), addPaths }, addPaths }
}

describe('playlistAppend', () => {
  it('expands playlists and queues plain media paths as-is', async () => {
    const { deps, addPaths } = makeDeps(async () => ['E:\\a\\x.mkv', 'E:\\a\\y.mkv'])
    await expect(appendPathsToPlaylist(['E:\\v.mkv', 'E:\\q.m3u'], deps)).resolves.toBe(3)
    expect(deps.readPlaylist).toHaveBeenCalledWith('E:\\q.m3u')
    expect(addPaths).toHaveBeenCalledWith(['E:\\v.mkv', 'E:\\a\\x.mkv', 'E:\\a\\y.mkv'])
  })

  it('does not read plain media paths as playlists', async () => {
    const { deps, addPaths } = makeDeps(async () => ['unused'])
    await expect(appendPathsToPlaylist(['E:\\v.mkv'], deps)).resolves.toBe(1)
    expect(deps.readPlaylist).not.toHaveBeenCalled()
    expect(addPaths).toHaveBeenCalledWith(['E:\\v.mkv'])
  })

  it('returns the entry count for a single playlist', async () => {
    const { deps } = makeDeps(async () => ['E:\\a.mkv', 'E:\\b.mkv'])
    await expect(appendPlaylistFile('E:\\q.m3u8', deps)).resolves.toBe(2)
  })

  it('returns zero for unreadable playlists without queueing', async () => {
    const { deps, addPaths } = makeDeps(async () => {
      throw new Error('ENOENT')
    })
    await expect(appendPlaylistFile('E:\\gone.m3u', deps)).resolves.toBe(0)
    expect(addPaths).not.toHaveBeenCalled()
  })
})
