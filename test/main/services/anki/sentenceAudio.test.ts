import { describe, it, expect } from 'vitest'
import { PATH_PLATFORMS } from '@test/harness/platformPaths'
import { createSentenceAudioService } from '@src/main/services/anki/sentenceAudio'
import type { MineMediaContext } from '@src/shared/anki'

function mediaAt(path: string): MineMediaContext {
  return { path, audioStreamIndex: 2, startSec: 12.5, endSec: 15.25 }
}

// The clip's temp path is platform-shaped, so the service is exercised against
// both targets on either host, each with its own tmp dir and ffmpeg location.
describe.each(PATH_PLATFORMS)(
  'createSentenceAudioService on $label',
  ({ platform, path: pathApi, mediaDir, tempDir }) => {
    const ffmpegPath = platform === 'win32' ? 'C:\\bin\\ffmpeg.exe' : '/usr/bin/ffmpeg'
    const mediaPath = pathApi.join(mediaDir, 'ep1.mkv')
    const clipPath = expect.stringMatching(
      new RegExp(`^${escapeRegExp(pathApi.join(tempDir, 'kizuna-sentence-'))}[0-9a-f]{12}\\.mp3$`)
    )
    const media = mediaAt(mediaPath)

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
        ffmpegPath,
        tmpDir: () => tempDir,
        fs: {
          readBase64: async (path) => {
            calls.read.push(path)
            return 'SUQzBAA='
          },
          remove: async (path) => {
            calls.removed.push(path)
          }
        },
        platform,
        ...overrides
      })
      return { calls, service }
    }

    it('runs ffmpeg into a randomized temp MP3, returns its base64, and deletes it', async () => {
      const { calls, service } = deps()

      expect(await service.extract(media)).toBe('SUQzBAA=')
      expect(calls.exec).toEqual([
        {
          ffmpegPath,
          args: [
            '-v',
            'error',
            '-y',
            '-ss',
            '12.500',
            '-to',
            '15.250',
            '-i',
            mediaPath,
            '-map',
            '0:2',
            '-vn',
            '-c:a',
            'libmp3lame',
            '-q:a',
            '4',
            clipPath
          ]
        }
      ])
      expect(calls.read).toEqual([clipPath])
      expect(calls.removed).toEqual([clipPath])
    })

    it('rounds clip times to milliseconds at the process boundary', async () => {
      const { calls, service } = deps()

      await service.extract({ ...media, startSec: 0.1 + 0.2, endSec: 1 })

      expect(calls.exec[0].args.slice(3, 7)).toEqual(['-ss', '0.300', '-to', '1.000'])
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
          remove: async (path) => {
            calls.removed.push(path)
          }
        }
      })

      expect(await service.extract(media)).toBeNull()
      expect(calls.removed).toEqual([clipPath])
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
          endSec: media.startSec + 0.05
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
      expect(await service.extract({ ...media, path: 'https://host.example/audio' })).toBeNull()
      expect(await service.extract({ ...media, path: 'rtsp://host.example/live' })).toBeNull()
      expect(calls.exec).toEqual([])
    })
  }
)

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
