// Owner of the renderer-facing seekbar preview: it turns the thumbnail
// service's cache path into the base64 data URL that crosses IPC, and owns the
// production wiring of generation + cache eviction for a configured cache
// directory. The cache policy itself lives in services/thumbnails/.

import { readFile } from 'node:fs/promises'
import { createThumbnailService, type ThumbnailService } from '../services/thumbnails/generation'
import {
  createDebouncedThumbnailEviction,
  sweepThumbnailCacheAsync,
  THUMBNAIL_CACHE_MAX_BYTES
} from '../services/thumbnails/cache'
import { nodeThumbnailAsyncDirFs, nodeThumbnailFs } from '../services/thumbnails/nodeFs'
import type { FfmpegExec } from './ffmpeg'

/** Reads a generated thumbnail jpg into a base64 string (no `data:` prefix). */
export type ReadThumbnailBase64 = (path: string) => Promise<string>

/** Production adapter: reads a cached jpg directly as base64. */
export const readThumbnailBase64: ReadThumbnailBase64 = (path) =>
  readFile(path, { encoding: 'base64' })

/** The thumbnail slice of `MediaServiceLike`. */
export interface ThumbnailPreview {
  getThumbnail(
    filePath: string,
    timeSec: number,
    durationSec: number
  ): Promise<{ dataUrl: string } | null>
}

/**
 * Builds the production thumbnail service for `cacheDir`: real node:fs
 * adapters, plus a debounced post-write sweep that keeps the cache under
 * {@link THUMBNAIL_CACHE_MAX_BYTES}.
 */
export function createCachedThumbnailService(deps: {
  cacheDir: string
  ffmpegPath: string
  execFfmpeg: FfmpegExec
  /** Path semantics for the cache layout; defaults to the host platform. */
  platform?: NodeJS.Platform
}): ThumbnailService {
  return createThumbnailService({
    exec: deps.execFfmpeg,
    fs: nodeThumbnailFs,
    cacheDir: deps.cacheDir,
    ffmpegPath: deps.ffmpegPath,
    platform: deps.platform,
    evictionScheduler: createDebouncedThumbnailEviction({
      sweep: () =>
        sweepThumbnailCacheAsync({
          cacheDir: deps.cacheDir,
          maxBytes: THUMBNAIL_CACHE_MAX_BYTES,
          fs: nodeThumbnailAsyncDirFs,
          platform: deps.platform
        }).then(() => undefined),
      onError: (error) => console.warn('[kizuna] thumbnail cache sweep failed:', error)
    })
  })
}

/**
 * Resolves the cached frame to a base64 data URL — the renderer can't read
 * arbitrary file:// paths, so the encoded image crosses IPC inline. The service
 * memoizes the cache-key stat per path and caches misses/failures, so a cache
 * hit here never re-runs ffmpeg (see services/thumbnails/generation.ts).
 * Without a `thumbnails` service (no cache dir configured) previews are
 * disabled and every request resolves null.
 */
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
