import { readdir, stat, rm } from 'node:fs/promises'
import { join } from 'node:path'
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
 * Coalesces post-write cache sweeps into one bounded delayed job.
 */
export function createDebouncedThumbnailEviction(deps: {
  sweep: () => Promise<void> | void
  onError?: (error: unknown) => void
}): ThumbnailEvictionScheduler {
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
    setTimeout(() => {
      pending = false
      void run()
    }, 1000)
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
 * newest mtime as the recency proxy.
 */
function summarizeCacheDir(dir: string, stats: ThumbnailStat[]): ThumbnailCacheEntry {
  return {
    path: dir,
    bytes: stats.reduce((total, stat) => total + stat.size, 0),
    mtimeMs: stats.reduce((latest, stat) => Math.max(latest, stat.mtimeMs), 0)
  }
}

/**
 * Walks `cacheDir` into one {@link ThumbnailCacheEntry} per file-dir, summing
 * bytes and taking the newest mtime as the recency proxy.
 */
async function collectCacheEntriesAsync(cacheDir: string): Promise<ThumbnailCacheEntry[]> {
  const subdirs = await listNames(cacheDir, 'dir')
  return Promise.all(
    subdirs.map(async (name) => {
      const dir = join(cacheDir, name)
      const files = await listNames(dir, 'file')
      return summarizeCacheDir(dir, await Promise.all(files.map((file) => stat(join(dir, file)))))
    })
  )
}

/**
 * Collects the cache's file-dirs, picks LRU evictions to get under `maxBytes`,
 * and removes them. Returns the removed paths (for logging).
 */
export async function sweepThumbnailCacheAsync(deps: {
  cacheDir: string
  maxBytes: number
}): Promise<string[]> {
  const evicted = selectEvictions(await collectCacheEntriesAsync(deps.cacheDir), deps.maxBytes)
  await Promise.all(evicted.map((path) => rm(path, { recursive: true, force: true })))
  return evicted
}

async function listNames(dir: string, kind: 'dir' | 'file'): Promise<string[]> {
  try {
    return (await readdir(dir, { withFileTypes: true }))
      .filter((entry) => (kind === 'dir' ? entry.isDirectory() : entry.isFile()))
      .map((entry) => entry.name)
  } catch {
    return []
  }
}
