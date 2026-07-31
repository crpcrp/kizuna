import { describe, it, expect, vi } from 'vitest'
import { join } from 'node:path'
import {
  createDebouncedThumbnailEviction,
  selectEvictions,
  summarizeCacheDir,
  collectCacheEntries,
  collectCacheEntriesAsync,
  sweepThumbnailCache,
  sweepThumbnailCacheAsync,
  THUMBNAIL_CACHE_MAX_BYTES,
  type ThumbnailCacheEntry,
  type ThumbnailDirFs,
  type ThumbnailAsyncDirFs,
  type ThumbnailStat
} from '@src/main/services/thumbnails/cache'

const entry = (path: string, bytes: number, mtimeMs: number): ThumbnailCacheEntry => ({
  path,
  bytes,
  mtimeMs
})

describe('selectEvictions', () => {
  it('evicts nothing when the total is within the cap', () => {
    const entries = [entry('/a', 100, 1), entry('/b', 100, 2)]
    expect(selectEvictions(entries, 500)).toEqual([])
    expect(selectEvictions(entries, 200)).toEqual([]) // exactly at the cap
  })

  it('evicts the least-recently-used dirs first until under the cap', () => {
    const entries = [entry('/new', 100, 30), entry('/old', 100, 10), entry('/mid', 100, 20)]
    // Cap 150 → must drop 150 bytes → oldest two (/old, /mid), keeping /new.
    expect(selectEvictions(entries, 150)).toEqual(['/old', '/mid'])
  })

  it('stops as soon as the survivors fit', () => {
    const entries = [entry('/old', 300, 1), entry('/new', 50, 2)]
    // Dropping just /old (300) leaves 50 ≤ 100.
    expect(selectEvictions(entries, 100)).toEqual(['/old'])
  })

  it('evicts everything when the cap is non-positive', () => {
    const entries = [entry('/a', 10, 1), entry('/b', 20, 2)]
    expect(new Set(selectEvictions(entries, 0))).toEqual(new Set(['/a', '/b']))
  })

  it('keeps input order for equal mtimes (stable)', () => {
    const entries = [entry('/a', 100, 5), entry('/b', 100, 5), entry('/c', 100, 5)]
    expect(selectEvictions(entries, 100)).toEqual(['/a', '/b'])
  })

  it('exposes a ~500 MB default cap', () => {
    expect(THUMBNAIL_CACHE_MAX_BYTES).toBe(500 * 1024 * 1024)
  })
})

describe('summarizeCacheDir', () => {
  // The one place the per-dir measurement rule lives: both the sync startup
  // walk and the async runtime walk go through it, so they cannot drift.
  it('sums bytes and takes the newest mtime', () => {
    expect(
      summarizeCacheDir('/cache/h1', [
        { size: 100, mtimeMs: 10 },
        { size: 50, mtimeMs: 40 }
      ])
    ).toEqual({ path: '/cache/h1', bytes: 150, mtimeMs: 40 })
  })

  it('reports an empty file-dir as zero bytes at mtime 0', () => {
    expect(summarizeCacheDir('/cache/h1', [])).toEqual({ path: '/cache/h1', bytes: 0, mtimeMs: 0 })
  })
})

describe('collectCacheEntries', () => {
  it('sums bytes and takes the newest mtime per file-dir', () => {
    // The source joins through node:path, so the fake's keys must use the host
    // separator too — hard-coded `/` keys missed every lookup on Windows.
    const stats: Record<string, ThumbnailStat> = {
      [join('/cache', 'h1', '0.jpg')]: { size: 100, mtimeMs: 10 },
      [join('/cache', 'h1', '1.jpg')]: { size: 50, mtimeMs: 40 },
      [join('/cache', 'h2', '0.jpg')]: { size: 200, mtimeMs: 5 }
    }
    const fs: ThumbnailDirFs = {
      readSubdirs: (dir) => (dir === '/cache' ? ['h1', 'h2'] : []),
      readFiles: (dir) => (dir === join('/cache', 'h1') ? ['0.jpg', '1.jpg'] : ['0.jpg']),
      stat: (p) => stats[p]
    }
    expect(collectCacheEntries('/cache', fs)).toEqual([
      { path: join('/cache', 'h1'), bytes: 150, mtimeMs: 40 },
      { path: join('/cache', 'h2'), bytes: 200, mtimeMs: 5 }
    ])
  })

  it('returns [] for a missing cache dir', () => {
    const fs: ThumbnailDirFs = {
      readSubdirs: () => [],
      readFiles: () => [],
      stat: () => ({ size: 0, mtimeMs: 0 })
    }
    expect(collectCacheEntries('/cache', fs)).toEqual([])
  })
})

