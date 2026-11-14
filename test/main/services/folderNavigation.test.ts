import { describe, expect, it, vi } from 'vitest'
import { PATH_PLATFORMS } from '@test/harness/platformPaths'
import { createFolderNavigation } from '@src/main/services/folderNavigation'

describe.each(PATH_PLATFORMS)('folderNavigation on $label', ({ platform, path, mediaDir }) => {
  const blocked = path.join(mediaDir, 'blocked')
  const video = (name: string): string => path.join(mediaDir, name)

  function service(entries: string[]) {
    return createFolderNavigation(
      vi.fn(async (folder: string) => {
        if (folder === blocked) throw new Error('denied')
        return entries
      }),
      platform
    )
  }

  it('finds neighbors case-insensitively among naturally sorted videos', async () => {
    const navigation = service(['ep100.mkv', 'ep10.mkv', 'Ep2.mkv', 'notes.txt', 'ep3.srt'])
    await expect(navigation.neighborsOf(video('EP10.MKV'))).resolves.toEqual({
      prev: video('Ep2.mkv'),
      next: video('ep100.mkv')
    })
    await expect(navigation.neighborsOf(video('Ep2.mkv'))).resolves.toEqual({
      next: video('ep10.mkv')
    })
    await expect(navigation.neighborsOf(video('ep100.mkv'))).resolves.toEqual({
      prev: video('ep10.mkv')
    })
  })

  it('returns no neighbors when the current video is absent or alone', async () => {
    const navigation = service(['ep1.mkv'])
    await expect(navigation.neighborsOf(video('missing.mkv'))).resolves.toEqual({})
    await expect(navigation.neighborsOf(video('ep1.mkv'))).resolves.toEqual({})
  })

  it('lists folder videos in natural, case-insensitive order and ignores non-videos', async () => {
    await expect(
      service(['ep100.mkv', 'ep10.mkv', 'Ep2.mkv', 'readme.md']).videosIn(mediaDir)
    ).resolves.toEqual([video('Ep2.mkv'), video('ep10.mkv'), video('ep100.mkv')])
  })

  it('hides unreadable folders for both operations', async () => {
    const navigation = service([])
    await expect(navigation.neighborsOf(path.join(blocked, 'ep2.mkv'))).resolves.toEqual({})
    await expect(navigation.videosIn(blocked)).resolves.toEqual([])
  })
})
