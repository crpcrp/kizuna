import { describe, it, expect, vi } from 'vitest'
import { WINDOWS_PATHS } from '@test/harness/platformPaths'
import {
  createDebouncedThumbnailEviction,
  selectEvictions,
  summarizeCacheDir,
  collectCacheEntriesAsync,
  sweepThumbnailCacheAsync,
  THUMBNAIL_CACHE_MAX_BYTES,
  type ThumbnailCacheEntry,
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

describe('collectCacheEntriesAsync', () => {
  it('sums bytes and takes the newest mtime per file-dir', async () => {
    // Pinned to Linux path rules so the fake's keys are literal; the Windows
    // layout is asserted separately below.
    const stats: Record<string, ThumbnailStat> = {
      ['/cache/h1/0.jpg']: { size: 100, mtimeMs: 10 },
      ['/cache/h1/1.jpg']: { size: 50, mtimeMs: 40 },
      ['/cache/h2/0.jpg']: { size: 200, mtimeMs: 5 }
    }
    const fs: Omit<ThumbnailAsyncDirFs, 'remove'> = {
      readSubdirs: async (dir) => (dir === '/cache' ? ['h1', 'h2'] : []),
      readFiles: async (dir) => (dir === '/cache/h1' ? ['0.jpg', '1.jpg'] : ['0.jpg']),
      stat: async (p) => stats[p]
    }
    await expect(collectCacheEntriesAsync('/cache', fs, 'linux')).resolves.toEqual([
      { path: '/cache/h1', bytes: 150, mtimeMs: 40 },
      { path: '/cache/h2', bytes: 200, mtimeMs: 5 }
    ])
  })

  it('walks a Windows cache directory with backslash-joined file-dirs', async () => {
    const cacheDir = WINDOWS_PATHS.path.join(WINDOWS_PATHS.userDataDir, 'thumbnails')
    const fileDir = `${cacheDir}\\h1`
    const fs: Omit<ThumbnailAsyncDirFs, 'remove'> = {
      readSubdirs: async (dir) => (dir === cacheDir ? ['h1'] : []),
      readFiles: async (dir) => (dir === fileDir ? ['0.jpg'] : []),
      stat: async (p) =>
        p === `${fileDir}\\0.jpg` ? { size: 100, mtimeMs: 10 } : { size: 0, mtimeMs: 0 }
    }
    await expect(collectCacheEntriesAsync(cacheDir, fs, 'win32')).resolves.toEqual([
      { path: fileDir, bytes: 100, mtimeMs: 10 }
    ])
  })

  it('returns [] for a missing cache dir', async () => {
    const fs: Omit<ThumbnailAsyncDirFs, 'remove'> = {
      readSubdirs: async () => [],
      readFiles: async () => [],
      stat: async () => ({ size: 0, mtimeMs: 0 })
    }
    await expect(collectCacheEntriesAsync('/cache', fs, 'linux')).resolves.toEqual([])
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
      sweepThumbnailCacheAsync({ cacheDir: '/cache', maxBytes: 500, fs, platform: 'linux' })
    ).resolves.toEqual(['/cache/old'])
    expect(removed).toEqual(['/cache/old'])
    await expect(collectCacheEntriesAsync('/cache', fs, 'linux')).resolves.toEqual([
      { path: '/cache/old', bytes: 400, mtimeMs: 1 },
      { path: '/cache/new', bytes: 400, mtimeMs: 9 }
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
