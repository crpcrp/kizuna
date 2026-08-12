import { describe, expect, it, vi } from 'vitest'
import {
  createDisplayCaptureService,
  displayCaptureImageSize,
  DISPLAY_CAPTURE_JPEG_QUALITY,
  DISPLAY_CAPTURE_MEDIA_TYPE,
  type DisplayCaptureDisplay,
  type DisplayCaptureScreen,
  type DisplayCaptureSource,
  type DisplayCaptureThumbnail
} from '@src/main/services/gameOcr/displayCapture'
import {
  capturePixelToCssPoint,
  capturePixelsToCssBounds,
  type OcrDisplayCaptureMetadata
} from '@src/shared/ocr'

function display(overrides: Partial<DisplayCaptureDisplay> = {}): DisplayCaptureDisplay {
  return {
    id: 7,
    bounds: { x: -1920, y: 40, width: 1920, height: 1080 },
    scaleFactor: 1.25,
    ...overrides
  }
}

function thumbnail(
  size: { width: number; height: number },
  bytes: Uint8Array = Uint8Array.from([255, 216, 255, 224])
): DisplayCaptureThumbnail {
  return {
    isEmpty: vi.fn(() => false),
    getSize: vi.fn(() => size),
    toJPEG: vi.fn(() => bytes)
  }
}

function source(displayId: number, image: DisplayCaptureThumbnail): DisplayCaptureSource {
  return { display_id: String(displayId), thumbnail: image }
}

function screenFor(
  displays: DisplayCaptureDisplay[],
  cursor: { x: number; y: number } = { x: -100, y: 100 }
): DisplayCaptureScreen {
  return {
    getCursorScreenPoint: vi.fn(() => cursor),
    getDisplayNearestPoint: vi.fn(
      (point) =>
        displays.find(
          ({ bounds }) =>
            point.x >= bounds.x &&
            point.x < bounds.x + bounds.width &&
            point.y >= bounds.y &&
            point.y < bounds.y + bounds.height
        ) ?? displays[0]
    )
  }
}

describe('displayCaptureImageSize', () => {
  it('converts logical display bounds to physical pixels using the scale factor', () => {
    expect(
      displayCaptureImageSize({
        bounds: { x: -1280, y: 0, width: 1280, height: 720 },
        scaleFactor: 1.5
      })
    ).toEqual({ width: 1920, height: 1080 })
  })
})

