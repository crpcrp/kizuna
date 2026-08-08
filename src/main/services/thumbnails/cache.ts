// Thumbnail cache lifecycle: LRU eviction and the debounced scheduler that
// drives it. Generation itself lives in generation.ts.
//
// The cache grows one file-dir per opened media file (see `thumbnailCachePath`),
// and a replaced/re-encoded file leaves its old dir orphaned. To bound disk
// use, a sweep deletes the least-recently-used file-dirs until the cache is
// back under a byte cap. Both the selection (`selectEvictions`) and the
// per-dir summary (`summarizeCacheDir`) are pure and shared by the synchronous
// startup sweep and the asynchronous runtime sweep, so the two differ only in
// how they walk and delete — never in policy. The walk and deletes go through
// an injected fs so both are testable without real disk.

import { pathApiFor } from '../../platformPath'
import type { ThumbnailEvictionScheduler, ThumbnailStat } from './types'

export type { ThumbnailEvictionScheduler, ThumbnailStat } from './types'

/** ~500 MB default cap for the whole thumbnail cache. */
export const THUMBNAIL_CACHE_MAX_BYTES = 500 * 1024 * 1024

/** One file-dir (a sha1 directory) in the cache, summarized for eviction. */
export interface ThumbnailCacheEntry {
  /** Absolute path of the file-dir. */
  path: string
  /** Total bytes of the thumbnails under it. */
  bytes: number
  /** Recency proxy — the newest mtime among its files; oldest evicted first. */
  mtimeMs: number
}

/**
 * Coalesces post-write cache sweeps into one bounded delayed job. The timer is
 * injected so tests can advance it deterministically without waiting.
 */
export function createDebouncedThumbnailEviction(deps: {
  sweep: () => Promise<void> | void
  onError?: (error: unknown) => void
  delayMs?: number
  setTimeout?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>
}): ThumbnailEvictionScheduler {
  const delayMs = deps.delayMs ?? 1000
  const setTimeoutFn = deps.setTimeout ?? setTimeout
  let pending = false
  let running = false
  let reschedule = false

  async function run(): Promise<void> {
    running = true
    try {
      await deps.sweep()
    } catch (error) {
      deps.onError?.(error)
    } finally {
      running = false
      if (reschedule) {
        reschedule = false
        schedule()
      }
    }
  }

  function schedule(): void {
    if (running) {
      reschedule = true
      return
    }
    if (pending) return
    pending = true
    setTimeoutFn(() => {
      pending = false
      void run()
    }, delayMs)
  }

  return {
    schedule
  }
}

/**
 * Pure. Given the cache's file-dirs and a byte cap, returns the paths to
 * delete — least-recently-used first — so the surviving total is ≤ `maxBytes`.
 * Returns `[]` when already under the cap; evicts everything when
 * `maxBytes <= 0`. Stable for equal mtimes (input order preserved).
 */
export function selectEvictions(entries: ThumbnailCacheEntry[], maxBytes: number): string[] {
  let total = entries.reduce((sum, e) => sum + e.bytes, 0)
  if (total <= maxBytes) return []

  // Oldest first; a stable sort keeps equal-mtime entries in input order.
  const oldestFirst = entries
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.mtimeMs - b.e.mtimeMs || a.i - b.i)
  const evicted: string[] = []
  for (const { e } of oldestFirst) {
    if (total <= maxBytes) break
    evicted.push(e.path)
    total -= e.bytes
  }
  return evicted
}

/**
 * Pure. Summarizes one file-dir from its files' stats: total bytes, and the
 * newest mtime as the recency proxy. Shared by both walks so "how a file-dir is
 * measured" is stated once.
 */
export function summarizeCacheDir(dir: string, stats: ThumbnailStat[]): ThumbnailCacheEntry {
  return {
    path: dir,
    bytes: stats.reduce((total, stat) => total + stat.size, 0),
    mtimeMs: stats.reduce((latest, stat) => Math.max(latest, stat.mtimeMs), 0)
  }
}

/** Injected directory walk for the synchronous startup sweep. */
export interface ThumbnailDirFs {
  /** Immediate subdirectory names of `dir` (the sha1 file-dirs); `[]` if absent. */
  readSubdirs(dir: string): string[]
  /** File names directly under `dir`. */
  readFiles(dir: string): string[]
  /** size + mtimeMs of one file. */
  stat(path: string): ThumbnailStat
}

/** Async directory-walk boundary for runtime eviction, kept off the main thread. */
export interface ThumbnailAsyncDirFs {
  readSubdirs(dir: string): Promise<string[]>
  readFiles(dir: string): Promise<string[]>
  stat(path: string): Promise<ThumbnailStat>
  remove(path: string): Promise<void>
}

/**
 * Walks `cacheDir` into one {@link ThumbnailCacheEntry} per file-dir, summing
 * bytes and taking the newest mtime as the recency proxy.
 */
export function collectCacheEntries(
  cacheDir: string,
  fs: ThumbnailDirFs,
  platform: NodeJS.Platform = process.platform
): ThumbnailCacheEntry[] {
  const { join } = pathApiFor(platform)
  return fs.readSubdirs(cacheDir).map((name) => {
    const dir = join(cacheDir, name)
    return summarizeCacheDir(
      dir,
      fs.readFiles(dir).map((file) => fs.stat(join(dir, file)))
    )
  })
}

/** Async counterpart used only for post-write runtime eviction. */
export async function collectCacheEntriesAsync(
  cacheDir: string,
  fs: Omit<ThumbnailAsyncDirFs, 'remove'>,
  platform: NodeJS.Platform = process.platform
): Promise<ThumbnailCacheEntry[]> {
  const { join } = pathApiFor(platform)
  const subdirs = await fs.readSubdirs(cacheDir)
  return Promise.all(
    subdirs.map(async (name) => {
      const dir = join(cacheDir, name)
      const files = await fs.readFiles(dir)
      return summarizeCacheDir(
        dir,
        await Promise.all(files.map((file) => fs.stat(join(dir, file))))
      )
    })
  )
}

/**
 * Startup sweep: collects the cache's file-dirs, picks LRU evictions to get
 * under `maxBytes`, and removes them. Returns the removed paths (for logging).
 */
export function sweepThumbnailCache(deps: {
  cacheDir: string
  maxBytes: number
  fs: ThumbnailDirFs & { remove(path: string): void }
  /** Path semantics for the cache walk; defaults to the host platform. */
  platform?: NodeJS.Platform
}): string[] {
  const evicted = selectEvictions(
    collectCacheEntries(deps.cacheDir, deps.fs, deps.platform),
    deps.maxBytes
  )
  for (const path of evicted) deps.fs.remove(path)
  return evicted
}

/** Runtime sweep: async traversal and removal, with the same LRU policy as startup. */
export async function sweepThumbnailCacheAsync(deps: {
  cacheDir: string
  maxBytes: number
  fs: ThumbnailAsyncDirFs
  /** Path semantics for the cache walk; defaults to the host platform. */
  platform?: NodeJS.Platform
}): Promise<string[]> {
  const evicted = selectEvictions(
    await collectCacheEntriesAsync(deps.cacheDir, deps.fs, deps.platform),
    deps.maxBytes
  )
  await Promise.all(evicted.map((path) => deps.fs.remove(path)))
  return evicted
}
