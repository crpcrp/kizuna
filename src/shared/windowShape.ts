/** A renderer-pixel rectangle that remains visible and interactive on Linux. */
export interface WindowShapeRect {
  x: number
  y: number
  width: number
  height: number
}

const MAX_SHAPE_RECTS = 512

/**
 * Validates an untrusted renderer payload and clips it to the logical window.
 * Electron's experimental `setShape` API accepts integer rectangles only; a
 * bounded list also prevents a compromised renderer from making main allocate
 * an arbitrary native X11 region.
 */
export function normalizeWindowShapeRects(
  value: unknown,
  windowWidth: number,
  windowHeight: number
): WindowShapeRect[] | null {
  if (!Array.isArray(value) || value.length > MAX_SHAPE_RECTS) return null
  const maxWidth = Math.max(0, Math.round(windowWidth))
  const maxHeight = Math.max(0, Math.round(windowHeight))
  const result: WindowShapeRect[] = []

  for (const candidate of value) {
    if (!candidate || typeof candidate !== 'object') return null
    const { x, y, width, height } = candidate as Partial<WindowShapeRect>
    if (![x, y, width, height].every((part) => typeof part === 'number' && Number.isFinite(part))) {
      return null
    }
    if (width! <= 0 || height! <= 0) return null

    const left = Math.max(0, Math.floor(x!))
    const top = Math.max(0, Math.floor(y!))
    const right = Math.min(maxWidth, Math.ceil(x! + width!))
    const bottom = Math.min(maxHeight, Math.ceil(y! + height!))
    if (right <= left || bottom <= top) continue
    result.push({ x: left, y: top, width: right - left, height: bottom - top })
  }

  return result
}
