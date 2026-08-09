import { describe, expect, it, vi } from 'vitest'
import { PATH_PLATFORMS } from '@test/harness/platformPaths'
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
})

// Folder splitting and rejoining is platform-shaped, so both variants run on
// either host: a Linux runner still proves that `E:\anime\show\ep2.mkv` is
// split on backslashes rather than treated as one long filename.
describe.each(PATH_PLATFORMS)('folderNavigation on $label', ({ platform, path, mediaDir }) => {
  const blocked = path.join(mediaDir, 'blocked')
  const video = (folder: string, name: string): string => path.join(folder, name)

  const readDirFake = (entries: string[]) =>
    vi.fn(async (folder: string) => {
      if (folder === blocked) throw new Error('denied')
      return entries
    })

  it('joins neighbors onto the current folder and hides unreadable folders', async () => {
    const service = createFolderNavigation(
      readDirFake(['ep1.mkv', 'ep2.mkv', 'ep10.mkv']),
      platform
    )

    await expect(service.neighborsOf(video(mediaDir, 'ep2.mkv'))).resolves.toEqual({
      prev: video(mediaDir, 'ep1.mkv'),
      next: video(mediaDir, 'ep10.mkv')
    })
    await expect(service.neighborsOf(video(blocked, 'ep2.mkv'))).resolves.toEqual({})
  })

  it('lists every folder video, naturally sorted, ignoring non-videos', () => {
    expect(
      sortedVideoPaths(mediaDir, ['ep10.mkv', 'notes.txt', 'ep2.mkv', 'poster.jpg'], platform)
    ).toEqual([video(mediaDir, 'ep2.mkv'), video(mediaDir, 'ep10.mkv')])
  })

  it('videosIn joins the sorted videos onto the folder and hides unreadable folders', async () => {
    const service = createFolderNavigation(
      readDirFake(['ep10.mkv', 'ep2.mkv', 'readme.md']),
      platform
    )

    await expect(service.videosIn(mediaDir)).resolves.toEqual([
      video(mediaDir, 'ep2.mkv'),
      video(mediaDir, 'ep10.mkv')
    ])
    await expect(service.videosIn(blocked)).resolves.toEqual([])
  })
})
