import type { OcrResult } from '../../../shared/ocr'
import type { GameOcrBoxRegion } from '../components/GameOcrBoxes'
import {
  calculateGameOcrLayout,
  type GameOcrLayoutRegion,
  type GameOcrLayoutSize
} from './gameOcrLayout'
import type { GameOcrTextSnapshot } from './gameOcrTextPipeline'

/**
 * Box typography, in CSS pixels. These mirror `.game-ocr-box` in
 * `components/GameOcrBoxes.css`; the two are kept in step so the size a box
 * asks the layout pass for matches the size it actually paints at.
 */
export interface GameOcrBoxMetrics {
  fontSize: number
  lineHeight: number
  /** Horizontal padding plus border, per side. */
  paddingX: number
  /** Vertical padding plus border, per side. */
  paddingY: number
}

export const DEFAULT_GAME_OCR_BOX_METRICS: GameOcrBoxMetrics = {
  fontSize: 15,
  lineHeight: 19,
  paddingX: 9,
  paddingY: 7
}

/** Width of one line of replacement text, in CSS pixels. */
export type GameOcrTextWidthMeasure = (text: string, fontSize: number) => number

/**
 * Deliberately a full-width estimate rather than a real font measurement: the
 * replacement text is Japanese, where one character is one em, and a Latin
 * fragment only ever comes out wider than it renders — which the layout pass
 * absorbs as slack instead of clipping.
 */
export const estimateGameOcrTextWidth: GameOcrTextWidthMeasure = (text, fontSize) =>
  [...text].length * fontSize

export interface GameOcrBoxRegionsInput {
  result: OcrResult
  viewportSize: GameOcrLayoutSize
  /** Tokens, knowledge levels, and vocabulary spans, when they have resolved. */
  text?: GameOcrTextSnapshot
  metrics?: GameOcrBoxMetrics
  measureTextWidth?: GameOcrTextWidthMeasure
}

/**
 * Pairs each accepted OCR region with the rectangle it is drawn at and, once
 * the text pipeline has caught up, with its processed tokens. Text from a
 * superseded capture is ignored rather than mixed into the current frame; the
 * plain OCR text stays selectable in the meantime.
 */
export function buildGameOcrBoxRegions({
  result,
  viewportSize,
  text,
  metrics = DEFAULT_GAME_OCR_BOX_METRICS,
  measureTextWidth = estimateGameOcrTextWidth
}: GameOcrBoxRegionsInput): GameOcrBoxRegion[] {
  const processed =
    text && text.sessionId === result.sessionId && text.captureId === result.captureId
      ? text.regions
      : undefined

  const layoutRegions: GameOcrLayoutRegion[] = result.regions.map((region) => ({
    id: region.id,
    bounds: region.bounds,
    preferredSize: preferredBoxSize(region.text, viewportSize, metrics, measureTextWidth)
  }))
  const layouts = new Map(
    calculateGameOcrLayout({
      imageSize: result.imageSize,
      viewportSize,
      regions: layoutRegions
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

/**
 * The size the replacement text wants. The OCR rectangle still supplies the
 * minimum (see `calculateGameOcrLayout`), so this only ever grows a box —
 * which is what a narrow rectangle around vertical game text needs.
 */
function preferredBoxSize(
  text: string,
  viewportSize: GameOcrLayoutSize,
  metrics: GameOcrBoxMetrics,
  measureTextWidth: GameOcrTextWidthMeasure
): GameOcrLayoutSize {
  const lines = text.split('\n')
  const widths = lines.map((line) => measureTextWidth(line, metrics.fontSize))
  const width = Math.min(
    Math.max(0, viewportSize.width),
    Math.max(0, ...widths) + metrics.paddingX * 2
  )
  const contentWidth = Math.max(1, width - metrics.paddingX * 2)
  const rows = widths.reduce(
    (total, lineWidth) => total + Math.max(1, Math.ceil(lineWidth / contentWidth)),
    0
  )
  const height = Math.min(
    Math.max(0, viewportSize.height),
    rows * metrics.lineHeight + metrics.paddingY * 2
  )
  return { width, height }
}
