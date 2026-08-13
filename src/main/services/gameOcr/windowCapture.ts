// Turns a native foreground window into something Electron can capture: a
// desktop-capture source id, and the logical desktop rectangle the frozen
// frame has to cover.
//
// Two measurements on the pinned runtime (Electron 43.3.0, Windows 11 26200)
// shape everything here.
//
// **Window source ids encode the HWND.** Electron documents the form as
// `window:XX:YY`, and enumeration confirms it exactly: a foreground HWND of
// 1902762 appears as `window:1902762:0`. The handle is the identity, so no
// title text is involved in choosing a window.
//
// **Enumerating window sources costs ~3.2 seconds, every time.**
// `desktopCapturer.getSources({ types: ['window'] })` measured 3152-3217 ms
// across five consecutive calls and does not warm up, against ~304 ms for
// `['screen']`. That is far beyond the whole shortcut-to-screenshot budget,
// and it cannot be cached across shortcuts either, because the user may
// alt-tab to a different game between two presses.
//
// So the id is constructed from the handle instead of looked up. Chromium
// accepts a synthesized id: opening `window:<hwnd>:0` with no preceding
// `getSources` call at all produced a live 1476x1036 stream of that window in
// ~430 ms. A handle Chromium will not capture simply fails to open, which is
// already a fallback branch — it costs one failed stream open rather than 3.2
// seconds on every capture.

import {
  MAX_OCR_IMAGE_DIMENSION,
  type OcrDisplayBounds,
  type OcrImageSize
} from '../../../shared/ocr'
import {
  MAX_DISPLAY_CAPTURE_PIXELS,
  type DisplayCaptureDisplay,
  type DisplayCapturePoint
} from './displayCapture'
import type { PhysicalRect } from './foregroundWindow'

/** Screen surface needed to place a physical window rectangle on a display. */
export interface WindowCaptureScreen {
  getAllDisplays(): DisplayCaptureDisplay[]
  /**
   * Windows-only Electron API converting a logical point to physical desktop
   * pixels. Used to learn each display's physical origin, which `Display`
   * itself does not expose and which cannot be derived from the logical
   * origin in a mixed-DPI layout.
   */
  dipToScreenPoint(point: DisplayCapturePoint): DisplayCapturePoint
}

/** Where a captured window sits, in the coordinates each consumer needs. */
export interface WindowCaptureGeometry {
  /** Logical desktop rectangle for the frozen-frame window. */
  bounds: OcrDisplayBounds
  /** Physical pixels the stream is expected to deliver. */
  expectedImageSize: OcrImageSize
  /** The owning display's scale factor, for capture-pixel to CSS mapping. */
  scaleFactor: number
  displayId: number
}

/**
 * Builds the capture-source id for a window handle.
 *
 * The trailing field is Electron's "belongs to the current process" flag, 0
 * for every other application. Kizuna's own windows are rejected at the
 * native boundary, so only 0 is ever produced here.
 */
export function formatWindowSourceId(hwnd: string): string {
  return `window:${hwnd}:0`
}

/**
 * Reads the native handle back out of a capture-source id.
 *
 * Kept as the exact inverse of `formatWindowSourceId` and tested as a
 * round trip, so the one place that knows Electron's id shape is this pair.
 * The handle stays a string throughout: a 64-bit HWND does not fit in a
 * JavaScript number, and a rounded handle would compare equal to a different
 * window's.
 */
export function parseWindowSourceHandle(sourceId: unknown): string | undefined {
  if (typeof sourceId !== 'string') return undefined
  const parts = sourceId.split(':')
  if (parts.length !== 3 || parts[0] !== 'window') return undefined
  const digits = parts[1] ?? ''
  if (!/^[0-9]+$/.test(digits) || digits.length > 20) return undefined
  if (!/^[0-9]+$/.test(parts[2] ?? '')) return undefined
  const normalized = digits.replace(/^0+(?=[0-9])/, '')
  return normalized === '0' ? undefined : normalized
}

