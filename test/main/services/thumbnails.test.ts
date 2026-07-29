import { describe, it, expect, vi } from 'vitest'
import { basename, dirname, join } from 'node:path'
import {
  bucketFor,
  seekTimeForBucket,
  thumbnailCachePath,
  buildThumbnailArgs,
  createThumbnailService,
  type ThumbnailFs,
  type ThumbnailStat
} from '@src/main/services/thumbnails'
import { fakeFfmpegSuccess, fakeFfmpegFailure } from '@test/harness/fakeFfmpeg'

describe('bucketFor', () => {
  it('maps a time to its 1-percent bucket (floor)', () => {
    expect(bucketFor(0, 100)).toBe(0)
    expect(bucketFor(50, 100)).toBe(50)
    expect(bucketFor(0.9, 100)).toBe(0)
    expect(bucketFor(1.5, 100)).toBe(1)
  })

  it('clamps to 0..99', () => {
    expect(bucketFor(-5, 100)).toBe(0)
    // At and past the reported end, the last bucket (99), never 100.
    expect(bucketFor(100, 100)).toBe(99)
    expect(bucketFor(999, 100)).toBe(99)
  })

  it('returns null for non-finite inputs', () => {
    expect(bucketFor(Number.NaN, 100)).toBeNull()
    expect(bucketFor(10, Number.POSITIVE_INFINITY)).toBeNull()
    expect(bucketFor(10, Number.NaN)).toBeNull()
  })

  it('returns null for durations under 1 second (too short / unknown)', () => {
    expect(bucketFor(0.2, 0.5)).toBeNull()
    expect(bucketFor(0, 0)).toBeNull()
  })
})

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

