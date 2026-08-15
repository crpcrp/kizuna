import type { OcrBounds, OcrRegion } from '../../../shared/ocr'

/** One deterministic group of line-level OCR regions. */
export interface GameOcrTextBlock {
  /** Stable within a capture, derived from the ordered member IDs. */
  readonly id: string
  readonly regionIds: readonly string[]
  /** Source regions in top-to-bottom, left-to-right reading order. */
  readonly regions: readonly OcrRegion[]
  /**
   * One string per visible line. A line detected as several side-by-side
   * regions — a list marker and its sentence, for example — is one entry, so
   * `lines` can be shorter than `regions`.
   */
  readonly lines: readonly string[]
  /** Exact captured-image union of all member bounds. */
  readonly bounds: OcrBounds
}

/** One visible line, built from the regions detected side by side on it. */
interface WorkingRow {
  regions: OcrRegion[]
  bounds: OcrBounds
  text: string
}

interface WorkingBlock {
  rows: WorkingRow[]
  extendable: boolean
}

interface OrderedRegion {
  region: OcrRegion
  inputIndex: number
}

/**
 * Lines need to be wider than tall to be eligible for vertical grouping.
 * This leaves vertical text as a one-member block.
 */
const HORIZONTAL_ASPECT_RATIO = 1.5

/** A visibly separated row should remain its own readable replacement box. */
const MAX_VERTICAL_GAP_LINE_HEIGHTS = 0.5

/** Require substantial overlap when neither paragraph edge is aligned. */
const MIN_HORIZONTAL_OVERLAP_RATIO = 0.5

/** Edge alignment is relative to the detected line height, not the screen. */
const EDGE_ALIGNMENT_TOLERANCE_LINE_HEIGHTS = 1

/** Side-by-side fragments of one line share most of their vertical extent. */
const MIN_VERTICAL_OVERLAP_RATIO = 0.6

/** Two detections of the same line are within about one character of it. */
const MAX_HORIZONTAL_GAP_LINE_HEIGHTS = 1

/** Detectors emit lightly overlapping neighbours; a real column does not. */
const MAX_HORIZONTAL_OVERLAP_LINE_HEIGHTS = 0.2

/** A heading and a small badge beside it are different lines, not fragments. */
const MIN_ROW_HEIGHT_RATIO = 0.5

/** Wide enough to read as a gap between words rather than a detector seam. */
const SEPARATOR_GAP_LINE_HEIGHTS = 0.25

/**
 * Groups one capture's line-level OCR regions using a conservative,
 * resolution-independent geometry heuristic. No input region is modified.
 *
 * Grouping happens twice: side-by-side detections of one visible line become a
 * single line, then closely stacked lines become a block. Both passes are
 * needed for a dialogue menu, where a numbered marker is often detected apart
 * from the option it belongs to and would otherwise be drawn as its own box on
 * top of that option's replacement text.
 */
export function groupGameOcrTextBlocks(regions: readonly OcrRegion[]): GameOcrTextBlock[] {
  const blocks: WorkingBlock[] = []

  for (const row of groupRows(regions)) {
    const compatible = blocks.filter((block) => canAppend(block, row))

    // A line that could attach to more than one existing block is ambiguous:
    // keeping it alone prevents an unusually wide line from bridging columns.
    if (compatible.length === 1) {
      compatible[0].rows.push(row)
    } else {
      blocks.push({ rows: [row], extendable: compatible.length === 0 })
    }
  }

  return blocks
    .sort((left, right) => compareBounds(left.rows[0].bounds, right.rows[0].bounds))
    .map(createTextBlock)
}

/** Merges the fragments of each visible line, in reading order. */
function groupRows(regions: readonly OcrRegion[]): WorkingRow[] {
  const ordered = regions
    .map((region, inputIndex) => ({ region, inputIndex }))
    .sort(compareOrderedRegions)
  const rows: WorkingRow[] = []

  for (const { region } of ordered) {
    const compatible = rows.filter((row) => canExtendRow(row, region))
    // Same ambiguity rule as blocks: a fragment that fits two rows fits none.
    if (compatible.length === 1) appendToRow(compatible[0], region)
    else rows.push({ regions: [region], bounds: region.bounds, text: region.text })
  }

  return rows
}

function canExtendRow(row: WorkingRow, candidate: OcrRegion): boolean {
  const previous = row.bounds
  const next = candidate.bounds
  // Two upright columns of vertical text sit side by side without being one
  // line; a short marker beside a sentence is the case this pass exists for.
  if (isVertical(previous) && isVertical(next)) return false
  if (!hasComparableHeight(previous, next)) return false
  if (verticalOverlapRatio(previous, next) < MIN_VERTICAL_OVERLAP_RATIO) return false

  const reference = Math.max(previous.height, next.height)
  const gap = next.x - right(previous)
  return (
    gap >= -reference * MAX_HORIZONTAL_OVERLAP_LINE_HEIGHTS &&
    gap <= reference * MAX_HORIZONTAL_GAP_LINE_HEIGHTS
  )
}