describe('createDisplayCaptureService', () => {
  it('selects the cursor display, captures full bounds, and matches its source ID', async () => {
    const selected = display()
    const other = display({
      id: 8,
      bounds: { x: 0, y: 40, width: 1920, height: 1080 }
    })
    const image = thumbnail(displayCaptureImageSize(selected))
    const otherImage = thumbnail(displayCaptureImageSize(other))
    const getSources = vi.fn(async () => [source(8, otherImage), source(7, image)])
    const screenApi = screenFor([selected, other])
    const service = createDisplayCaptureService({
      platform: 'win32',
      screen: screenApi,
      desktopCapturer: { getSources }
    })

    const capture = await service.capture()

    expect(screenApi.getCursorScreenPoint).toHaveBeenCalledOnce()
    expect(screenApi.getDisplayNearestPoint).toHaveBeenCalledWith({ x: -100, y: 100 })
    expect(getSources).toHaveBeenCalledWith({
      types: ['screen'],
      thumbnailSize: { width: 2400, height: 1350 },
      fetchWindowIcons: false
    })
    expect(capture.metadata).toEqual({
      displayId: 7,
      displayBounds: { x: -1920, y: 40, width: 1920, height: 1080 },
      scaleFactor: 1.25,
      imageSize: { width: 2400, height: 1350 }
    })
    expect(capture.imageSize).toEqual({ width: 2400, height: 1350 })
    expect(capture.imageBase64).toBe(Buffer.from([255, 216, 255, 224]).toString('base64'))
    expect(capture.imageMediaType).toBe(DISPLAY_CAPTURE_MEDIA_TYPE)
    // One encode, and a lossy one: the same bytes serve the frozen frame and
    // the OCR worker, and a full-display PNG costs the user visible latency.
    expect(image.toJPEG).toHaveBeenCalledOnce()
    expect(image.toJPEG).toHaveBeenCalledWith(DISPLAY_CAPTURE_JPEG_QUALITY)
  })

  it('retains immutable metadata and releases the encoded image on disposal', async () => {
    const selected = display({ id: 2, scaleFactor: 1 })
    const image = thumbnail(displayCaptureImageSize(selected))
    const service = createDisplayCaptureService({
      platform: 'win32',
      screen: screenFor([selected]),
      desktopCapturer: { getSources: async () => [source(2, image)] }
    })

    const capture = await service.capture()

    expect(Object.isFrozen(capture.metadata)).toBe(true)
    expect(Object.isFrozen(capture.metadata.displayBounds)).toBe(true)
    expect(Object.isFrozen(capture.metadata.imageSize)).toBe(true)
    expect(capture.disposed).toBe(false)

    capture.dispose()
    capture.dispose()

    expect(capture.imageBase64).toBeUndefined()
    expect(capture.disposed).toBe(true)
    expect(capture.metadata.displayBounds).toEqual({ x: -1920, y: 40, width: 1920, height: 1080 })
  })

  it('reports unsupported on non-Windows without touching Electron boundaries', async () => {
    const screenApi = screenFor([display()])
    const getSources = vi.fn()
    const service = createDisplayCaptureService({
      platform: 'linux',
      screen: screenApi,
      desktopCapturer: { getSources }
    })

    await expect(service.capture()).rejects.toMatchObject({ code: 'unsupported' })
    expect(screenApi.getCursorScreenPoint).not.toHaveBeenCalled()
    expect(getSources).not.toHaveBeenCalled()
  })

  it('reports a missing source without retaining or writing a frame', async () => {
    const selected = display()
    const image = thumbnail(displayCaptureImageSize(selected))
    const service = createDisplayCaptureService({
      platform: 'win32',
      screen: screenFor([selected]),
      desktopCapturer: { getSources: async () => [source(99, image)] }
    })

    await expect(service.capture()).rejects.toMatchObject({ code: 'source-not-found' })
    expect(image.toJPEG).not.toHaveBeenCalled()
  })

  it('reports a protected or denied desktop capture clearly', async () => {
    const selected = display()
    const service = createDisplayCaptureService({
      platform: 'win32',
      screen: screenFor([selected]),
      desktopCapturer: {
        getSources: async () => {
          throw new Error('protected display')
        }
      }
    })

    await expect(service.capture()).rejects.toMatchObject({ code: 'capture-denied' })
  })

  it.each([
    [
      'empty frame',
      () => thumbnail(displayCaptureImageSize(display()), Uint8Array.from([])),
      'empty-frame'
    ],
    ['dimension mismatch', () => thumbnail({ width: 1, height: 1 }), 'dimension-mismatch'],
    [
      'encoded size limit',
      () => thumbnail(displayCaptureImageSize(display()), Uint8Array.from([1, 2, 3, 4])),
      'image-too-large'
    ]
  ] as const)('%s fails with a clear error', async (_label, makeImage, code) => {
    const selected = display()
    const image = makeImage()
    if (code === 'empty-frame') vi.mocked(image.isEmpty).mockReturnValue(true)
    const service = createDisplayCaptureService({
      platform: 'win32',
      screen: screenFor([selected]),
      desktopCapturer: { getSources: async () => [source(selected.id, image)] },
      ...(code === 'image-too-large' ? { maxEncodedBytes: 1 } : {})
    })

    await expect(service.capture()).rejects.toMatchObject({ code })
  })

  it('maps capture pixels to CSS coordinates at every supported Windows scale', () => {
    const scales = [1, 1.25, 1.5, 2]
    for (const scaleFactor of scales) {
      const metadata: OcrDisplayCaptureMetadata = {
        displayId: 7,
        displayBounds: { x: -1280, y: -40, width: 1280, height: 720 },
        scaleFactor,
        imageSize: { width: Math.round(1280 * scaleFactor), height: Math.round(720 * scaleFactor) }
      }

      expect(
        capturePixelToCssPoint(metadata, { x: 100 * scaleFactor, y: 80 * scaleFactor })
      ).toEqual({
        x: -1180,
        y: 40
      })
      expect(
        capturePixelsToCssBounds(metadata, {
          x: 100 * scaleFactor,
          y: 80 * scaleFactor,
          width: 200 * scaleFactor,
          height: 40 * scaleFactor
        })
      ).toEqual({
        x: -1180,
        y: 40,
        width: 200,
        height: 40
      })
    }
  })
})
