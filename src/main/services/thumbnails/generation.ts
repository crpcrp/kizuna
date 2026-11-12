import fs from 'node:fs'
import { createHash } from 'node:crypto'
import { pathApiFor } from '../../platformPath'
import { subtitleOffsetKey } from '../../../shared/playerSettings'
import type { FfmpegExec } from '../../media/ffmpeg'
import { thumbnailBucket } from '../../../shared/thumbnailBucket'
import type { ThumbnailEvictionScheduler, ThumbnailStat } from './types'

export type { ThumbnailEvictionScheduler, ThumbnailStat } from './types'

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
  bucket: number,
  platform: NodeJS.Platform = process.platform
): string {
  const canonical = subtitleOffsetKey(mediaPath)
  const hash = createHash('sha1').update(`${canonical}|${size}|${mtimeMs}`).digest('hex')
  return pathApiFor(platform).join(cacheDir, hash, `${bucket}.jpg`)
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
  cacheDir: string
  ffmpegPath: string
  evictionScheduler?: ThumbnailEvictionScheduler
  /** Path semantics for the cache layout; defaults to the host platform. */
  platform?: NodeJS.Platform
}): ThumbnailService {
  const { dirname } = pathApiFor(deps.platform)
  let statPath: string | undefined
  let statInfo: ThumbnailStat | undefined
  let inFlight = new Map<string, Promise<string | null>>()
  let failed = new Set<string>()
  let tmpCounter = 0

  return {
    async getThumbnail(path, timeSec, durationSec): Promise<string | null> {
      const bucket = thumbnailBucket(timeSec, durationSec)
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
          statInfo = fs.statSync(path)
        } catch {
          return null
        }
      }

      const cachePath = thumbnailCachePath(
        deps.cacheDir,
        path,
        statInfo.size,
        statInfo.mtimeMs,
        bucket,
        deps.platform
      )

      if (fs.existsSync(cachePath)) return cachePath
      if (failed.has(cachePath)) return null
      const existing = inFlight.get(cachePath)
      if (existing) return existing

      // Seek to the bucket's midpoint, never the raw hover time: the frame is
      // cached per bucket, and a right-edge hover (timeSec >= durationSec)
      // would otherwise seek past EOF, produce no image, and poison the bucket.
      const seekTime = seekTimeForBucket(bucket, durationSec)
      const job = (async (): Promise<string | null> => {
        fs.mkdirSync(dirname(cachePath), { recursive: true })
        // Unique temp so two processes/buckets racing the same dir never clash.
        const tmp = `${cachePath}.${process.pid}.${(tmpCounter += 1)}.tmp`
        try {
          await deps.exec(deps.ffmpegPath, buildThumbnailArgs(path, seekTime, tmp))
          fs.renameSync(tmp, cachePath)
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
