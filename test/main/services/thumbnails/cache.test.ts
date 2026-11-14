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
import {
  createDebouncedThumbnailEviction,
  selectEvictions,
  sweepThumbnailCacheAsync,
  type ThumbnailCacheEntry
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
})

describe('thumbnail cache on disk', () => {
  it('walks only files within subdirectories and removes the oldest directory', async () => {
    const cacheDir = tempDir()
    const old = join(cacheDir, 'old')
    const recent = join(cacheDir, 'recent')
    for (const [dir, time] of [
      [old, 1],
      [recent, 9]
    ] as const) {
      disk.mkdirSync(dir)
      const file = join(dir, '0.jpg')
      disk.writeFileSync(file, new Uint8Array(400))
      disk.utimesSync(file, time, time)
    }
    disk.writeFileSync(join(cacheDir, 'unrelated'), 'keep')
    disk.mkdirSync(join(recent, 'nested'))
    await expect(sweepThumbnailCacheAsync({ cacheDir, maxBytes: 500 })).resolves.toEqual([old])
    expect(disk.existsSync(old)).toBe(false)
    expect(disk.existsSync(join(cacheDir, 'unrelated'))).toBe(true)
    expect(disk.existsSync(recent)).toBe(true)
    await expect(sweepThumbnailCacheAsync({ cacheDir, maxBytes: 400 })).resolves.toEqual([])
  })

  it('sums every file and uses the newest file to rank a directory', async () => {
    const cacheDir = tempDir()
    const mixed = join(cacheDir, 'mixed')
    const middle = join(cacheDir, 'middle')
    disk.mkdirSync(mixed)
    disk.mkdirSync(middle)
    for (const [dir, name, time] of [
      [mixed, '0.jpg', 1],
      [mixed, '1.jpg', 9],
      [middle, '0.jpg', 5]
    ] as const) {
      const file = join(dir, name)
      disk.writeFileSync(file, new Uint8Array(100))
      disk.utimesSync(file, time, time)
    }
    await expect(sweepThumbnailCacheAsync({ cacheDir, maxBytes: 200 })).resolves.toEqual([middle])
    expect(disk.existsSync(mixed)).toBe(true)
    await expect(sweepThumbnailCacheAsync({ cacheDir, maxBytes: 199 })).resolves.toEqual([mixed])
  })

  it('handles empty subdirectories without evicting under the cap', async () => {
    const cacheDir = tempDir()
    const empty = join(cacheDir, 'empty')
    disk.mkdirSync(empty)
    await expect(sweepThumbnailCacheAsync({ cacheDir, maxBytes: 0 })).resolves.toEqual([])
    expect(disk.existsSync(empty)).toBe(true)
  })

  it('treats missing cache directories as empty', async () => {
    await expect(
      sweepThumbnailCacheAsync({ cacheDir: join(tempDir(), 'missing'), maxBytes: 0 })
    ).resolves.toEqual([])
  })
})

describe('createDebouncedThumbnailEviction', () => {
  it('coalesces repeated schedules until the debounce window expires', async () => {
    vi.useFakeTimers()
    try {
      const sweep = vi.fn()
      const scheduler = createDebouncedThumbnailEviction({ sweep })

      scheduler.schedule()
      scheduler.schedule()
      vi.advanceTimersByTime(999)
      expect(sweep).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(sweep).toHaveBeenCalledTimes(1)

      scheduler.schedule()
      await vi.advanceTimersByTimeAsync(1000)
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
      const scheduler = createDebouncedThumbnailEviction({ sweep })

      scheduler.schedule()
      await vi.advanceTimersByTimeAsync(1000)
      expect(sweep).toHaveBeenCalledTimes(1)
      scheduler.schedule()
      scheduler.schedule()
      expect(sweep).toHaveBeenCalledTimes(1)

      resolveFirst!()
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(1000)
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
      const scheduler = createDebouncedThumbnailEviction({ sweep, onError })

      scheduler.schedule()
      await vi.advanceTimersByTimeAsync(1000)
      expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'disk unavailable' }))
      scheduler.schedule()
      await vi.advanceTimersByTimeAsync(1000)
      expect(sweep).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})
