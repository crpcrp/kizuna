import { describe, it, expect, vi } from 'vitest'
import {
  CARD_IMAGE_MAX_DIMENSION_PX,
  CARD_IMAGE_JPEG_QUALITY,
  MIN_CROP_DISPLAY_PX,
  fitWithinMaxDimension,
  fullFrameRect,
  isSubmittableCrop,
  normalizeSelection,
  renderJpegBase64,
  toNaturalRect,
  type CanvasLike,
  type Rect
} from '@src/renderer/src/state/cardImageCrop'

// Crop math for the mined-card picture dialog. Pure input → pure output; the
// only impure step (canvas encoding) is exercised through a fake CanvasLike.

const DISPLAY = { width: 640, height: 360 }

describe('fitWithinMaxDimension', () => {
  it('fits landscape and portrait sizes to the maximum edge', () => {
    expect(fitWithinMaxDimension({ width: 3840, height: 2160 }, 1280)).toEqual({
      width: 1280,
      height: 720
    })
    expect(fitWithinMaxDimension({ width: 2160, height: 3840 }, 1280)).toEqual({
      width: 720,
      height: 1280
    })
  })

  it('leaves sizes at or below the cap unchanged', () => {
    expect(fitWithinMaxDimension({ width: 1280, height: 720 }, 1280)).toEqual({
      width: 1280,
      height: 720
    })
    expect(fitWithinMaxDimension({ width: 640, height: 360 }, 1280)).toEqual({
      width: 640,
      height: 360
    })
  })

  it('fits a square and rounds the secondary edge deterministically', () => {
    expect(fitWithinMaxDimension({ width: 2048, height: 2048 }, 1280)).toEqual({
      width: 1280,
      height: 1280
    })
    expect(fitWithinMaxDimension({ width: 3000, height: 2000 }, 1280)).toEqual({
      width: 1280,
      height: 853
    })
  })

  it('keeps a scaled secondary edge at least one pixel', () => {
    expect(fitWithinMaxDimension({ width: 10000, height: 1 }, 1280)).toEqual({
      width: 1280,
      height: 1
    })
  })

  it('rejects invalid source dimensions and maximums', () => {
    expect(fitWithinMaxDimension({ width: 0, height: 720 }, 1280)).toBeNull()
    expect(fitWithinMaxDimension({ width: 1280, height: -1 }, 1280)).toBeNull()
    expect(fitWithinMaxDimension({ width: Number.NaN, height: 720 }, 1280)).toBeNull()
    expect(
      fitWithinMaxDimension({ width: 1280, height: Number.POSITIVE_INFINITY }, 1280)
    ).toBeNull()
    expect(fitWithinMaxDimension({ width: 1280.5, height: 720 }, 1280)).toBeNull()
    expect(fitWithinMaxDimension({ width: 1280, height: 720 }, 0)).toBeNull()
    expect(fitWithinMaxDimension({ width: 1280, height: 720 }, Number.NaN)).toBeNull()
    expect(fitWithinMaxDimension({ width: 1280, height: 720 }, 1280.5)).toBeNull()
  })
})

describe('normalizeSelection', () => {
  it('returns the same rectangle for a forward and a reverse drag', () => {
    const forward = normalizeSelection({ x: 10, y: 20 }, { x: 110, y: 80 }, DISPLAY)
    const reverse = normalizeSelection({ x: 110, y: 80 }, { x: 10, y: 20 }, DISPLAY)

    expect(forward).toEqual({ x: 10, y: 20, width: 100, height: 60 })
    expect(reverse).toEqual(forward)
  })

  it('normalizes a drag reversed on only one axis', () => {
    expect(normalizeSelection({ x: 110, y: 20 }, { x: 10, y: 80 }, DISPLAY)).toEqual({
      x: 10,
      y: 20,
      width: 100,
      height: 60
    })
  })

  it('clamps a pointer dragged past the image to its bounds', () => {
    expect(normalizeSelection({ x: -40, y: -10 }, { x: 900, y: 500 }, DISPLAY)).toEqual({
      x: 0,
      y: 0,
      width: 640,
      height: 360
    })
  })

  it('yields a zero-size rectangle for a click without a drag', () => {
    expect(normalizeSelection({ x: 50, y: 50 }, { x: 50, y: 50 }, DISPLAY)).toEqual({
      x: 50,
      y: 50,
      width: 0,
      height: 0
    })
  })
})

describe('isSubmittableCrop', () => {
  it('requires at least the minimum size on both axes', () => {
    const min = MIN_CROP_DISPLAY_PX
    expect(isSubmittableCrop({ x: 0, y: 0, width: min, height: min })).toBe(true)
    expect(isSubmittableCrop({ x: 0, y: 0, width: min - 1, height: min })).toBe(false)
    expect(isSubmittableCrop({ x: 0, y: 0, width: min, height: min - 1 })).toBe(false)
  })

  it('rejects a missing or degenerate selection', () => {
    expect(isSubmittableCrop(null)).toBe(false)
    expect(isSubmittableCrop({ x: 5, y: 5, width: 0, height: 0 })).toBe(false)
  })
})

