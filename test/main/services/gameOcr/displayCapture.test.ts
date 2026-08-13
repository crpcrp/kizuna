import { describe, expect, it, vi } from 'vitest'
import {
  createGameOcrDisplaySources,
  displayCaptureImageSize,
  DISPLAY_CAPTURE_MEDIA_TYPE,
  type DisplayCaptureDisplay,
  type DisplayCaptureScreen,
  type DisplayCaptureSource
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

function source(displayId: number): DisplayCaptureSource {
  return { id: `screen:${displayId}:0`, display_id: String(displayId) }
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

describe('createGameOcrDisplaySources', () => {
  it('resolves the cursor display and its capture source without reading pixels', async () => {
    const selected = display()
    const other = display({ id: 8, bounds: { x: 0, y: 40, width: 1920, height: 1080 } })
    const getSources = vi.fn(async () => [source(8), source(7)])
    const screenApi = screenFor([selected, other])
    const sources = createGameOcrDisplaySources({
      platform: 'win32',
      screen: screenApi,
      desktopCapturer: { getSources }
    })

    const target = await sources.cursorDisplay()

    expect(screenApi.getDisplayNearestPoint).toHaveBeenCalledWith({ x: -100, y: 100 })
    // The smallest legal thumbnail: the pixels are never read here, because the
    // frozen frame's own stream supplies them. Asking for a real size would
    // cost ~300 ms per capture for an image nothing ever looks at.
    expect(getSources).toHaveBeenCalledWith({
      types: ['screen'],
      thumbnailSize: { width: 1, height: 1 },
      fetchWindowIcons: false
    })
    expect(target.sourceId).toBe('screen:7:0')
    expect(target.metadata).toEqual({
      displayId: 7,
      displayBounds: { x: -1920, y: 40, width: 1920, height: 1080 },
      scaleFactor: 1.25,
      imageSize: { width: 2400, height: 1350 }
    })
  })

  it('enumerates sources once and reuses them across captures', async () => {
    const getSources = vi.fn(async () => [source(7)])
    const screenApi = screenFor([display()])
    const sources = createGameOcrDisplaySources({
      platform: 'win32',
      screen: screenApi,
      desktopCapturer: { getSources }
    })

    const first = await sources.cursorDisplay()
    const second = await sources.cursorDisplay()
    await sources.cursorDisplay()
    expect(getSources).toHaveBeenCalledOnce()
    expect(screenApi.getCursorScreenPoint).toHaveBeenCalledTimes(3)
    expect(screenApi.getDisplayNearestPoint).toHaveBeenCalledOnce()
    expect(first.diagnostics).toMatchObject({
      targetCacheHit: false,
      sourceCacheHit: false
    })
    expect(second.diagnostics).toMatchObject({
      displayMs: 0,
      sourceMs: 0,
      targetCacheHit: true,
      sourceCacheHit: true
    })

    // Stop, shutdown, or a display change releases both caches, so the next
    // capture resolves the display and enumerates source ids again.
    sources.invalidate()
    await sources.cursorDisplay()
    expect(getSources).toHaveBeenCalledTimes(2)
    expect(screenApi.getDisplayNearestPoint).toHaveBeenCalledTimes(2)
  })

  it('re-enumerates once for a display that appeared since the last listing', async () => {
    let known: DisplayCaptureSource[] = []
    const getSources = vi.fn(async () => known)
    const sources = createGameOcrDisplaySources({
      platform: 'win32',
      screen: screenFor([display({ id: 9 })]),
      desktopCapturer: { getSources }
    })

    const pending = sources.cursorDisplay()
    known = [source(9)]
    await expect(pending).resolves.toMatchObject({ sourceId: 'screen:9:0' })
    expect(getSources).toHaveBeenCalledTimes(2)
  })

  it('reports a display with no capture source clearly', async () => {
    const sources = createGameOcrDisplaySources({
      platform: 'win32',
      screen: screenFor([display()]),
      desktopCapturer: { getSources: async () => [source(99)] }
    })

    await expect(sources.cursorDisplay()).rejects.toMatchObject({ code: 'source-not-found' })
  })

  it('reports a protected or denied desktop capture clearly', async () => {
    const sources = createGameOcrDisplaySources({
      platform: 'win32',
      screen: screenFor([display()]),
      desktopCapturer: {
        getSources: async () => {
          throw new Error('protected display')
        }
      }
    })

    await expect(sources.cursorDisplay()).rejects.toMatchObject({ code: 'capture-denied' })
  })

  it.each([
    ['invalid display', () => display({ scaleFactor: 0 }), 'invalid-display'],
    [
      'display beyond the capture limit',
      () => display({ bounds: { x: 0, y: 0, width: 40000, height: 40000 }, scaleFactor: 1 }),
      'image-too-large'
    ]
  ] as const)('%s fails with a clear error', async (_label, makeDisplay, code) => {
    const sources = createGameOcrDisplaySources({
      platform: 'win32',
      screen: screenFor([makeDisplay()]),
      desktopCapturer: { getSources: async () => [source(7)] }
    })

    await expect(sources.cursorDisplay()).rejects.toMatchObject({ code })
  })

  it('refuses on any platform but Windows', async () => {
    const sources = createGameOcrDisplaySources({
      platform: 'linux',
      screen: screenFor([display()]),
      desktopCapturer: { getSources: async () => [source(7)] }
    })

    await expect(sources.cursorDisplay()).rejects.toMatchObject({ code: 'unsupported' })
  })

  it('pins the encoding the OCR worker can actually decode', () => {
    // The worker's vendored OpenCV is built without a JPEG codec, and the
    // failure it produces reads as a recognition bug: the screenshot appears
    // and only OCR fails.
    expect(DISPLAY_CAPTURE_MEDIA_TYPE).toBe('image/png')
  })

  it('maps capture pixels to CSS coordinates at every supported Windows scale', () => {
    for (const scaleFactor of [1, 1.25, 1.5, 2]) {
      const metadata: OcrDisplayCaptureMetadata = {
        displayId: 7,
        displayBounds: { x: -1280, y: -40, width: 1280, height: 720 },
        scaleFactor,
        imageSize: { width: Math.round(1280 * scaleFactor), height: Math.round(720 * scaleFactor) }
      }

      expect(
        capturePixelToCssPoint(metadata, { x: 100 * scaleFactor, y: 80 * scaleFactor })
      ).toEqual({ x: -1180, y: 40 })
      expect(
        capturePixelsToCssBounds(metadata, {
          x: 100 * scaleFactor,
          y: 80 * scaleFactor,
          width: 200 * scaleFactor,
          height: 40 * scaleFactor
        })
      ).toEqual({ x: -1180, y: 40, width: 200, height: 40 })
    }
  })
})
