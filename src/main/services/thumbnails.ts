// Seekbar hover thumbnails — service core.
//
// Pure path/bucket helpers plus a small service that wires them to the
// injected ffmpeg/filesystem boundaries: `exec` runs ffmpeg (reusing the
// `FfmpegExec` seam from media/ffmpeg.ts, so tests use
// test/harness/fakeFfmpeg.ts), and every `fs` touch is injected too. No live
// binary, no real disk, in tests.

import { createHash } from 'node:crypto'
import { join, dirname } from 'node:path'
import { subtitleOffsetKey } from '../../shared/playerSettings'
import type { FfmpegExec } from '../media/ffmpeg'

/**
 * Which 1-percent bucket of the timeline `timeSec` falls into, `0..99`, or
 * `null` when no preview should be shown. `null` for non-finite inputs and for
 * durations under 1 s (too short — and covers unknown/zero duration), matching
 * the "≤100 thumbs per file, ~1 per percent" cache design. `timeSec` is
 * clamped into range so a scrub past the reported end still maps to bucket 99.
 */
export function bucketFor(timeSec: number, durationSec: number): number | null {
  if (!Number.isFinite(timeSec) || !Number.isFinite(durationSec)) return null
  if (durationSec < 1) return null
  const raw = Math.floor((timeSec / durationSec) * 100)
  return Math.max(0, Math.min(99, raw))
}

/**
 * Deterministic seek time (seconds) for a bucket's representative frame — the
 * bucket's midpoint, `(bucket + 0.5) / 100 * durationSec`. Because thumbnails
 * are cached per bucket, the exact hover time within a bucket is irrelevant, so
 * seeking to the midpoint keeps the generated frame stable *and* keeps every
 * seek strictly inside the file: even bucket 99 lands at 99.5 % of duration,
 * never at or past EOF (a right-edge hover with `timeSec >= durationSec` would
 * otherwise `-ss` past the last frame, yield no image, and poison the bucket).
 */
export function seekTimeForBucket(bucket: number, durationSec: number): number {
  return ((bucket + 0.5) / 100) * durationSec
}

/**
 * Absolute cache path for one thumbnail:
 *   `<cacheDir>/<sha1(canonicalPath|size|mtimeMs)>/<bucket>.jpg`
 *
 * The hash folds the file's identity (canonical path plus `size`/`mtimeMs`
 * from one `fs.stat`) into the directory name, so a file replaced or
 * re-encoded at the same path hashes to a fresh directory instead of serving
 * stale frames; the orphaned old directory is reclaimed by LRU eviction (see
 * below).
 * `canonicalPath` reuses `subtitleOffsetKey`, the established generic path
 * canonicalizer (separator folding + Windows lowercasing).
 */
export function thumbnailCachePath(
  cacheDir: string,
  mediaPath: string,
  size: number,
  mtimeMs: number,
  bucket: number
): string {
  const canonical = subtitleOffsetKey(mediaPath)
  const hash = createHash('sha1').update(`${canonical}|${size}|${mtimeMs}`).digest('hex')
  return join(cacheDir, hash, `${bucket}.jpg`)
}

/**
 * ffmpeg argv for a single preview frame at `timeSec`, scaled to 200px wide:
 *   ffmpeg -v error -y -ss <t> -i <input> -frames:v 1 -vf scale=200:-2 -f image2 <output>
 *
 * `-ss` before `-i` is a fast keyframe seek — approximate frames are exactly
 * right for hover previews. `scale=200:-2` keeps the aspect ratio with an
 * even height (required by the jpeg encoder).
 */
export function buildThumbnailArgs(
  inputPath: string,
  timeSec: number,
  outputPath: string
): string[] {
  return [
    '-v',
    'error',
    '-y',
    '-ss',
    String(Math.max(0, timeSec)),
    '-i',
    inputPath,
    '-frames:v',
    '1',
    '-vf',
    'scale=200:-2',
    '-f',
    'image2',
    outputPath
  ]
}

/** One `fs.stat` result the cache key needs: byte size + mtime. */
export interface ThumbnailStat {
  size: number
  mtimeMs: number
}

/** Injected filesystem boundary — all synchronous, mirroring screenshots.ts. */
export interface ThumbnailFs {
  stat(path: string): ThumbnailStat
  exists(path: string): boolean
  mkdir(path: string): void // recursive
  rename(from: string, to: string): void
}

export interface ThumbnailService {
  /**
   * Resolves the absolute path of the cached jpg for the hovered time, or
   * `null` when no preview is available (out-of-range time, stat failure, or a
   * bucket whose generation previously failed). Cache hits never spawn ffmpeg.
   */
  getThumbnail(path: string, timeSec: number, durationSec: number): Promise<string | null>
}

