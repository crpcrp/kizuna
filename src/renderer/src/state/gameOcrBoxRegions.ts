import type { OcrResult } from '../../../shared/ocr'
import type { GameOcrBoxRegion } from '../components/GameOcrBoxes'
import { groupGameOcrTextBlocks, type GameOcrTextBlock } from './gameOcrTextBlocks'
import { calculateGameOcrLayout, type GameOcrLayoutSize } from './gameOcrLayout'
import { createTextProjection } from '../../../shared/textProjection'
import type { GameOcrTextSnapshot } from './gameOcrTextPipeline'

export interface GameOcrBoxRegionsInput {
  result: OcrResult
  viewportSize: GameOcrLayoutSize
  /** Grouped line regions; omitted for callers that only have raw OCR output. */
  blocks?: readonly GameOcrTextBlock[]
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
  blocks = groupGameOcrTextBlocks(result.regions),
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
      regions: blocks.map(({ id, bounds }) => ({ id, bounds }))
    }).map((layout) => [layout.id, layout])
  )

  return blocks.flatMap((block) => {
    const layout = layouts.get(block.id)
    if (!layout) return []
    const projection = createTextProjection(block.lines)
    const candidate =
      processed?.[block.id] ??
      (block.regionIds.length === 1 ? processed?.[block.regionIds[0]] : undefined)
    const displayText = projection.displayText
    const resolved =
      candidate &&
      candidate.text === displayText &&
      (!candidate.analysisText || candidate.analysisText === projection.analysisText)
        ? candidate
        : undefined
    const fit = fitGameOcrText(displayText, layout.displayBounds.width, layout.displayBounds.height)
    return [
      {
        id: block.id,
        text: displayText,
        layout,
        fontSize: fit.fontSize,
        lineHeight: fit.lineHeight,
        projection,
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

const BOX_HORIZONTAL_INSET = 6
const BOX_VERTICAL_INSET = 4
/** Stacked replacement lines need visible separation to stay readable. */
const MIN_LINE_HEIGHT = 1.35
const MAX_LINE_HEIGHT = 2
/** A single line has no neighbour to separate from, so it stays compact. */
const SINGLE_LINE_HEIGHT = 1.1
const MIN_FONT_SIZE = 6
const MAX_FONT_SIZE = 64
const WIDTH_SAFETY_FACTOR = 0.95

/** Typography that fits the detector rectangle without changing its bounds. */
export interface GameOcrTextFit {
  fontSize: number
  /** Unitless CSS line height, spreading the lines over the whole rectangle. */
  lineHeight: number
}

/**
 * Fits replacement glyphs inside the detector rectangle without growing it.
 *
 * A block's rectangle spans its source lines, so the leading between them is
 * part of the measurement: the fitted lines are spread back over that height
 * instead of being packed at the top, which keeps each replacement line over
 * the line it replaces and keeps the gap the reader saw in the game.
 */
export function fitGameOcrText(text: string, boxWidth: number, boxHeight: number): GameOcrTextFit {
  const lines = text.split('\n')
  const availableWidth = Math.max(0, boxWidth - BOX_HORIZONTAL_INSET)
  const availableHeight = Math.max(0, boxHeight - BOX_VERTICAL_INSET)
  const widestLine = Math.max(1, ...lines.map(estimatedTextUnits))
  const minimumLineHeight = lines.length > 1 ? MIN_LINE_HEIGHT : SINGLE_LINE_HEIGHT
  const widthSize = (availableWidth / widestLine) * WIDTH_SAFETY_FACTOR
  const heightSize = availableHeight / (lines.length * minimumLineHeight)
  const fontSize = Math.max(
    MIN_FONT_SIZE,
    Math.min(MAX_FONT_SIZE, Math.floor(widthSize), Math.floor(heightSize))
  )
  return { fontSize, lineHeight: lineHeightFor(lines.length, availableHeight, fontSize) }
}

function lineHeightFor(lineCount: number, availableHeight: number, fontSize: number): number {
  if (lineCount < 2) return SINGLE_LINE_HEIGHT
  const spread = availableHeight / (lineCount * fontSize)
  return Math.round(Math.min(MAX_LINE_HEIGHT, Math.max(MIN_LINE_HEIGHT, spread)) * 100) / 100
}

/** Approximate glyph advances in ems for the Japanese UI fonts used by the overlay. */
function estimatedTextUnits(text: string): number {
  return [...text].reduce((units, character) => {
    if (/\s/u.test(character)) return units + 0.35
    if (/[\x00-\x7f]/u.test(character)) return units + 0.6
    return units + 1
  }, 0)
}