describe('toNaturalRect', () => {
  it('scales a selection by an integral display-to-natural factor', () => {
    const rect = toNaturalRect({ x: 10, y: 20, width: 100, height: 60 }, DISPLAY, {
      width: 1280,
      height: 720
    })

    expect(rect).toEqual({ x: 20, y: 40, width: 200, height: 120 })
  })

  it('rounds both edges inward on a non-integral scale', () => {
    // 1.5×: left 15.75 → 16, right (10.5+100.5)*1.5 = 166.5 → 166 (width 150).
    const rect = toNaturalRect({ x: 10.5, y: 10.5, width: 100.5, height: 100.5 }, DISPLAY, {
      width: 960,
      height: 540
    })

    expect(rect).toEqual({ x: 16, y: 16, width: 150, height: 150 })
  })

  it('never selects a natural pixel outside the frame', () => {
    const rect = toNaturalRect({ x: 0, y: 0, width: 640, height: 360 }, DISPLAY, {
      width: 1920,
      height: 1080
    })

    expect(rect).toEqual({ x: 0, y: 0, width: 1920, height: 1080 })
  })

  it('returns null when inward rounding leaves less than one natural pixel', () => {
    // The still is displayed larger than it is: 8 display px is under one
    // natural pixel, so there is no whole pixel to crop.
    expect(
      toNaturalRect({ x: 0.5, y: 0.5, width: 8, height: 8 }, DISPLAY, { width: 32, height: 18 })
    ).toBeNull()
  })

  it('returns null for a collapsed display or natural size', () => {
    const selection: Rect = { x: 0, y: 0, width: 10, height: 10 }
    expect(
      toNaturalRect(selection, { width: 0, height: 360 }, { width: 1280, height: 720 })
    ).toBeNull()
    expect(toNaturalRect(selection, DISPLAY, { width: 1280, height: 0 })).toBeNull()
  })
})

describe('fullFrameRect', () => {
  it('covers the whole natural frame', () => {
    expect(fullFrameRect({ width: 1920, height: 1080 })).toEqual({
      x: 0,
      y: 0,
      width: 1920,
      height: 1080
    })
  })
})

describe('renderJpegBase64', () => {
  function fakeCanvas(dataUrl = 'data:image/jpeg;base64,ENCODED'): {
    canvas: CanvasLike
    drawImage: ReturnType<typeof vi.fn>
  } {
    const drawImage = vi.fn()
    const canvas: CanvasLike = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage }),
      toDataURL: () => dataUrl
    }
    return { canvas, drawImage }
  }

  const image = {} as CanvasImageSource

  it('scales a full-frame source into the bounded canvas and returns raw base64', () => {
    const { canvas, drawImage } = fakeCanvas()

    const base64 = renderJpegBase64(image, { x: 0, y: 0, width: 3840, height: 2160 }, canvas)

    expect(base64).toBe('ENCODED')
    expect(canvas.width).toBe(CARD_IMAGE_MAX_DIMENSION_PX)
    expect(canvas.height).toBe(720)
    expect(drawImage).toHaveBeenCalledWith(image, 0, 0, 3840, 2160, 0, 0, 1280, 720)
  })

  it('preserves a cropped source rectangle while scaling its destination', () => {
    const { canvas, drawImage } = fakeCanvas()

    renderJpegBase64(image, { x: 400, y: 200, width: 1600, height: 1200 }, canvas)

    expect(canvas.width).toBe(1280)
    expect(canvas.height).toBe(960)
    expect(drawImage).toHaveBeenCalledWith(image, 400, 200, 1600, 1200, 0, 0, 1280, 960)
  })

  it('encodes at the card-image JPEG quality', () => {
    const toDataURL = vi.fn(() => 'data:image/jpeg;base64,ENCODED')
    const canvas: CanvasLike = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: vi.fn() }),
      toDataURL
    }

    renderJpegBase64(image, { x: 0, y: 0, width: 8, height: 8 }, canvas)

    expect(toDataURL).toHaveBeenCalledWith('image/jpeg', CARD_IMAGE_JPEG_QUALITY)
  })

  it('returns null without a 2D context', () => {
    const canvas: CanvasLike = {
      width: 0,
      height: 0,
      getContext: () => null,
      toDataURL: () => 'data:image/jpeg;base64,ENCODED'
    }

    expect(renderJpegBase64(image, { x: 0, y: 0, width: 8, height: 8 }, canvas)).toBeNull()
  })

  it('returns null when the encoder produced no JPEG payload', () => {
    expect(
      renderJpegBase64(image, { x: 0, y: 0, width: 8, height: 8 }, fakeCanvas('data:,').canvas)
    ).toBeNull()
    expect(
      renderJpegBase64(
        image,
        { x: 0, y: 0, width: 8, height: 8 },
        fakeCanvas('data:image/jpeg;base64,').canvas
      )
    ).toBeNull()
  })
})
