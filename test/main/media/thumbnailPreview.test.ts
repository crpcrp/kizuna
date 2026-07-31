import { describe, it, expect, vi } from 'vitest'
import { createThumbnailPreview } from '@src/main/media/thumbnailPreview'

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
