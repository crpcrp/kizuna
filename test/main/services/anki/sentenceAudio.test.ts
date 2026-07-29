import { describe, it, expect } from 'vitest'
import { join } from 'node:path'
import {
  buildFfmpegAudioClipArgs,
  createSentenceAudioService,
  MIN_SENTENCE_CLIP_SECONDS
} from '@src/main/services/anki/sentenceAudio'
import type { MineMediaContext } from '@src/shared/anki'

const media: MineMediaContext = {
  path: 'C:\\videos\\ep1.mkv',
  audioStreamIndex: 2,
  startSec: 12.5,
  endSec: 15.25
}

describe('buildFfmpegAudioClipArgs', () => {
  it('builds the exact MP3 clip argv, seeking before -i and mapping the absolute stream', () => {
    expect(
      buildFfmpegAudioClipArgs('C:\\videos\\ep1.mkv', 2, 12.5, 15.25, 'C:\\tmp\\clip.mp3')
    ).toEqual([
      '-v',
      'error',
      '-y',
      '-ss',
      '12.500',
      '-to',
      '15.250',
      '-i',
      'C:\\videos\\ep1.mkv',
      '-map',
      '0:2',
      '-vn',
      '-c:a',
      'libmp3lame',
      '-q:a',
      '4',
      'C:\\tmp\\clip.mp3'
    ])
  })

  it('formats seconds at fixed precision so the same window yields the same argv', () => {
    const args = buildFfmpegAudioClipArgs('/v/a.mkv', 0, 0.1 + 0.2, 1, '/tmp/c.mp3')
    expect(args[4]).toBe('0.300')
    expect(args[6]).toBe('1.000')
  })
})

describe('createSentenceAudioService', () => {
  function deps(overrides: Partial<Parameters<typeof createSentenceAudioService>[0]> = {}): {
    calls: { exec: { ffmpegPath: string; args: string[] }[]; read: string[]; removed: string[] }
    service: ReturnType<typeof createSentenceAudioService>
  } {
    const calls = {
      exec: [] as { ffmpegPath: string; args: string[] }[],
      read: [] as string[],
      removed: [] as string[]
    }
    const service = createSentenceAudioService({
      exec: async (ffmpegPath, args) => {
        calls.exec.push({ ffmpegPath, args })
      },
      ffmpegPath: 'C:\\bin\\ffmpeg.exe',
      tmpDir: () => '/tmp',
      fs: {
        readBase64: async (path) => {
          calls.read.push(path)
          return 'SUQzBAA='
        },
        remove: async (path) => {
          calls.removed.push(path)
        }
      },
      uniqueSuffix: () => 'abc123',
      ...overrides
    })
    return { calls, service }
  }

  const clipPath = join('/tmp', 'kizuna-sentence-abc123.mp3')

  it('runs ffmpeg into a randomized temp MP3, returns its base64, and deletes it', async () => {
    const { calls, service } = deps()

    expect(await service.extract(media)).toBe('SUQzBAA=')
    expect(calls.exec).toEqual([
      {
        ffmpegPath: 'C:\\bin\\ffmpeg.exe',
        args: buildFfmpegAudioClipArgs('C:\\videos\\ep1.mkv', 2, 12.5, 15.25, clipPath)
      }
    ])
    expect(calls.read).toEqual([clipPath])
    expect(calls.removed).toEqual([clipPath])
  })

  it('gives concurrent extractions distinct filenames', async () => {
    let n = 0
    const { calls, service } = deps({ uniqueSuffix: () => `s${++n}` })

    await Promise.all([service.extract(media), service.extract(media)])
    expect(new Set(calls.exec.map((call) => call.args.at(-1))).size).toBe(2)
  })

  it('resolves null and still deletes the temp file when ffmpeg fails', async () => {
    const { calls, service } = deps({
      exec: () => Promise.reject(new Error('ffmpeg: Unknown encoder libmp3lame'))
    })

    expect(await service.extract(media)).toBeNull()
    expect(calls.read).toEqual([])
    expect(calls.removed).toEqual([clipPath])
  })

  it('resolves null and still deletes the temp file when reading it back fails', async () => {
    const { calls, service } = deps({
      exec: async () => {},
      fs: {
        readBase64: () => Promise.reject(new Error('ENOENT')),
        remove: async () => {}
      }
    })

    expect(await service.extract(media)).toBeNull()
    expect(calls.removed).toEqual([])
  })

  it('does not turn a failed cleanup into a failed extraction', async () => {
    const { service } = deps({
      fs: {
        readBase64: async () => 'SUQzBAA=',
        remove: () => Promise.reject(new Error('EBUSY'))
      }
    })

    expect(await service.extract(media)).toBe('SUQzBAA=')
  })

  it('rejects a window shorter than the minimum without running ffmpeg', async () => {
    const { calls, service } = deps()

    expect(
      await service.extract({
        ...media,
        endSec: media.startSec + MIN_SENTENCE_CLIP_SECONDS / 2
      })
    ).toBeNull()
    expect(calls.exec).toEqual([])
    expect(calls.removed).toEqual([])
  })

  it('rejects inverted, negative, non-finite, and unmappable requests', async () => {
    const { calls, service } = deps()

    expect(await service.extract({ ...media, startSec: 20, endSec: 10 })).toBeNull()
    expect(await service.extract({ ...media, startSec: -1 })).toBeNull()
    expect(await service.extract({ ...media, endSec: Number.NaN })).toBeNull()
    expect(await service.extract({ ...media, audioStreamIndex: -1 })).toBeNull()
    expect(await service.extract({ ...media, path: '' })).toBeNull()
    expect(calls.exec).toEqual([])
  })
})