describe('thumbnailCachePath', () => {
  it('builds <cacheDir>/<sha1>/<bucket>.jpg', () => {
    const path = thumbnailCachePath('/cache', '/videos/ep1.mkv', 100, 200, 42)
    // Asserted structurally rather than against a `/`-separated regex, which
    // only matched on posix — the source joins with the platform separator.
    expect(dirname(dirname(path))).toBe(join('/cache'))
    expect(basename(dirname(path))).toMatch(/^[0-9a-f]{40}$/)
    expect(basename(path)).toBe('42.jpg')
  })

  it('canonicalizes Windows paths so casing/separators do not fork the key', () => {
    const a = thumbnailCachePath('/cache', 'E:\\Video\\A.mkv', 1, 2, 0)
    const b = thumbnailCachePath('/cache', 'e:/video/a.mkv', 1, 2, 0)
    expect(a).toBe(b)
  })

  it('hashes file identity: a new size or mtime yields a different directory', () => {
    const base = thumbnailCachePath('/cache', '/v/ep1.mkv', 100, 200, 5)
    expect(thumbnailCachePath('/cache', '/v/ep1.mkv', 101, 200, 5)).not.toBe(base)
    expect(thumbnailCachePath('/cache', '/v/ep1.mkv', 100, 201, 5)).not.toBe(base)
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

/** Minimal fake fs: an in-memory set of "existing" files + a stat table. */
function fakeFs(
  stats: Record<string, ThumbnailStat>,
  existing: Set<string> = new Set()
): { fs: ThumbnailFs; existing: Set<string>; mkdirs: string[] } {
  const mkdirs: string[] = []
  const fs: ThumbnailFs = {
    stat(path) {
      const s = stats[path]
      if (!s) throw new Error(`no such file: ${path}`)
      return s
    },
    exists: (path) => existing.has(path),
    mkdir: (path) => mkdirs.push(path),
    // Rename simulates ffmpeg's output landing at the final cache path.
    rename: (_from, to) => existing.add(to)
  }
  return { fs, existing, mkdirs }
}

describe('createThumbnailService.getThumbnail', () => {
  it('returns null (no ffmpeg) when the time has no bucket', async () => {
    const ffmpeg = fakeFfmpegSuccess()
    const { fs } = fakeFs({ '/v/ep1.mkv': { size: 1, mtimeMs: 2 } })
    const svc = createThumbnailService({
      exec: ffmpeg.exec,
      fs,
      cacheDir: '/cache',
      ffmpegPath: '/bin/ffmpeg'
    })
    expect(await svc.getThumbnail('/v/ep1.mkv', 10, 0.5)).toBeNull()
    expect(ffmpeg.calls).toHaveLength(0)
  })

  it('runs ffmpeg once and returns the cache path on a miss', async () => {
    const ffmpeg = fakeFfmpegSuccess()
    const { fs, mkdirs } = fakeFs({ '/v/ep1.mkv': { size: 100, mtimeMs: 200 } })
    const svc = createThumbnailService({
      exec: ffmpeg.exec,
      fs,
      cacheDir: '/cache',
      ffmpegPath: '/bin/ffmpeg'
    })
    const expected = thumbnailCachePath('/cache', '/v/ep1.mkv', 100, 200, 50)

    const out = await svc.getThumbnail('/v/ep1.mkv', 50, 100)
    expect(out).toBe(expected)
    expect(ffmpeg.calls).toHaveLength(1)
    expect(ffmpeg.calls[0].ffmpegPath).toBe('/bin/ffmpeg')
    expect(mkdirs).toEqual([dirname(expected)])
    // ffmpeg wrote to a temp path, not the final one directly.
    expect(ffmpeg.calls[0].args.at(-1)).not.toBe(expected)
    expect(ffmpeg.calls[0].args.at(-1)).toMatch(/\.tmp$/)
  })

  it('seeks to the bucket midpoint, not the raw hover time, at the right edge', async () => {
    // A hover at/after the reported end maps to bucket 99. Passing that raw
    // time to `-ss` would seek past EOF, yield no frame, and poison the bucket;
    // the service must seek to the bucket midpoint (99.5% of duration) instead.
    const ffmpeg = fakeFfmpegSuccess()
    const { fs } = fakeFs({ '/v/ep1.mkv': { size: 100, mtimeMs: 200 } })
    const svc = createThumbnailService({
      exec: ffmpeg.exec,
      fs,
      cacheDir: '/cache',
      ffmpegPath: '/bin/ffmpeg'
    })
    const out = await svc.getThumbnail('/v/ep1.mkv', 100, 100) // timeSec >= durationSec
    expect(out).toBe(thumbnailCachePath('/cache', '/v/ep1.mkv', 100, 200, 99))
    const ssValue = Number(ffmpeg.calls[0].args[ffmpeg.calls[0].args.indexOf('-ss') + 1])
    expect(ssValue).toBeCloseTo(99.5)
    expect(ssValue).toBeLessThan(100)
  })

  it('serves an existing cache file without spawning ffmpeg', async () => {
    const ffmpeg = fakeFfmpegSuccess()
    const cached = thumbnailCachePath('/cache', '/v/ep1.mkv', 100, 200, 50)
    const { fs } = fakeFs({ '/v/ep1.mkv': { size: 100, mtimeMs: 200 } }, new Set([cached]))
    const svc = createThumbnailService({
      exec: ffmpeg.exec,
      fs,
      cacheDir: '/cache',
      ffmpegPath: '/bin/ffmpeg'
    })
    expect(await svc.getThumbnail('/v/ep1.mkv', 50, 100)).toBe(cached)
    expect(ffmpeg.calls).toHaveLength(0)
  })

  it('re-runs ffmpeg for a file replaced at the same path (new stat → new dir)', async () => {
    const ffmpeg = fakeFfmpegSuccess()
    const stats: Record<string, ThumbnailStat> = { '/v/ep1.mkv': { size: 100, mtimeMs: 200 } }
    const { fs } = fakeFs(stats)
    const svc = createThumbnailService({
      exec: ffmpeg.exec,
      fs,
      cacheDir: '/cache',
      ffmpegPath: '/bin/ffmpeg'
    })

    const first = await svc.getThumbnail('/v/ep1.mkv', 50, 100)
    expect(ffmpeg.calls).toHaveLength(1)
    // Same path, but the file changed: bump size + mtime and reopen it so the
    // memoized stat is refreshed.
    stats['/v/ep1.mkv'] = { size: 999, mtimeMs: 300 }
    await svc.getThumbnail('/other.mkv', 50, 100).catch(() => null) // force path change
    const second = await svc.getThumbnail('/v/ep1.mkv', 50, 100)

    expect(second).not.toBe(first)
    // The replacement produced a fresh ffmpeg run into a different cache dir.
    expect(ffmpeg.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('memoizes the cache path so a second hover on the same bucket hits cache', async () => {
    const ffmpeg = fakeFfmpegSuccess()
    const { fs } = fakeFs({ '/v/ep1.mkv': { size: 100, mtimeMs: 200 } })
    const svc = createThumbnailService({
      exec: ffmpeg.exec,
      fs,
      cacheDir: '/cache',
      ffmpegPath: '/bin/ffmpeg'
    })
    const a = await svc.getThumbnail('/v/ep1.mkv', 50, 100)
    const b = await svc.getThumbnail('/v/ep1.mkv', 50.4, 100) // same bucket 50
    expect(a).toBe(b)
    expect(ffmpeg.calls).toHaveLength(1) // second call served from the written file
  })

  it('serializes concurrent requests for the same bucket into one ffmpeg run', async () => {
    let resolveExec: (() => void) | undefined
    const gate = new Promise<void>((r) => {
      resolveExec = r
    })
    const calls: string[][] = []
    const exec = vi.fn(async (_p: string, args: string[]) => {
      calls.push(args)
      await gate
    })
    const { fs } = fakeFs({ '/v/ep1.mkv': { size: 100, mtimeMs: 200 } })
    const svc = createThumbnailService({ exec, fs, cacheDir: '/cache', ffmpegPath: '/bin/ffmpeg' })

    const p1 = svc.getThumbnail('/v/ep1.mkv', 50, 100)
    const p2 = svc.getThumbnail('/v/ep1.mkv', 50, 100)
    resolveExec?.()
    const [a, b] = await Promise.all([p1, p2])
    expect(a).toBe(b)
    expect(calls).toHaveLength(1)
  })

  it('returns null on ffmpeg failure and caches the failure (no re-spawn)', async () => {
    const ffmpeg = fakeFfmpegFailure(new Error('ffmpeg: corrupt region'))
    const { fs } = fakeFs({ '/v/ep1.mkv': { size: 100, mtimeMs: 200 } })
    const svc = createThumbnailService({
      exec: ffmpeg.exec,
      fs,
      cacheDir: '/cache',
      ffmpegPath: '/bin/ffmpeg'
    })
    expect(await svc.getThumbnail('/v/ep1.mkv', 50, 100)).toBeNull()
    expect(await svc.getThumbnail('/v/ep1.mkv', 50, 100)).toBeNull()
    expect(ffmpeg.calls).toHaveLength(1) // second hover did not re-run ffmpeg
  })

  it('returns null when the file cannot be stat-ed', async () => {
    const ffmpeg = fakeFfmpegSuccess()
    const { fs } = fakeFs({}) // no stat entry
    const svc = createThumbnailService({
      exec: ffmpeg.exec,
      fs,
      cacheDir: '/cache',
      ffmpegPath: '/bin/ffmpeg'
    })
    expect(await svc.getThumbnail('/v/gone.mkv', 50, 100)).toBeNull()
    expect(ffmpeg.calls).toHaveLength(0)
  })
})
