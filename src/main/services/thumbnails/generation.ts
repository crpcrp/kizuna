// Thumbnail generation: pure path/bucket helpers plus a small service that
// wires them to the injected ffmpeg/filesystem boundaries. `exec` runs ffmpeg
// (reusing the `FfmpegExec` seam from media/ffmpeg.ts, so tests use
// test/harness/fakeFfmpeg.ts), and every `fs` touch is injected too. No live
// binary, no real disk, in tests.
//
// Bounding the cache on disk is a separate concern and lives in cache.ts; this
// module only asks the injected scheduler to sweep after it writes a file.

import { createHash } from 'node:crypto'
import { join, dirname } from 'node:path'
import { subtitleOffsetKey } from '../../../shared/playerSettings'
import type { FfmpegExec } from '../../media/ffmpeg'
import type { ThumbnailEvictionScheduler, ThumbnailStat } from './types'

export type { ThumbnailEvictionScheduler, ThumbnailStat } from './types'

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
 * stale frames; the orphaned old directory is reclaimed by the LRU eviction in
 * cache.ts.
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

/** Injected filesystem boundary for generation — all synchronous, mirroring screenshots.ts. */
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
