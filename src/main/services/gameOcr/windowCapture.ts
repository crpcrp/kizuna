// Electron 43.3.0 / Windows 11 26200: window enumeration took 3152–3217 ms
// over five calls, versus ~304 ms for screens. A synthesized window:<hwnd>:0
// opened a 1476x1036 stream in ~430 ms without enumeration; failures fall back to display.

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
import { isFiniteNumber } from '../../../shared/guards'

export interface WindowCaptureScreen {
  getAllDisplays(): DisplayCaptureDisplay[]
  /** Windows API: mixed-DPI display origins cannot be derived from logical coordinates alone. */
  dipToScreenPoint(point: DisplayCapturePoint): DisplayCapturePoint
}

export interface WindowCaptureGeometry {
  /** Logical desktop rectangle for the frozen-frame window. */
  bounds: OcrDisplayBounds
  /** Physical pixels the stream is expected to deliver. */
  expectedImageSize: OcrImageSize
  /** The owning display's scale factor, for capture-pixel to CSS mapping. */
  scaleFactor: number
  displayId: number
}

/** Electron's final field flags the current process; captured windows belong to other processes. */
export function formatWindowSourceId(hwnd: string): string {
  return `window:${hwnd}:0`
}

/** Keep the HWND as a string: 64-bit handles may exceed JavaScript's safe integer range. */
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

// Use the display with the largest overlap; preserve negative desktop origins.
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
  // Fully off-screen windows use the first usable display; the overlay stays off-screen too.
  if (!best) return undefined

  const { display, origin } = best
  const scaleFactor = display.scaleFactor
  // Round edges independently to avoid one-pixel drift at fractional scaling.
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

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}
