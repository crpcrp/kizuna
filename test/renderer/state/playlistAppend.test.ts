import { describe, expect, it, vi } from 'vitest'
import { appendPathsToPlaylist, appendPlaylistFile } from '@src/renderer/src/state/playlistAppend'

function makeDeps(readPlaylist: (path: string) => Promise<string[]>) {
  const addPaths = vi.fn<(paths: string[]) => Promise<void>>().mockResolvedValue(undefined)
  return { deps: { readPlaylist: vi.fn(readPlaylist), addPaths }, addPaths }
}

describe('playlistAppend', () => {
  it('expands playlists and queues plain media paths as-is', async () => {
    const { deps, addPaths } = makeDeps(async () => ['E:\\a\\x.mkv', 'E:\\a\\y.mkv'])
    await expect(appendPathsToPlaylist(['E:\\v.mkv', 'E:\\q.m3u'], deps)).resolves.toEqual({
      status: 'added',
      count: 3
    })
    expect(deps.readPlaylist).toHaveBeenCalledWith('E:\\q.m3u')
    expect(addPaths).toHaveBeenCalledWith(['E:\\v.mkv', 'E:\\a\\x.mkv', 'E:\\a\\y.mkv'])
  })

  it('does not read plain media paths as playlists', async () => {
    const { deps, addPaths } = makeDeps(async () => ['unused'])
    await expect(appendPathsToPlaylist(['E:\\v.mkv'], deps)).resolves.toEqual({
      status: 'added',
      count: 1
    })
    expect(deps.readPlaylist).not.toHaveBeenCalled()
    expect(addPaths).toHaveBeenCalledWith(['E:\\v.mkv'])
  })

  it('reports the added entry count for a single playlist', async () => {
    const { deps } = makeDeps(async () => ['E:\\a.mkv', 'E:\\b.mkv'])
    await expect(appendPlaylistFile('E:\\q.m3u8', deps)).resolves.toEqual({
      status: 'added',
      count: 2
    })
  })

  it('distinguishes a valid empty playlist from an unreadable playlist', async () => {
    const empty = makeDeps(async () => [])
    await expect(appendPlaylistFile('E:\\empty.m3u', empty.deps)).resolves.toEqual({
      status: 'empty'
    })
    expect(empty.addPaths).not.toHaveBeenCalled()

    const unreadable = makeDeps(async () => {
      throw new Error('ENOENT')
    })
    await expect(appendPlaylistFile('E:\\gone.m3u', unreadable.deps)).resolves.toEqual({
      status: 'unreadable'
    })
    expect(unreadable.addPaths).not.toHaveBeenCalled()
  })

  it('does not hide failures while adding expanded paths', async () => {
    const { deps, addPaths } = makeDeps(async () => {
      return ['E:\\a.mkv']
    })
    addPaths.mockRejectedValue(new Error('load failed'))
    await expect(appendPlaylistFile('E:\\queue.m3u', deps)).rejects.toThrow('load failed')
  })
})
