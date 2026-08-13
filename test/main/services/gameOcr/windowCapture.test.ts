import { describe, expect, it, vi } from 'vitest'
import type { DisplayCaptureDisplay } from '@src/main/services/gameOcr/displayCapture'
import {
  formatWindowSourceId,
  parseWindowSourceHandle,
  resolveWindowCaptureGeometry,
  type WindowCaptureScreen
} from '@src/main/services/gameOcr/windowCapture'

/**
 * A desktop laid out the way Windows lays one out: each display owns a
 * physical rectangle, and Electron reports logical bounds scaled from it. The
 * physical origins are given explicitly rather than derived, because in a
 * mixed-DPI layout they are not `logical origin x scale factor`.
 */
function screenFor(
  displays: Array<DisplayCaptureDisplay & { physicalOrigin: { x: number; y: number } }>
): WindowCaptureScreen {
  return {
    getAllDisplays: vi.fn(() =>
      displays.map(({ physicalOrigin: _ignored, ...display }) => display)
    ),
    dipToScreenPoint: vi.fn((point) => {
      const owner = displays.find(
        (display) => display.bounds.x === point.x && display.bounds.y === point.y
      )
      if (!owner) throw new Error(`no display at ${point.x},${point.y}`)
      return owner.physicalOrigin
    })
  }
}

function display(
  overrides: Partial<DisplayCaptureDisplay & { physicalOrigin: { x: number; y: number } }> = {}
): DisplayCaptureDisplay & { physicalOrigin: { x: number; y: number } } {
  return {
    id: 1,
    bounds: { x: 0, y: 0, width: 2560, height: 1440 },
    scaleFactor: 1,
    physicalOrigin: { x: 0, y: 0 },
    ...overrides
  }
}

describe('window source ids', () => {
  it('round-trips a handle through Electron’s id format', () => {
    // Verified against Electron 43.3.0 on Windows 11: a foreground HWND of
    // 1902762 is enumerated as exactly this id.
    expect(formatWindowSourceId('1902762')).toBe('window:1902762:0')
    expect(parseWindowSourceHandle('window:1902762:0')).toBe('1902762')
  })

  it('keeps a handle beyond the safe integer range exact', () => {
    const handle = '9007199254740993'
    expect(Number.isSafeInteger(Number(handle))).toBe(false)
    expect(parseWindowSourceHandle(formatWindowSourceId(handle))).toBe(handle)
  })

  it('matches only on an exact handle, never on a numeric near-miss', () => {
    // Rounded through a JavaScript number these two handles collide; as
    // strings they must not.
    const near = '9007199254740992'
    const exact = '9007199254740993'
    expect(Number(near)).toBe(Number(exact))
    expect(parseWindowSourceHandle(formatWindowSourceId(exact))).toBe(exact)
    expect(parseWindowSourceHandle(formatWindowSourceId(near))).toBe(near)
  })

  it('normalizes leading zeros to the same handle', () => {
    expect(parseWindowSourceHandle('window:0001902762:0')).toBe('1902762')
  })

  it.each([
    ['a screen source', 'screen:0:0'],
    ['a null handle', 'window:0:0'],
    ['a missing screen field', 'window:1902762'],
    ['an extra field', 'window:1902762:0:1'],
    ['a hexadecimal handle', 'window:0x1d0f2a:0'],
    ['a non-numeric screen field', 'window:1902762:main'],
    ['an empty handle', 'window::0'],
    ['a non-string', 42 as unknown as string]
  ])('rejects %s', (_label, id) => {
    expect(parseWindowSourceHandle(id)).toBeUndefined()
  })
})