describe('sweepThumbnailCache', () => {
  it('removes exactly the LRU file-dirs needed to get under the cap', () => {
    const stats: Record<string, ThumbnailStat> = {
      [join('/cache', 'old', '0.jpg')]: { size: 400, mtimeMs: 1 },
      [join('/cache', 'new', '0.jpg')]: { size: 400, mtimeMs: 9 }
    }
    const removed: string[] = []
    const fs: ThumbnailDirFs & { remove(path: string): void } = {
      readSubdirs: (dir) => (dir === '/cache' ? ['old', 'new'] : []),
      readFiles: () => ['0.jpg'],
      stat: (p) => stats[p],
      remove: (p) => removed.push(p)
    }
    const result = sweepThumbnailCache({ cacheDir: '/cache', maxBytes: 500, fs })
    expect(result).toEqual([join('/cache', 'old')])
    expect(removed).toEqual([join('/cache', 'old')])
  })

  it('removes nothing when already under the cap', () => {
    const remove = vi.fn()
    const fs: ThumbnailDirFs & { remove(path: string): void } = {
      readSubdirs: () => ['h1'],
      readFiles: () => ['0.jpg'],
      stat: () => ({ size: 10, mtimeMs: 1 }),
      remove
    }
    expect(sweepThumbnailCache({ cacheDir: '/cache', maxBytes: 500, fs })).toEqual([])
    expect(remove).not.toHaveBeenCalled()
  })
})

describe('sweepThumbnailCacheAsync', () => {
  it('uses the same LRU selection while awaiting async traversal and removal', async () => {
    const removed: string[] = []
    const fs: ThumbnailAsyncDirFs = {
      readSubdirs: vi.fn(async () => ['old', 'new']),
      readFiles: vi.fn(async () => ['0.jpg']),
      stat: vi.fn(async (path) => ({ size: 400, mtimeMs: path.includes('old') ? 1 : 9 })),
      remove: vi.fn(async (path) => {
        removed.push(path)
      })
    }

    await expect(
      sweepThumbnailCacheAsync({ cacheDir: '/cache', maxBytes: 500, fs })
    ).resolves.toEqual([join('/cache', 'old')])
    expect(removed).toEqual([join('/cache', 'old')])
    await expect(collectCacheEntriesAsync('/cache', fs)).resolves.toEqual([
      { path: join('/cache', 'old'), bytes: 400, mtimeMs: 1 },
      { path: join('/cache', 'new'), bytes: 400, mtimeMs: 9 }
    ])
  })
})

describe('createDebouncedThumbnailEviction', () => {
  it('coalesces repeated schedules until the debounce window expires', async () => {
    vi.useFakeTimers()
    try {
      const sweep = vi.fn()
      const scheduler = createDebouncedThumbnailEviction({ sweep, delayMs: 100 })

      scheduler.schedule()
      scheduler.schedule()
      vi.advanceTimersByTime(99)
      expect(sweep).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(sweep).toHaveBeenCalledTimes(1)

      scheduler.schedule()
      await vi.advanceTimersByTimeAsync(100)
      expect(sweep).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('runs one later sweep for writes during an active sweep without overlap', async () => {
    vi.useFakeTimers()
    try {
      let resolveFirst: (() => void) | undefined
      const first = new Promise<void>((resolve) => {
        resolveFirst = resolve
      })
      const sweep = vi.fn().mockReturnValueOnce(first).mockResolvedValueOnce(undefined)
      const scheduler = createDebouncedThumbnailEviction({ sweep, delayMs: 100 })

      scheduler.schedule()
      await vi.advanceTimersByTimeAsync(100)
      expect(sweep).toHaveBeenCalledTimes(1)
      scheduler.schedule()
      scheduler.schedule()
      expect(sweep).toHaveBeenCalledTimes(1)

      resolveFirst!()
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(100)
      expect(sweep).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('suppresses a rejected sweep and schedules later work normally', async () => {
    vi.useFakeTimers()
    try {
      const onError = vi.fn()
      const sweep = vi
        .fn()
        .mockRejectedValueOnce(new Error('disk unavailable'))
        .mockResolvedValueOnce(undefined)
      const scheduler = createDebouncedThumbnailEviction({ sweep, onError, delayMs: 100 })

      scheduler.schedule()
      await vi.advanceTimersByTimeAsync(100)
      expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'disk unavailable' }))
      scheduler.schedule()
      await vi.advanceTimersByTimeAsync(100)
      expect(sweep).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})
