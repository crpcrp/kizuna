import disk from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
const tempDirs: string[] = []
function tempDir(): string {
  const dir = disk.mkdtempSync(join(tmpdir(), 'kizuna-'))
  tempDirs.push(dir)
  return dir
}
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  for (const dir of tempDirs.splice(0)) disk.rmSync(dir, { recursive: true, force: true })
})
import { afterEach, describe, it, expect, vi } from 'vitest'
import { PATH_PLATFORMS } from '@test/harness/platformPaths'
import {
  seekTimeForBucket,
  thumbnailCachePath,
  buildThumbnailArgs,
  createThumbnailService
} from '@src/main/services/thumbnails/generation'
import { deferred } from '@test/harness/deferred'

describe('seekTimeForBucket', () => {
  it('returns the bucket midpoint in seconds', () => {
    expect(seekTimeForBucket(0, 100)).toBeCloseTo(0.5)
    expect(seekTimeForBucket(50, 100)).toBeCloseTo(50.5)
  })

  it('keeps even the last bucket strictly inside the file', () => {
    // Bucket 99 → 99.5% of duration, never at or past EOF.
    expect(seekTimeForBucket(99, 100)).toBeCloseTo(99.5)
    expect(seekTimeForBucket(99, 100)).toBeLessThan(100)
  })
})

// The cache layout is platform-shaped, so both variants are asserted on either
// host rather than only the runner's own separator.
describe.each(PATH_PLATFORMS)(
  'thumbnailCachePath on $label',
  ({ platform, path, mediaDir, userDataDir }) => {
    const cacheDir = path.join(userDataDir, 'thumbnails')

    it('builds <cacheDir>/<sha1>/<bucket>.jpg', () => {
      const built = thumbnailCachePath(
        cacheDir,
        path.join(mediaDir, 'ep1.mkv'),
        100,
        200,
        42,
        platform
      )

      expect(path.dirname(path.dirname(built))).toBe(cacheDir)
      expect(path.basename(path.dirname(built))).toMatch(/^[0-9a-f]{40}$/)
      expect(path.basename(built)).toBe('42.jpg')
    })
  }
)

describe('thumbnailCachePath', () => {
  it('canonicalizes Windows paths so casing/separators do not fork the key', () => {
    const a = thumbnailCachePath('/cache', 'E:\\Video\\A.mkv', 1, 2, 0, 'linux')
    const b = thumbnailCachePath('/cache', 'e:/video/a.mkv', 1, 2, 0, 'linux')
    expect(a).toBe(b)
  })

  it('hashes file identity: a new size or mtime yields a different directory', () => {
    const base = thumbnailCachePath('/cache', '/v/ep1.mkv', 100, 200, 5, 'linux')
    expect(thumbnailCachePath('/cache', '/v/ep1.mkv', 101, 200, 5, 'linux')).not.toBe(base)
    expect(thumbnailCachePath('/cache', '/v/ep1.mkv', 100, 201, 5, 'linux')).not.toBe(base)
  })
})

describe('buildThumbnailArgs', () => {
  it('seeks before -i and emits one scaled frame', () => {
    expect(buildThumbnailArgs('/v/ep1.mkv', 12.5, '/cache/h/5.jpg')).toEqual([
      '-v',
      'error',
      '-y',
      '-ss',
      '12.5',
      '-i',
      '/v/ep1.mkv',
      '-frames:v',
      '1',
      '-vf',
      'scale=200:-2',
      '-f',
      'image2',
      '/cache/h/5.jpg'
    ])
  })

  it('clamps a negative seek time to 0', () => {
    expect(buildThumbnailArgs('/v/ep1.mkv', -3, '/o.jpg')[4]).toBe('0')
  })
})

function fixture() {
  const dir = tempDir()
  const media = join(dir, 'episode.mkv')
  const cacheDir = join(dir, 'cache')
  disk.writeFileSync(media, 'video')
  const exec = vi.fn(async (_file: string, args: string[]) => {
    disk.writeFileSync(args.at(-1)!, 'jpg')
  })
  const schedule = vi.fn()
  const service = createThumbnailService({
    exec,
    cacheDir,
    ffmpegPath: 'ffmpeg',
    evictionScheduler: { schedule }
  })
  return { ...service, media, cacheDir, exec, schedule }
}

describe('thumbnail generation on disk', () => {
  it('writes atomically, serves subsequent hovers from cache, and schedules one sweep', async () => {
    const f = fixture()
    const output = await f.getThumbnail(f.media, 50, 100)
    expect(output).not.toBeNull()
    expect(disk.readFileSync(output!, 'utf-8')).toBe('jpg')
    expect(f.exec.mock.calls[0][1].at(-1)).toMatch(/\.tmp$/)
    expect(await f.getThumbnail(f.media, 50.4, 100)).toBe(output)
    expect(f.exec).toHaveBeenCalledTimes(1)
    expect(f.schedule).toHaveBeenCalledTimes(1)
  })

  it('seeks strictly inside the last bucket at the right edge', async () => {
    const f = fixture()
    expect(await f.getThumbnail(f.media, 100, 100)).not.toBeNull()
    const args = f.exec.mock.calls[0][1]
    expect(Number(args[args.indexOf('-ss') + 1])).toBeCloseTo(99.5)
  })

  it('deduplicates concurrent requests for one bucket', async () => {
    const f = fixture()
    const gate = deferred<void>()
    f.exec.mockImplementationOnce(async (_file, args) => {
      await gate.promise
      disk.writeFileSync(args.at(-1)!, 'jpg')
    })
    const first = f.getThumbnail(f.media, 50, 100)
    const second = f.getThumbnail(f.media, 50, 100)
    gate.resolve()
    const [a, b] = await Promise.all([first, second])
    expect(a).not.toBeNull()
    expect(a).toBe(b)
    expect(f.exec).toHaveBeenCalledTimes(1)
  })

  it('refreshes file identity after another file is opened', async () => {
    const f = fixture()
    const first = await f.getThumbnail(f.media, 50, 100)
    disk.writeFileSync(f.media, 'replacement video')
    await f.getThumbnail(join(f.cacheDir, 'missing'), 50, 100)
    const second = await f.getThumbnail(f.media, 50, 100)
    expect(second).not.toBeNull()
    expect(second).not.toBe(first)
    expect(f.exec).toHaveBeenCalledTimes(2)
  })

  it('returns null without spawning for missing files or invalid durations', async () => {
    const f = fixture()
    expect(await f.getThumbnail(f.media, 50, 0.5)).toBeNull()
    expect(await f.getThumbnail(join(f.cacheDir, 'missing'), 50, 100)).toBeNull()
    expect(f.exec).not.toHaveBeenCalled()
  })

  it.each(['exec', 'rename'] as const)(
    'remembers %s failures without respawning',
    async (failure) => {
      const f = fixture()
      if (failure === 'exec') f.exec.mockRejectedValueOnce(new Error('ffmpeg failed'))
      else
        vi.spyOn(disk, 'renameSync').mockImplementationOnce(() => {
          throw new Error('rename failed')
        })
      expect(await f.getThumbnail(f.media, 50, 100)).toBeNull()
      expect(await f.getThumbnail(f.media, 50, 100)).toBeNull()
      expect(f.exec).toHaveBeenCalledTimes(1)
      expect(f.schedule).not.toHaveBeenCalled()
    }
  )
})
