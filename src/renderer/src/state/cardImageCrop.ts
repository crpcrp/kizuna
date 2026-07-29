// Crop math for the mined-card picture dialog. Pure: the drag rectangle the
// user paints over the captured frame is normalized here, and mapped from CSS
// display pixels to the frame's natural pixels, so the component only has to
// report pointer positions. The one impure step (drawing to a canvas) takes an
// injected canvas, keeping it testable without a real one.

export interface Point {
  x: number
  y: number
}

export interface Size {
  width: number
  height: number
}

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Smallest drag, in CSS display pixels, that counts as a deliberate crop. A
 * click without a drag produces a degenerate rectangle; below this the crop
 * action stays disabled and the user takes the full frame instead.
 */
export const MIN_CROP_DISPLAY_PX = 8

/** Longest allowed edge for JPEGs attached to mined Anki cards. */
export const CARD_IMAGE_MAX_DIMENSION_PX = 1280

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}

/**
 * Fits an integer pixel size within `maxDimension` without upscaling. The
 * longer edge lands exactly on the cap when scaling is needed; the other edge
 * uses deterministic nearest-integer rounding and cannot collapse below one.
 */
export function fitWithinMaxDimension(sourceSize: Size, maxDimension: number): Size | null {
  if (
    !Number.isInteger(sourceSize.width) ||
    !Number.isInteger(sourceSize.height) ||
    !Number.isInteger(maxDimension) ||
    sourceSize.width <= 0 ||
    sourceSize.height <= 0 ||
    maxDimension <= 0
  ) {
    return null
  }

  const longestEdge = Math.max(sourceSize.width, sourceSize.height)
  if (longestEdge <= maxDimension) return { ...sourceSize }

  const scale = maxDimension / longestEdge
  if (sourceSize.width >= sourceSize.height) {
    return {
      width: maxDimension,
      height: Math.max(1, Math.round(sourceSize.height * scale))
    }
  }
  return {
    width: Math.max(1, Math.round(sourceSize.width * scale)),
    height: maxDimension
  }
}

/**
 * The rectangle spanned by a drag from `start` to `end`, in display pixels.
 * A reverse drag (right-to-left or bottom-to-top) yields the same rectangle as
 * the forward one, and both corners are clamped into `bounds` so a pointer that
 * left the image never selects outside it.
 */
export function normalizeSelection(start: Point, end: Point, bounds: Size): Rect {
  const x1 = clamp(Math.min(start.x, end.x), 0, bounds.width)
  const x2 = clamp(Math.max(start.x, end.x), 0, bounds.width)
  const y1 = clamp(Math.min(start.y, end.y), 0, bounds.height)
  const y2 = clamp(Math.max(start.y, end.y), 0, bounds.height)
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 }
}

/** True when `selection` is at least `MIN_CROP_DISPLAY_PX` on both axes. */
export function isSubmittableCrop(selection: Rect | null): boolean {
  return (
    selection !== null &&
    selection.width >= MIN_CROP_DISPLAY_PX &&
    selection.height >= MIN_CROP_DISPLAY_PX
  )
}

/**
 * Maps a display-pixel selection onto the frame's natural pixels. The image is
 * scaled to fit the dialog, so the scale is rarely integral; both edges round
 * *inward* (left/top up, right/bottom down) so the crop can never include a
 * pixel column the user did not cover. Returns null when the selection or the
 * geometry collapses to less than one natural pixel.
 */
export function toNaturalRect(selection: Rect, display: Size, natural: Size): Rect | null {
  if (display.width <= 0 || display.height <= 0 || natural.width <= 0 || natural.height <= 0) {
    return null
  }
  const scaleX = natural.width / display.width
  const scaleY = natural.height / display.height
  const left = clamp(Math.ceil(selection.x * scaleX), 0, natural.width)
  const top = clamp(Math.ceil(selection.y * scaleY), 0, natural.height)
  const right = clamp(Math.floor((selection.x + selection.width) * scaleX), 0, natural.width)
  const bottom = clamp(Math.floor((selection.y + selection.height) * scaleY), 0, natural.height)
  const width = right - left
  const height = bottom - top
  return width >= 1 && height >= 1 ? { x: left, y: top, width, height } : null
}

/** The whole frame, in natural pixels — the "Add full frame" choice. */
export function fullFrameRect(natural: Size): Rect {
  return { x: 0, y: 0, width: natural.width, height: natural.height }
}

/** The slice of `HTMLCanvasElement` the JPEG encoder needs (faked in tests). */
export interface CanvasLike {
  width: number
  height: number
  getContext(contextId: '2d'): {
    drawImage(
      image: CanvasImageSource,
      sx: number,
      sy: number,
      sw: number,
      sh: number,
      dx: number,
      dy: number,
      dw: number,
      dh: number
    ): void
  } | null
  toDataURL(type: string, quality?: number): string
}

/** JPEG quality for mined pictures — visually clean at a fraction of PNG's size. */
export const CARD_IMAGE_JPEG_QUALITY = 0.85

/**
 * Draws `rect` (natural pixels) of `image` into `canvas` and returns the result
 * as raw base64 JPEG — no `data:` URL prefix, which is what AnkiConnect's
 * `data` media attachment expects. Returns null when the canvas cannot produce
 * a JPEG (no 2D context, or an encoder that returned something else).
 */
export function renderJpegBase64(
  image: CanvasImageSource,
  rect: Rect,
  canvas: CanvasLike,
  quality: number = CARD_IMAGE_JPEG_QUALITY
): string | null {
  const outputSize = fitWithinMaxDimension(rect, CARD_IMAGE_MAX_DIMENSION_PX)
  if (!outputSize) return null
  canvas.width = outputSize.width
  canvas.height = outputSize.height
  const context = canvas.getContext('2d')
  if (!context) return null
  context.drawImage(
    image,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    0,
    0,
    outputSize.width,
    outputSize.height
  )
  const dataUrl = canvas.toDataURL('image/jpeg', quality)
  const marker = 'base64,'
  const index = dataUrl.indexOf(marker)
  if (!dataUrl.startsWith('data:image/jpeg') || index === -1) return null
  const base64 = dataUrl.slice(index + marker.length)
  return base64 === '' ? null : base64
}