function appendToRow(row: WorkingRow, region: OcrRegion): void {
  const gap = region.bounds.x - right(row.bounds)
  const reference = Math.max(row.bounds.height, region.bounds.height)
  const separated = gap > reference * SEPARATOR_GAP_LINE_HEIGHTS
  const spaced = /\s$/u.test(row.text) || /^\s/u.test(region.text)
  row.regions.push(region)
  row.bounds = unionBounds([row.bounds, region.bounds])
  row.text = `${row.text}${separated && !spaced ? ' ' : ''}${region.text}`
}

function canAppend(block: WorkingBlock, candidate: WorkingRow): boolean {
  if (!block.extendable) return false
  const previous = block.rows[block.rows.length - 1].bounds
  if (!isHorizontal(previous) || !isHorizontal(candidate.bounds)) return false
  if (!hasSmallNonNegativeGap(previous, candidate.bounds)) return false
  return hasCompatibleHorizontalPlacement(block.rows, candidate.bounds)
}

function isHorizontal(bounds: OcrBounds): boolean {
  return bounds.width > bounds.height * HORIZONTAL_ASPECT_RATIO
}

function isVertical(bounds: OcrBounds): boolean {
  return bounds.height > bounds.width * HORIZONTAL_ASPECT_RATIO
}

function hasComparableHeight(left: OcrBounds, rightBounds: OcrBounds): boolean {
  const taller = Math.max(left.height, rightBounds.height)
  if (taller <= 0) return false
  return Math.min(left.height, rightBounds.height) / taller >= MIN_ROW_HEIGHT_RATIO
}

function verticalOverlapRatio(left: OcrBounds, rightBounds: OcrBounds): number {
  const overlap = Math.max(
    0,
    Math.min(bottom(left), bottom(rightBounds)) - Math.max(left.y, rightBounds.y)
  )
  const shorter = Math.min(left.height, rightBounds.height)
  return shorter > 0 ? overlap / shorter : 0
}

function hasSmallNonNegativeGap(previous: OcrBounds, next: OcrBounds): boolean {
  const gap = next.y - bottom(previous)
  if (gap < 0) return false
  const referenceHeight = Math.min(previous.height, next.height)
  return gap <= referenceHeight * MAX_VERTICAL_GAP_LINE_HEIGHTS
}

/**
 * A block must retain one consistent horizontal relationship with all of its
 * members. This is deliberately stricter than pairwise chaining: a line that
 * touches the left edge of one column and the right edge of another cannot
 * bridge those columns.
 */
function hasCompatibleHorizontalPlacement(
  block: readonly WorkingRow[],
  candidate: OcrBounds
): boolean {
  const tolerance =
    Math.max(...block.map((row) => Math.max(row.bounds.height, candidate.height))) *
    EDGE_ALIGNMENT_TOLERANCE_LINE_HEIGHTS

  const leftAligned = block.every((row) => Math.abs(row.bounds.x - candidate.x) <= tolerance)
  if (leftAligned) return true

  const candidateRight = right(candidate)
  const rightAligned = block.every(
    (row) => Math.abs(right(row.bounds) - candidateRight) <= tolerance
  )
  if (rightAligned) return true

  return block.every(
    (row) => horizontalOverlapRatio(row.bounds, candidate) >= MIN_HORIZONTAL_OVERLAP_RATIO
  )
}

function horizontalOverlapRatio(left: OcrBounds, rightBounds: OcrBounds): number {
  const overlap = Math.max(
    0,
    Math.min(right(left), right(rightBounds)) - Math.max(left.x, rightBounds.x)
  )
  return overlap / Math.max(left.width, rightBounds.width)
}

function createTextBlock(working: WorkingBlock): GameOcrTextBlock {
  const regions = working.rows.flatMap((row) => row.regions)
  const regionIds = regions.map(({ id }) => id)
  return {
    id: `block:${regionIds.join('|')}`,
    regionIds,
    regions,
    lines: working.rows.map((row) => row.text),
    bounds: unionBounds(working.rows.map((row) => row.bounds))
  }
}

function unionBounds(bounds: readonly OcrBounds[]): OcrBounds {
  const left = Math.min(...bounds.map(({ x }) => x))
  const top = Math.min(...bounds.map(({ y }) => y))
  const rightEdge = Math.max(...bounds.map(right))
  const bottomEdge = Math.max(...bounds.map(bottom))
  return { x: left, y: top, width: rightEdge - left, height: bottomEdge - top }
}

function compareOrderedRegions(left: OrderedRegion, right: OrderedRegion): number {
  const comparison = compareRegions(left.region, right.region)
  return comparison !== 0 ? comparison : left.inputIndex - right.inputIndex
}

function compareRegions(left: OcrRegion, right: OcrRegion): number {
  const comparison = compareBounds(left.bounds, right.bounds)
  if (comparison !== 0) return comparison
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
}

function compareBounds(left: OcrBounds, rightBounds: OcrBounds): number {
  const top = compareNumbers(left.y, rightBounds.y)
  if (top !== 0) return top
  return compareNumbers(left.x, rightBounds.x)
}

function right(bounds: OcrBounds): number {
  return bounds.x + bounds.width
}

function bottom(bounds: OcrBounds): number {
  return bounds.y + bounds.height
}

function compareNumbers(left: number, right: number): number {
  return left < right ? -1 : left > right ? 1 : 0
}