export interface ThumbnailEvictionScheduler {
  schedule(): void
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
 * Builds the thumbnail service. `getThumbnail`:
 *  - maps the time to a bucket (`null` → no preview);
 *  - stats the file once per loaded path (memoized until the path changes) to
 *    build a file-identity cache key;
 *  - serves an existing cache file without running ffmpeg;
 *  - otherwise runs ffmpeg once (writing to a temp name, then renaming — atomic
 *    on the same volume, so a half-written jpg is never served) and caches the
 *    result;
 *  - serializes concurrent requests for the same bucket via an in-flight map,
 *    and remembers a failed bucket in memory so a corrupt region isn't
 *    re-spawned on every hover.
 */
export function createThumbnailService(deps: {
  exec: FfmpegExec
  fs: ThumbnailFs
  cacheDir: string
  ffmpegPath: string
  evictionScheduler?: ThumbnailEvictionScheduler
}): ThumbnailService {
  let statPath: string | undefined
  let statInfo: ThumbnailStat | undefined
  let inFlight = new Map<string, Promise<string | null>>()
  let failed = new Set<string>()
  let tmpCounter = 0

  return {
    async getThumbnail(path, timeSec, durationSec): Promise<string | null> {
      const bucket = bucketFor(timeSec, durationSec)
      if (bucket === null) return null

      // A new path invalidates the memoized stat and the per-file caches; the
      // in-flight/failed keys belong to the previous file's cache dir.
      if (path !== statPath) {
        statPath = path
        statInfo = undefined
        inFlight = new Map()
        failed = new Set()
      }
      if (!statInfo) {
        try {
          statInfo = deps.fs.stat(path)
        } catch {
          return null
        }
      }

      const cachePath = thumbnailCachePath(
        deps.cacheDir,
        path,
        statInfo.size,
        statInfo.mtimeMs,
        bucket
      )

      if (deps.fs.exists(cachePath)) return cachePath
      if (failed.has(cachePath)) return null
      const existing = inFlight.get(cachePath)
      if (existing) return existing

      // Seek to the bucket's midpoint, never the raw hover time: the frame is
      // cached per bucket, and a right-edge hover (timeSec >= durationSec)
      // would otherwise seek past EOF, produce no image, and poison the bucket.
      const seekTime = seekTimeForBucket(bucket, durationSec)
      const job = (async (): Promise<string | null> => {
        deps.fs.mkdir(dirname(cachePath))
        // Unique temp so two processes/buckets racing the same dir never clash.
        const tmp = `${cachePath}.${process.pid}.${(tmpCounter += 1)}.tmp`
        try {
          await deps.exec(deps.ffmpegPath, buildThumbnailArgs(path, seekTime, tmp))
          deps.fs.rename(tmp, cachePath)
          deps.evictionScheduler?.schedule()
          return cachePath
        } catch {
          failed.add(cachePath)
          return null
        }
      })()
      inFlight.set(cachePath, job)
      try {
        return await job
      } finally {
        inFlight.delete(cachePath)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Thumbnail cache LRU eviction.
//
// The cache grows one file-dir per opened media file (see thumbnailCachePath),
// and a replaced/re-encoded file leaves its old dir orphaned. To bound disk
// use, a startup sweep deletes the least-recently-used file-dirs until the
// cache is back under a byte cap. The selection is a pure function; the walk
// and deletes go through an injected fs so it's testable without real disk.
// ---------------------------------------------------------------------------

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

/** Injected directory walk for the sweep — implemented over node:fs in index.ts. */
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
export function collectCacheEntries(cacheDir: string, fs: ThumbnailDirFs): ThumbnailCacheEntry[] {
  return fs.readSubdirs(cacheDir).map((name) => {
    const dir = join(cacheDir, name)
    let bytes = 0
    let mtimeMs = 0
    for (const file of fs.readFiles(dir)) {
      const s = fs.stat(join(dir, file))
      bytes += s.size
      if (s.mtimeMs > mtimeMs) mtimeMs = s.mtimeMs
    }
    return { path: dir, bytes, mtimeMs }
  })
}

/** Async counterpart used only for post-write runtime eviction. */
export async function collectCacheEntriesAsync(
  cacheDir: string,
  fs: Omit<ThumbnailAsyncDirFs, 'remove'>
): Promise<ThumbnailCacheEntry[]> {
  const subdirs = await fs.readSubdirs(cacheDir)
  return Promise.all(
    subdirs.map(async (name) => {
      const dir = join(cacheDir, name)
      const files = await fs.readFiles(dir)
      const stats = await Promise.all(files.map((file) => fs.stat(join(dir, file))))
      return {
        path: dir,
        bytes: stats.reduce((total, stat) => total + stat.size, 0),
        mtimeMs: stats.reduce((latest, stat) => Math.max(latest, stat.mtimeMs), 0)
      }
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
}): string[] {
  const evicted = selectEvictions(collectCacheEntries(deps.cacheDir, deps.fs), deps.maxBytes)
  for (const path of evicted) deps.fs.remove(path)
  return evicted
}

/** Runtime sweep: async traversal and removal, with the same LRU policy as startup. */
export async function sweepThumbnailCacheAsync(deps: {
  cacheDir: string
  maxBytes: number
  fs: ThumbnailAsyncDirFs
}): Promise<string[]> {
  const evicted = selectEvictions(
    await collectCacheEntriesAsync(deps.cacheDir, deps.fs),
    deps.maxBytes
  )
  await Promise.all(evicted.map((path) => deps.fs.remove(path)))
  return evicted
}
