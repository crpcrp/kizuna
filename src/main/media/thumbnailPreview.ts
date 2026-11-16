import { readFile } from 'node:fs/promises'
import { createThumbnailService, type ThumbnailService } from '../services/thumbnails/generation'
import {
  createDebouncedThumbnailEviction,
  sweepThumbnailCacheAsync,
  THUMBNAIL_CACHE_MAX_BYTES
} from '../services/thumbnails/cache'
import type { FfmpegExec } from './ffmpeg'

/** Reads a generated thumbnail jpg into a base64 string (no `data:` prefix). */
export type ReadThumbnailBase64 = (path: string) => Promise<string>

export const readThumbnailBase64: ReadThumbnailBase64 = (path) =>
  readFile(path, { encoding: 'base64' })

export interface ThumbnailPreview {
  getThumbnail(
    filePath: string,
    timeSec: number,
    durationSec: number
  ): Promise<{ dataUrl: string } | null>
}

export function createCachedThumbnailService(deps: {
  cacheDir: string
  ffmpegPath: string
  execFfmpeg: FfmpegExec
  platform?: NodeJS.Platform
}): ThumbnailService {
  return createThumbnailService({
    exec: deps.execFfmpeg,
    cacheDir: deps.cacheDir,
    ffmpegPath: deps.ffmpegPath,
    platform: deps.platform,
    evictionScheduler: createDebouncedThumbnailEviction({
      sweep: () =>
        sweepThumbnailCacheAsync({
          cacheDir: deps.cacheDir,
          maxBytes: THUMBNAIL_CACHE_MAX_BYTES
        }).then(() => undefined),
      onError: (error) => console.warn('[kizuna] thumbnail cache sweep failed:', error)
    })
  })
}

// Wait for renderer readiness so cache eviction does not compete with window/mpv startup.
export function scheduleStartupThumbnailSweep(deps: {
  onceRendererReady(listener: () => void): void
  cacheDir: string
  sweep?: (cacheDir: string) => Promise<string[]>
  logger?: Pick<Console, 'log' | 'warn'>
}): void {
  const sweep =
    deps.sweep ??
    ((cacheDir: string) =>
      sweepThumbnailCacheAsync({
        cacheDir,
        maxBytes: THUMBNAIL_CACHE_MAX_BYTES
      }))
  const logger = deps.logger ?? console
  deps.onceRendererReady(() => {
    sweep(deps.cacheDir).then(
      (removed) => {
        if (removed.length) logger.log(`[kizuna] thumbnail cache: evicted ${removed.length} dir(s)`)
      },
      (error: unknown) => logger.warn('[kizuna] thumbnail cache sweep failed:', error)
    )
  })
}

// The renderer cannot read arbitrary file:// paths; send the image inline over IPC.
export function createThumbnailPreview(deps: {
  thumbnails?: ThumbnailService
  readBase64: ReadThumbnailBase64
}): ThumbnailPreview {
  return {
    async getThumbnail(
      filePath: string,
      timeSec: number,
      durationSec: number
    ): Promise<{ dataUrl: string } | null> {
      if (!deps.thumbnails) return null
      const cachePath = await deps.thumbnails.getThumbnail(filePath, timeSec, durationSec)
      if (cachePath === null) return null
      const base64 = await deps.readBase64(cachePath)
      return { dataUrl: `data:image/jpeg;base64,${base64}` }
    }
  }
}
