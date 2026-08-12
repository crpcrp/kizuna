import type { OcrResult } from '../../../shared/ocr'
import type { GameOcrBoxRegion } from '../components/GameOcrBoxes'
import { calculateGameOcrLayout, type GameOcrLayoutSize } from './gameOcrLayout'
import type { GameOcrTextSnapshot } from './gameOcrTextPipeline'

export interface GameOcrBoxRegionsInput {
  result: OcrResult
  viewportSize: GameOcrLayoutSize
  /** Tokens, knowledge levels, and vocabulary spans, when they have resolved. */
  text?: GameOcrTextSnapshot
}

/**
 * Pairs each accepted line-level OCR region with the exact rectangle it was
 * detected at and, once text processing catches up, its interactive tokens.
 * Text from a superseded capture is ignored rather than mixed into the current
 * frame; plain OCR text stays selectable in the meantime.
 */
export function buildGameOcrBoxRegions({
  result,
  viewportSize,
  text
}: GameOcrBoxRegionsInput): GameOcrBoxRegion[] {
  const processed =
    text && text.sessionId === result.sessionId && text.captureId === result.captureId
      ? text.regions
      : undefined

  const layouts = new Map(
    calculateGameOcrLayout({
      imageSize: result.imageSize,
      viewportSize,
      regions: result.regions.map(({ id, bounds }) => ({ id, bounds }))
    }).map((layout) => [layout.id, layout])
  )

  return result.regions.flatMap((region) => {
    const layout = layouts.get(region.id)
    if (!layout) return []
    const resolved = processed?.[region.id]
    return [
      {
        id: region.id,
        text: region.text,
        layout,
        fontSize: fitGameOcrFontSize(
          region.text,
          layout.displayBounds.width,
          layout.displayBounds.height
        ),
        ...(resolved
          ? {
              tokens: resolved.tokens,
              levels: resolved.levels,
              vocabularySpans: resolved.vocabularySpans
            }
          : {})
      } satisfies GameOcrBoxRegion
    ]
  })
}

const BOX_CONTENT_INSET = 4
const MIN_FONT_SIZE = 6
const MAX_FONT_SIZE = 32
const WIDTH_SAFETY_FACTOR = 0.95

/** Fit replacement glyphs inside the detector rectangle without growing it. */
export function fitGameOcrFontSize(text: string, boxWidth: number, boxHeight: number): number {
  const lines = text.split('\n')
  const availableWidth = Math.max(0, boxWidth - BOX_CONTENT_INSET)
  const availableHeight = Math.max(0, boxHeight - BOX_CONTENT_INSET)
  const widestLine = Math.max(1, ...lines.map(estimatedTextUnits))
  const widthSize = (availableWidth / widestLine) * WIDTH_SAFETY_FACTOR
  const heightSize = availableHeight / Math.max(1, lines.length)
  return Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, Math.floor(widthSize), heightSize))
}

/** Approximate glyph advances in ems for the Japanese UI fonts used by the overlay. */
function estimatedTextUnits(text: string): number {
  return [...text].reduce((units, character) => {
    if (/\s/u.test(character)) return units + 0.35
    if (/[\x00-\x7f]/u.test(character)) return units + 0.6
    return units + 1
  }, 0)
}
