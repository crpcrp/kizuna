import { describe, it, expect, vi } from 'vitest'
import { createMediaMetadataService } from '@src/main/media/metadataService'
import type { FfprobeExec } from '@src/main/media/ffprobe'

function createService(
  overrides: {
    execFfprobe?: FfprobeExec
    readDir?: (folder: string) => Promise<string[]>
  } = {}
) {
  return createMediaMetadataService({
    ffprobePath: 'ffprobe-bin',
    execFfprobe: overrides.execFfprobe ?? vi.fn<FfprobeExec>().mockResolvedValue('{}'),
    readDir: overrides.readDir ?? (async () => []),
    // Folder navigation asserts both platform variants in its own test; here the
    // platform is pinned so these fixtures stay literal instead of host-derived.
    platform: 'linux'
  })
}

describe('createMediaMetadataService getChapters', () => {
  it('enumerates chapters through the injected ffprobe exec', async () => {
    const execFfprobe = vi.fn<FfprobeExec>().mockResolvedValue(
      JSON.stringify({
        chapters: [{ start_time: '1.5', end_time: '9.25', tags: { title: 'Opening' } }]
      })
    )
    const service = createService({ execFfprobe })

    await expect(service.getChapters('/video/episode.mkv')).resolves.toEqual([
      { start: 1.5, end: 9.25, title: 'Opening' }
    ])
    expect(execFfprobe).toHaveBeenCalledWith('ffprobe-bin', [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_chapters',
      '--',
      '/video/episode.mkv'
    ])
  })
})

describe('createMediaMetadataService enumerateTracks', () => {
  it('passes the configured ffprobe binary through to the stream query', async () => {
    const execFfprobe = vi.fn<FfprobeExec>().mockResolvedValue(JSON.stringify({ streams: [] }))
    const service = createService({ execFfprobe })

    await expect(service.enumerateTracks('/video/episode.mkv')).resolves.toEqual([])
    expect(execFfprobe.mock.calls[0][0]).toBe('ffprobe-bin')
    expect(execFfprobe.mock.calls[0][1]).toContain('/video/episode.mkv')
  })
})

describe('createMediaMetadataService folder navigation', () => {
  const readDir = async (): Promise<string[]> => ['ep10.mkv', 'ep2.mkv', 'cover.jpg']

  it('lists a folder’s videos as naturally sorted absolute paths', async () => {
    await expect(createService({ readDir }).videosIn('/media/season1')).resolves.toEqual([
      '/media/season1/ep2.mkv',
      '/media/season1/ep10.mkv'
    ])
  })

  it('resolves the natural-order neighbors of a file in its own folder', async () => {
    await expect(
      createService({ readDir }).folderNeighbors('/media/season1/ep2.mkv')
    ).resolves.toEqual({ next: '/media/season1/ep10.mkv' })
  })
})
