import type { OcrBounds, OcrImageSize } from '../../../shared/ocr'

export interface GameOcrLayoutSize {
  width: number
  height: number
}

export interface GameOcrLayoutRegion {
  id: string
  bounds: OcrBounds
}

export interface GameOcrLayoutInput {
  imageSize: OcrImageSize
  viewportSize: GameOcrLayoutSize
  regions: GameOcrLayoutRegion[]
}

export interface GameOcrLayoutBounds extends GameOcrLayoutSize {
  x: number
  y: number
}

export interface GameOcrLayoutResult {
  id: string
  originalBounds: GameOcrLayoutBounds
  displayBounds: GameOcrLayoutBounds
}

/**
 * Converts OCR pixels into viewport CSS coordinates without changing the
 * detector's geometry. OCR boxes annotate pixels in the frozen frame, so
 * enlarging or collision-shifting them would point at pixels that were never
 * recognized as part of the text.
 */
export function calculateGameOcrLayout(input: GameOcrLayoutInput): GameOcrLayoutResult[] {
  const viewport = {
    width: nonNegativeFinite(input.viewportSize.width),
    height: nonNegativeFinite(input.viewportSize.height)
  }
  const scaleX = scaleFor(input.imageSize.width, viewport.width)
  const scaleY = scaleFor(input.imageSize.height, viewport.height)

  return input.regions
    .map((region, index) => {
      const originalBounds = toCssBounds(region.bounds, scaleX, scaleY)
      return {
        id: region.id,
        originalBounds,
        displayBounds: clipBox(originalBounds, viewport),
        index
      }
    })
    .sort((left, right) => {
      const top = compareNumbers(left.originalBounds.y, right.originalBounds.y)
      if (top !== 0) return top
      const horizontal = compareNumbers(left.originalBounds.x, right.originalBounds.x)
      if (horizontal !== 0) return horizontal
      const id = left.id < right.id ? -1 : left.id > right.id ? 1 : 0
      return id !== 0 ? id : left.index - right.index
    })
    .map(({ id, originalBounds, displayBounds }) => ({ id, originalBounds, displayBounds }))
}

function toCssBounds(bounds: OcrBounds, scaleX: number, scaleY: number): GameOcrLayoutBounds {
  return {
    x: scaledFinite(bounds.x, scaleX),
    y: scaledFinite(bounds.y, scaleY),
    width: Math.max(0, scaledFinite(bounds.width, scaleX)),
    height: Math.max(0, scaledFinite(bounds.height, scaleY))
  }
}

/** Clip at an edge instead of translating the rectangle away from its pixels. */
function clipBox(box: GameOcrLayoutBounds, viewport: GameOcrLayoutSize): GameOcrLayoutBounds {
  if (
    box.x >= 0 &&
    box.y >= 0 &&
    box.x + box.width <= viewport.width &&
    box.y + box.height <= viewport.height
  ) {
    return box
  }
  const left = clamp(finiteOrZero(box.x), 0, viewport.width)
  const top = clamp(finiteOrZero(box.y), 0, viewport.height)
  const right = clamp(finiteOrZero(box.x + box.width), left, viewport.width)
  const bottom = clamp(finiteOrZero(box.y + box.height), top, viewport.height)
  return { x: left, y: top, width: right - left, height: bottom - top }
}

function scaleFor(source: number, target: number): number {
  return source > 0 && Number.isFinite(source) ? target / source : 0
}

function scaledFinite(value: number, scale: number): number {
  const result = value * scale
  return Number.isFinite(result) ? result : 0
}

function nonNegativeFinite(value: number): number {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}

function compareNumbers(left: number, right: number): number {
  return left < right ? -1 : left > right ? 1 : 0
}
