import { describe, it, expect, vi } from 'vitest'
import {
  createThumbnailPreview,
  scheduleStartupThumbnailSweep
} from '@src/main/media/thumbnailPreview'

const fakeThumbnailService = (path: string | null) => ({
  getThumbnail: vi.fn(async (_p: string, _t: number, _d: number) => path)
})

describe('createThumbnailPreview', () => {
  it('wraps a cached frame path as a base64 data:image/jpeg URL', async () => {
    const thumbnails = fakeThumbnailService('/cache/ab/12.jpg')
    const readBase64 = vi.fn(async (_p: string) => 'QUJD')
    const preview = createThumbnailPreview({ thumbnails, readBase64 })

    await expect(preview.getThumbnail('/video/ep.mkv', 42, 1200)).resolves.toEqual({
      dataUrl: 'data:image/jpeg;base64,QUJD'
    })
    expect(thumbnails.getThumbnail).toHaveBeenCalledWith('/video/ep.mkv', 42, 1200)
    expect(readBase64).toHaveBeenCalledWith('/cache/ab/12.jpg')
  })

  it('returns null (and never reads a file) when the service has no thumbnail', async () => {
    const readBase64 = vi.fn(async (_p: string) => 'QUJD')
    const preview = createThumbnailPreview({ thumbnails: fakeThumbnailService(null), readBase64 })

    await expect(preview.getThumbnail('/video/ep.mkv', 3, 0.5)).resolves.toBeNull()
    expect(readBase64).not.toHaveBeenCalled()
  })

  it('resolves null when previews are disabled (no thumbnail service)', async () => {
    const readBase64 = vi.fn(async (_p: string) => 'QUJD')
    const preview = createThumbnailPreview({ readBase64 })

    await expect(preview.getThumbnail('/video/ep.mkv', 42, 1200)).resolves.toBeNull()
    expect(readBase64).not.toHaveBeenCalled()
  })
})

describe('scheduleStartupThumbnailSweep', () => {
  function setup(sweep: (cacheDir: string) => Promise<string[]>) {
    let rendererReady: (() => void) | undefined
    const logger = { log: vi.fn(), warn: vi.fn() }
    const sweepFn = vi.fn(sweep)
    scheduleStartupThumbnailSweep({
      onceRendererReady: (listener) => {
        rendererReady = listener
      },
      cacheDir: '/cache',
      sweep: sweepFn,
      logger
    })
    return { sweep: sweepFn, logger, fireRendererReady: () => rendererReady?.() }
  }

  it('does not sweep until the renderer reports ready', async () => {
    const { sweep, logger, fireRendererReady } = setup(async () => ['/cache/old'])
    expect(sweep).not.toHaveBeenCalled()

    fireRendererReady()
    await vi.waitFor(() => expect(logger.log).toHaveBeenCalled())
    expect(sweep).toHaveBeenCalledWith('/cache')
    expect(logger.log).toHaveBeenCalledWith('[kizuna] thumbnail cache: evicted 1 dir(s)')
  })

  it('logs a sweep failure instead of throwing', async () => {
    const error = new Error('EACCES')
    const { logger, fireRendererReady } = setup(async () => {
      throw error
    })

    expect(() => fireRendererReady()).not.toThrow()
    await vi.waitFor(() =>
      expect(logger.warn).toHaveBeenCalledWith('[kizuna] thumbnail cache sweep failed:', error)
    )
  })
})
