import type { OcrBounds, OcrRegion, OcrResult } from '../../../shared/ocr'

/**
 * Thresholds for deciding that two recognized lines belong to the same block of
 * text. Every one is relative to the lines themselves rather than to the
 * capture, so the same values hold at 1080p and at 4K.
 */
export interface GameOcrParagraphOptions {
  /**
   * Largest vertical gap between two stacked lines, as a multiple of the
   * shorter line's height. Measuring against the shorter line keeps a heading
   * from reaching down to a distant line below it.
   */
  maxLineGapRatio: number
  /**
   * Smallest horizontal overlap the two lines must share, as a fraction of the
   * narrower one. A short line centred over a long one overlaps fully, so this
   * accepts centred and left-aligned blocks alike while still separating two
   * columns that merely sit at the same height.
   */
  minOverlapRatio: number
}

export const DEFAULT_GAME_OCR_PARAGRAPH_OPTIONS: GameOcrParagraphOptions = {
  maxLineGapRatio: 0.9,
  minOverlapRatio: 0.4
}

/**
 * Joins the recognized lines of one block of text into a single region.
 *
 * The detector reports every line separately, which for a paragraph of
 * Japanese leaves a dozen small boxes that the layout pass then has to push
 * apart to stop them overlapping — so a single body of text arrives as a
 * scatter of fragments that cannot be selected or read in one go. Merging the
 * lines first means one box, positioned over the text it came from, holding
 * the whole passage.
 *
 * Line breaks are kept as `\n`: the box renders them (`white-space: pre-wrap`)
 * and `InteractiveText` already lays multi-line text out per line, so tokens,
 * knowledge colouring, and selection all behave as they do for a subtitle cue
 * that spans two lines.
 */
export function mergeGameOcrParagraphs(
  result: OcrResult,
  options: Partial<GameOcrParagraphOptions> = {}
): OcrResult {
  const settings = { ...DEFAULT_GAME_OCR_PARAGRAPH_OPTIONS, ...options }
  if (result.regions.length < 2) return result

  const ordered = [...result.regions].sort(compareReadingOrder)
  const blocks: OcrRegion[][] = []

  for (const region of ordered) {
    // Newest block first: lines arrive top-to-bottom, so the block a line
    // continues is almost always the one that was extended most recently.
    const target = findLast(blocks, (block) =>
      continuesBlock(block[block.length - 1], region, settings)
    )
    if (target) target.push(region)
    else blocks.push([region])
  }

  if (blocks.length === result.regions.length) return result
  return { ...result, regions: blocks.map(mergeBlock) }
}

function continuesBlock(
  previous: OcrRegion,
  next: OcrRegion,
  { maxLineGapRatio, minOverlapRatio }: GameOcrParagraphOptions
): boolean {
  const previousBounds = previous.bounds
  const nextBounds = next.bounds
  const reference = Math.min(previousBounds.height, nextBounds.height)
  if (reference <= 0) return false

  // A negative gap is two lines that overlap slightly, which happens wherever
  // a glyph descends past its own box; a large one is a different block.
  const gap = nextBounds.y - (previousBounds.y + previousBounds.height)
  if (gap > reference * maxLineGapRatio || gap < -reference) return false

  const overlap =
    Math.min(right(previousBounds), right(nextBounds)) - Math.max(previousBounds.x, nextBounds.x)
  if (overlap <= 0) return false
  const narrower = Math.min(previousBounds.width, nextBounds.width)
  if (narrower <= 0) return false
  return overlap / narrower >= minOverlapRatio
}

/**
 * The merged region keeps the first line's id, so a block stays addressable by
 * something already unique within the result, and takes the weakest line's
 * confidence rather than an average that would hide it.
 */
function mergeBlock(block: OcrRegion[]): OcrRegion {
  const first = block[0]
  if (block.length === 1) return first
  return {
    id: first.id,
    text: block.map((region) => region.text).join('\n'),
    bounds: block
      .slice(1)
      .reduce((union, region) => unionBounds(union, region.bounds), first.bounds),
    confidence: block.reduce(
      (lowest, region) => Math.min(lowest, region.confidence),
      first.confidence
    )
  }
}

function unionBounds(left: OcrBounds, right_: OcrBounds): OcrBounds {
  const x = Math.min(left.x, right_.x)
  const y = Math.min(left.y, right_.y)
  return {
    x,
    y,
    width: Math.max(right(left), right(right_)) - x,
    height: Math.max(bottom(left), bottom(right_)) - y
  }
}

function compareReadingOrder(left: OcrRegion, right_: OcrRegion): number {
  if (left.bounds.y !== right_.bounds.y) return left.bounds.y - right_.bounds.y
  if (left.bounds.x !== right_.bounds.x) return left.bounds.x - right_.bounds.x
  return left.id < right_.id ? -1 : left.id > right_.id ? 1 : 0
}

function findLast<T>(items: T[], predicate: (item: T) => boolean): T | undefined {
  for (let index = items.length - 1; index >= 0; index--) {
    if (predicate(items[index])) return items[index]
  }
  return undefined
}

function right(bounds: OcrBounds): number {
  return bounds.x + bounds.width
}

function bottom(bounds: OcrBounds): number {
  return bounds.y + bounds.height
}
