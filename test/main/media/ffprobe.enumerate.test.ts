import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { enumerateTracks } from '@src/main/media/ffprobe'
import { fakeFfprobeSuccess, fakeFfprobeFailure } from '@test/harness/fakeFfprobe'
import { fixture } from '@test/paths'

const FIXTURE = readFileSync(fixture('ffprobe-mkv.json'), 'utf-8')

describe('enumerateTracks', () => {
  it('delegates the fake exec stdout to the parser and returns Track[]', async () => {
    const fake = fakeFfprobeSuccess(FIXTURE)

    const tracks = await enumerateTracks('ffprobe.exe', 'C:\\videos\\episode.mkv', fake.exec)

    expect(tracks).toHaveLength(4)
    expect(tracks.map((t) => t.kind)).toEqual(['audio', 'audio', 'subtitle', 'subtitle'])
    expect(tracks.map((t) => t.id)).toEqual([1, 2, 3, 4])
  })

  it.each(['C:\\videos\\episode.mkv', '-show_format'])(
    'passes JSON stream flags and treats %s as a filename',
    async (filePath) => {
      const fake = fakeFfprobeSuccess(FIXTURE)

      await enumerateTracks('C:\\bin\\ffprobe.exe', filePath, fake.exec)

      expect(fake.calls).toHaveLength(1)
      expect(fake.calls[0].ffprobePath).toBe('C:\\bin\\ffprobe.exe')
      expect(fake.calls[0].args).toEqual([
        '-v',
        'error',
        '-print_format',
        'json',
        '-show_streams',
        '--',
        filePath
      ])
    }
  )

  it('rejects when the injected exec rejects', async () => {
    const fake = fakeFfprobeFailure(new Error('ffprobe exited with code 1'))

    await expect(
      enumerateTracks('ffprobe.exe', 'C:\\videos\\episode.mkv', fake.exec)
    ).rejects.toThrow('ffprobe exited with code 1')
  })
})