describe('resolveWindowCaptureGeometry', () => {
  it('passes a 1024x768 window through unchanged on a 2560x1440 display', () => {
    // The acceptance criterion: a windowed game does not send its whole
    // display to PP-OCR.
    const geometry = resolveWindowCaptureGeometry(
      { x: 120, y: 80, width: 1024, height: 768 },
      screenFor([display()])
    )

    expect(geometry).toEqual({
      bounds: { x: 120, y: 80, width: 1024, height: 768 },
      expectedImageSize: { width: 1024, height: 768 },
      scaleFactor: 1,
      displayId: 1
    })
  })

  it.each([
    [1, 1024, 768],
    [1.25, 1280, 960],
    [1.5, 1536, 1152],
    [2, 2048, 1536]
  ])(
    'converts physical pixels to logical bounds at %s scale',
    (scaleFactor, physicalWidth, physicalHeight) => {
      // One logical 2560x1440 desktop rendered at each Windows scale. A
      // 1024x768 logical window is that many physical pixels.
      const geometry = resolveWindowCaptureGeometry(
        {
          x: Math.round(120 * scaleFactor),
          y: Math.round(80 * scaleFactor),
          width: physicalWidth,
          height: physicalHeight
        },
        screenFor([display({ scaleFactor })])
      )

      expect(geometry?.bounds).toEqual({ x: 120, y: 80, width: 1024, height: 768 })
      // The stream delivers physical pixels; that is what OCR reads.
      expect(geometry?.expectedImageSize).toEqual({
        width: physicalWidth,
        height: physicalHeight
      })
      expect(geometry?.scaleFactor).toBe(scaleFactor)
    }
  )

  it('preserves a negative secondary-monitor origin', () => {
    // Windows puts a monitor to the left of the primary at a negative x.
    // Clamping it to zero would put the overlay on the wrong screen.
    const secondary = display({
      id: 2,
      bounds: { x: -1920, y: -120, width: 1920, height: 1080 },
      scaleFactor: 1,
      physicalOrigin: { x: -1920, y: -120 }
    })
    const geometry = resolveWindowCaptureGeometry(
      { x: -1500, y: 0, width: 1024, height: 768 },
      screenFor([display(), secondary])
    )

    expect(geometry).toMatchObject({
      bounds: { x: -1500, y: 0, width: 1024, height: 768 },
      displayId: 2
    })
  })

  it('places a window on a scaled secondary monitor at a negative origin', () => {
    // The mixed-DPI case the logical origin cannot be scaled into: the
    // secondary is at logical -1536 but physical -1920, because it renders at
    // 125% while the primary renders at 100%.
    const secondary = display({
      id: 2,
      bounds: { x: -1536, y: 0, width: 1536, height: 864 },
      scaleFactor: 1.25,
      physicalOrigin: { x: -1920, y: 0 }
    })
    const geometry = resolveWindowCaptureGeometry(
      { x: -1420, y: 100, width: 1280, height: 960 },
      screenFor([display(), secondary])
    )

    expect(geometry).toEqual({
      // (-1420 - -1920) / 1.25 = 400 logical pixels into a display at -1536.
      bounds: { x: -1136, y: 80, width: 1024, height: 768 },
      expectedImageSize: { width: 1280, height: 960 },
      scaleFactor: 1.25,
      displayId: 2
    })
  })

  it('chooses the display showing most of a window that straddles two', () => {
    const secondary = display({
      id: 2,
      bounds: { x: 2560, y: 0, width: 1920, height: 1080 },
      scaleFactor: 1,
      physicalOrigin: { x: 2560, y: 0 }
    })
    const geometry = resolveWindowCaptureGeometry(
      { x: 2360, y: 100, width: 1000, height: 700 },
      screenFor([display(), secondary])
    )

    // 800 of the 1000 columns are on the secondary.
    expect(geometry?.displayId).toBe(2)
  })

  it('rounds edges rather than origin and size, so the covered area cannot drift', () => {
    const geometry = resolveWindowCaptureGeometry(
      { x: 101, y: 51, width: 1001, height: 751 },
      screenFor([display({ scaleFactor: 1.5, physicalOrigin: { x: 0, y: 0 } })])
    )

    // left = round(101/1.5) = 67, right = round(1102/1.5) = 735.
    expect(geometry?.bounds).toEqual({ x: 67, y: 34, width: 668, height: 501 })
  })

  it.each([
    ['an empty window', { x: 0, y: 0, width: 0, height: 768 }],
    ['a window beyond the OCR image limit', { x: 0, y: 0, width: 20000, height: 100 }],
    ['a window beyond the total pixel limit', { x: 0, y: 0, width: 16000, height: 16000 }]
  ])('refuses %s so the capture falls back', (_label, bounds) => {
    expect(resolveWindowCaptureGeometry(bounds, screenFor([display()]))).toBeUndefined()
  })

  it('still places a window that overlaps no display at all', () => {
    // Windows lets a window be dragged fully off screen. Mapping it relative
    // to the first usable display keeps the rectangle faithful — the overlay
    // is off screen because the window is, not because the maths gave up.
    const geometry = resolveWindowCaptureGeometry(
      { x: 9000, y: 9000, width: 800, height: 600 },
      screenFor([display()])
    )

    expect(geometry).toMatchObject({
      bounds: { x: 9000, y: 9000, width: 800, height: 600 },
      displayId: 1
    })
  })

  it('refuses when no display is usable', () => {
    expect(
      resolveWindowCaptureGeometry({ x: 0, y: 0, width: 800, height: 600 }, screenFor([]))
    ).toBeUndefined()
  })

  it('refuses when the screen API itself fails', () => {
    const screen: WindowCaptureScreen = {
      getAllDisplays: () => {
        throw new Error('display server unavailable')
      },
      dipToScreenPoint: (point) => point
    }

    expect(
      resolveWindowCaptureGeometry({ x: 0, y: 0, width: 800, height: 600 }, screen)
    ).toBeUndefined()
  })

  it('skips a display whose physical origin cannot be resolved', () => {
    const usable = display({ id: 2, physicalOrigin: { x: 0, y: 0 } })
    const screen: WindowCaptureScreen = {
      getAllDisplays: () => [
        { id: 1, bounds: { x: -1920, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 },
        { id: usable.id, bounds: usable.bounds, scaleFactor: usable.scaleFactor }
      ],
      dipToScreenPoint: (point) => {
        if (point.x === -1920) throw new Error('detached display')
        return { x: 0, y: 0 }
      }
    }

    expect(
      resolveWindowCaptureGeometry({ x: 100, y: 100, width: 800, height: 600 }, screen)
    ).toMatchObject({ displayId: 2 })
  })
})