/**
 * Places a window's physical rectangle on the display that owns it and
 * converts it to logical desktop coordinates.
 *
 * The owning display is chosen by largest overlap rather than by the window's
 * origin, so a window straddling two monitors is covered on the one showing
 * most of it. Negative desktop origins are carried through unchanged: on
 * Windows a secondary monitor left of the primary has a negative x, and
 * clamping it to zero would put the overlay on the wrong screen.
 *
 * Returns `undefined` when no display can own the rectangle or the result
 * would exceed the OCR image contract, both of which mean display capture.
 */
export function resolveWindowCaptureGeometry(
  physicalBounds: PhysicalRect,
  screen: WindowCaptureScreen,
  limits: { maxImageDimension?: number; maxImagePixels?: number } = {}
): WindowCaptureGeometry | undefined {
  const maxImageDimension = limits.maxImageDimension ?? MAX_OCR_IMAGE_DIMENSION
  const maxImagePixels = limits.maxImagePixels ?? MAX_DISPLAY_CAPTURE_PIXELS
  if (!isPositiveInteger(physicalBounds.width) || !isPositiveInteger(physicalBounds.height)) {
    return undefined
  }

  let displays: DisplayCaptureDisplay[]
  try {
    displays = screen.getAllDisplays() ?? []
  } catch {
    return undefined
  }

  let best:
    { display: DisplayCaptureDisplay; origin: DisplayCapturePoint; score: number } | undefined
  for (const display of displays) {
    if (!isUsableDisplay(display)) continue
    let origin: DisplayCapturePoint
    try {
      origin = screen.dipToScreenPoint({ x: display.bounds.x, y: display.bounds.y })
    } catch {
      continue
    }
    if (!isFiniteNumber(origin?.x) || !isFiniteNumber(origin?.y)) continue
    const physicalDisplay = {
      x: origin.x,
      y: origin.y,
      width: Math.round(display.bounds.width * display.scaleFactor),
      height: Math.round(display.bounds.height * display.scaleFactor)
    }
    const score = intersectionArea(physicalBounds, physicalDisplay)
    if (!best || score > best.score) best = { display, origin, score }
  }
  // A window overlapping nothing still leaves `best` set to the first usable
  // display, so its rectangle is mapped faithfully rather than discarded.
  // Windows lets a window be dragged fully off screen; the overlay is then off
  // screen too, which is correct — it is covering where the window actually is.
  if (!best) return undefined

  const { display, origin } = best
  const scaleFactor = display.scaleFactor
  // Rounded as edges rather than as an origin plus a size, so the covered
  // rectangle does not drift by a pixel at fractional scale factors.
  const left = Math.round(display.bounds.x + (physicalBounds.x - origin.x) / scaleFactor)
  const top = Math.round(display.bounds.y + (physicalBounds.y - origin.y) / scaleFactor)
  const right = Math.round(
    display.bounds.x + (physicalBounds.x + physicalBounds.width - origin.x) / scaleFactor
  )
  const bottom = Math.round(
    display.bounds.y + (physicalBounds.y + physicalBounds.height - origin.y) / scaleFactor
  )
  const bounds = { x: left, y: top, width: right - left, height: bottom - top }
  if (bounds.width <= 0 || bounds.height <= 0) return undefined

  const expectedImageSize = { width: physicalBounds.width, height: physicalBounds.height }
  if (
    expectedImageSize.width > maxImageDimension ||
    expectedImageSize.height > maxImageDimension ||
    expectedImageSize.width * expectedImageSize.height > maxImagePixels
  ) {
    return undefined
  }

  return { bounds, expectedImageSize, scaleFactor, displayId: display.id }
}

function intersectionArea(left: PhysicalRect, right: PhysicalRect): number {
  const width = Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x)
  const height = Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y)
  return width > 0 && height > 0 ? width * height : 0
}

function isUsableDisplay(
  display: DisplayCaptureDisplay | undefined
): display is DisplayCaptureDisplay {
  return (
    !!display &&
    typeof display === 'object' &&
    Number.isSafeInteger(display.id) &&
    !!display.bounds &&
    isFiniteNumber(display.bounds.x) &&
    isFiniteNumber(display.bounds.y) &&
    isFiniteNumber(display.bounds.width) &&
    isFiniteNumber(display.bounds.height) &&
    display.bounds.width > 0 &&
    display.bounds.height > 0 &&
    isFiniteNumber(display.scaleFactor) &&
    display.scaleFactor > 0
  )
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}
