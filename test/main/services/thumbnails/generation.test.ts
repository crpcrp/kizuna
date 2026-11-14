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
  createThumbnailService,
  thumbnailCachePath
} from '@src/main/services/thumbnails/generation'
import { deferred } from '@test/harness/deferred'

describe.each(PATH_PLATFORMS)(
  'thumbnail cache paths on $label',
  ({ platform, path, mediaDir, userDataDir }) => {
    it('derives the cache directory with target-platform path semantics', () => {
      const cacheDir = path.join(userDataDir, 'thumbnails')
      const output = thumbnailCachePath(
        cacheDir,
        path.join(mediaDir, 'ep1.mkv'),
        100,
        200,
        42,
        platform
      )
      expect(path.dirname(path.dirname(output))).toBe(cacheDir)
      expect(path.basename(path.dirname(output))).toMatch(/^[0-9a-f]{40}$/)
      expect(path.basename(output)).toBe('42.jpg')
      expect(thumbnailCachePath(cacheDir, 'E:\\Video\\A.mkv', 100, 200, 42, platform)).toBe(
        thumbnailCachePath(cacheDir, 'e:/video/a.mkv', 100, 200, 42, platform)
      )
    })
  }
)

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
    const args = f.exec.mock.calls[0][1]
    expect(f.exec.mock.calls[0][0]).toBe('ffmpeg')
    expect(args).toEqual([
      '-v',
      'error',
      '-y',
      '-ss',
      '50.5',
      '-i',
      f.media,
      '-frames:v',
      '1',
      '-vf',
      'scale=200:-2',
      '-f',
      'image2',
      expect.stringMatching(/\.tmp$/)
    ])
    expect(await f.getThumbnail(f.media, 50.4, 100)).toBe(output)
    expect(f.exec).toHaveBeenCalledTimes(1)
    expect(f.schedule).toHaveBeenCalledTimes(1)
  })

  it.each([
    [0, 0.5],
    [100, 99.5]
  ])('seeks within the file for hover %s', async (hover, seek) => {
    const f = fixture()
    expect(await f.getThumbnail(f.media, hover, 100)).not.toBeNull()
    const args = f.exec.mock.calls[0][1]
    expect(Number(args[args.indexOf('-ss') + 1])).toBeCloseTo(seek)
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

  it('invalidates the cache when only the file modification time changes', async () => {
    const f = fixture()
    const first = await f.getThumbnail(f.media, 50, 100)
    disk.utimesSync(f.media, 1, 1)
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
