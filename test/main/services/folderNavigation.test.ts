import { describe, expect, it, vi } from 'vitest'
import { join } from 'node:path'
import {
  createFolderNavigation,
  naturalCompare,
  sortedVideoPaths,
  videoNeighbors
} from '@src/main/services/folderNavigation'

describe('folderNavigation', () => {
  it('natural-sorts numbered filenames case-insensitively', () => {
    expect(['ep100.mkv', 'Ep2.mkv', 'ep10.mkv'].sort(naturalCompare)).toEqual([
      'Ep2.mkv',
      'ep10.mkv',
      'ep100.mkv'
    ])
  })

  it('finds neighboring videos while ignoring non-video siblings', () => {
    expect(videoNeighbors(['notes.txt', 'ep10.mkv', 'ep2.mkv', 'ep3.srt'], 'EP2.MKV')).toEqual({
      next: 'ep10.mkv'
    })
  })

  it('returns empty when the current file is absent or alone', () => {
    expect(videoNeighbors(['ep1.mkv'], 'missing.mkv')).toEqual({})
    expect(videoNeighbors(['ep1.mkv'], 'ep1.mkv')).toEqual({})
  })

  it('joins neighbors onto the current folder and hides unreadable folders', async () => {
    const readDir = vi.fn(async (folder: string) => {
      if (folder === '/blocked') throw new Error('denied')
      return ['ep1.mkv', 'ep2.mkv', 'ep10.mkv']
    })
    const service = createFolderNavigation(readDir)

    await expect(service.neighborsOf('/show/ep2.mkv')).resolves.toEqual({
      prev: join('/show', 'ep1.mkv'),
      next: join('/show', 'ep10.mkv')
    })
    await expect(service.neighborsOf('/blocked/ep2.mkv')).resolves.toEqual({})
  })

  it('lists every folder video, naturally sorted, ignoring non-videos', () => {
    expect(sortedVideoPaths('/show', ['ep10.mkv', 'notes.txt', 'ep2.mkv', 'poster.jpg'])).toEqual([
      join('/show', 'ep2.mkv'),
      join('/show', 'ep10.mkv')
    ])
  })

  it('videosIn joins the sorted videos onto the folder and hides unreadable folders', async () => {
    const readDir = vi.fn(async (folder: string) => {
      if (folder === '/blocked') throw new Error('denied')
      return ['ep10.mkv', 'ep2.mkv', 'readme.md']
    })
    const service = createFolderNavigation(readDir)

    await expect(service.videosIn('/show')).resolves.toEqual([
      join('/show', 'ep2.mkv'),
      join('/show', 'ep10.mkv')
    ])
    await expect(service.videosIn('/blocked')).resolves.toEqual([])
  })
})
