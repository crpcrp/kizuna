import fs from 'node:fs'
import { createHash } from 'node:crypto'
import { pathApiFor } from '../../platformPath'
import { subtitleOffsetKey } from '../../../shared/playerSettings'
import type { FfmpegExec } from '../../media/ffmpeg'
import { thumbnailBucket } from '../../../shared/thumbnailBucket'
import type { ThumbnailEvictionScheduler, ThumbnailStat } from './types'

export type { ThumbnailEvictionScheduler, ThumbnailStat } from './types'

// Use the bucket midpoint so cached frames stay stable and the last bucket never seeks past EOF.
function seekTimeForBucket(bucket: number, durationSec: number): number {
  return ((bucket + 0.5) / 100) * durationSec
}

// Include size and mtime in the cache key so replacement files cannot reuse stale thumbnails.
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

// Seek before -i for fast approximate previews; scale=-2 keeps the JPEG height even.
function buildThumbnailArgs(inputPath: string, timeSec: number, outputPath: string): string[] {
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
  // Return null for unavailable previews; cache hits never spawn ffmpeg.
  getThumbnail(path: string, timeSec: number, durationSec: number): Promise<string | null>
}

// Write to a temporary file then rename atomically so readers cannot see a partial JPEG.
// Share in-flight bucket work and remember failures to avoid repeated ffmpeg runs on hover.
export function createThumbnailService(deps: {
  exec: FfmpegExec
  cacheDir: string
  ffmpegPath: string
  evictionScheduler?: ThumbnailEvictionScheduler
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

      const seekTime = seekTimeForBucket(bucket, durationSec)
      const job = (async (): Promise<string | null> => {
        fs.mkdirSync(dirname(cachePath), { recursive: true })
        // Use a unique temporary name so concurrent processes cannot clash.
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
