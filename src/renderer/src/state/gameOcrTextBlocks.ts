import type { OcrBounds, OcrRegion } from '../../../shared/ocr'

/** One deterministic group of line-level OCR regions. */
export interface GameOcrTextBlock {
  /** Stable within a capture, derived from the ordered member IDs. */
  readonly id: string
  readonly regionIds: readonly string[]
  /** Source regions in top-to-bottom, left-to-right reading order. */
  readonly regions: readonly OcrRegion[]
  /** The source text for each member, in the same order as `regions`. */
  readonly lines: readonly string[]
  /** Exact captured-image union of all member bounds. */
  readonly bounds: OcrBounds
}

interface WorkingBlock {
  regions: OcrRegion[]
  extendable: boolean
}

interface OrderedRegion {
  region: OcrRegion
  inputIndex: number
}

/**
 * Lines need to be wider than tall to be eligible for horizontal grouping.
 * This leaves vertical text as a one-member block.
 */
const HORIZONTAL_ASPECT_RATIO = 1.5

/** A visibly separated row should remain its own readable replacement box. */
const MAX_VERTICAL_GAP_LINE_HEIGHTS = 0.5

/** Require substantial overlap when neither paragraph edge is aligned. */
const MIN_HORIZONTAL_OVERLAP_RATIO = 0.5

/** Edge alignment is relative to the detected line height, not the screen. */
const EDGE_ALIGNMENT_TOLERANCE_LINE_HEIGHTS = 1

/**
 * Groups one capture's line-level OCR regions using a conservative,
 * resolution-independent geometry heuristic. No input region is modified.
 */
export function groupGameOcrTextBlocks(regions: readonly OcrRegion[]): GameOcrTextBlock[] {
  const ordered = regions
    .map((region, inputIndex) => ({ region, inputIndex }))
    .sort(compareOrderedRegions)
  const blocks: WorkingBlock[] = []

  for (const candidate of ordered) {
    const compatible = blocks.filter((block) => canAppend(block, candidate.region))

    // A line that could attach to more than one existing block is ambiguous:
    // keeping it alone prevents an unusually wide line from bridging columns.
    if (compatible.length === 1) {
      compatible[0].regions.push(candidate.region)
    } else {
      blocks.push({ regions: [candidate.region], extendable: compatible.length === 0 })
    }
  }

  return blocks
    .sort((left, right) => compareRegions(left.regions[0], right.regions[0]))
    .map(createTextBlock)
}

function canAppend(block: WorkingBlock, candidate: OcrRegion): boolean {
  if (!block.extendable) return false
  const previous = block.regions[block.regions.length - 1]
  if (!isHorizontal(previous) || !isHorizontal(candidate)) return false
  if (!hasSmallNonNegativeGap(previous.bounds, candidate.bounds)) return false
  return hasCompatibleHorizontalPlacement(block.regions, candidate)
}

function isHorizontal(region: OcrRegion): boolean {
  return region.bounds.width > region.bounds.height * HORIZONTAL_ASPECT_RATIO
}

function hasSmallNonNegativeGap(previous: OcrBounds, next: OcrBounds): boolean {
  const gap = next.y - (previous.y + previous.height)
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
  block: readonly OcrRegion[],
  candidate: OcrRegion
): boolean {
  const tolerance =
    Math.max(...block.map((region) => Math.max(region.bounds.height, candidate.bounds.height))) *
    EDGE_ALIGNMENT_TOLERANCE_LINE_HEIGHTS

  const leftAligned = block.every(
    (region) => Math.abs(region.bounds.x - candidate.bounds.x) <= tolerance
  )
  if (leftAligned) return true

  const candidateRight = right(candidate.bounds)
  const rightAligned = block.every(
    (region) => Math.abs(right(region.bounds) - candidateRight) <= tolerance
  )
  if (rightAligned) return true

  return block.every(
    (region) =>
      horizontalOverlapRatio(region.bounds, candidate.bounds) >= MIN_HORIZONTAL_OVERLAP_RATIO
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
  const regions = working.regions
  const regionIds = regions.map(({ id }) => id)
  return {
    id: `block:${regionIds.join('|')}`,
    regionIds,
    regions,
    lines: regions.map(({ text }) => text),
    bounds: unionBounds(regions)
  }
}

function unionBounds(regions: readonly OcrRegion[]): OcrBounds {
  const left = Math.min(...regions.map(({ bounds }) => bounds.x))
  const top = Math.min(...regions.map(({ bounds }) => bounds.y))
  const rightEdge = Math.max(...regions.map(({ bounds }) => right(bounds)))
  const bottom = Math.max(...regions.map(({ bounds }) => bounds.y + bounds.height))
  return { x: left, y: top, width: rightEdge - left, height: bottom - top }
}

function compareOrderedRegions(left: OrderedRegion, right: OrderedRegion): number {
  const comparison = compareRegions(left.region, right.region)
  return comparison !== 0 ? comparison : left.inputIndex - right.inputIndex
}

function compareRegions(left: OcrRegion, right: OcrRegion): number {
  const top = compareNumbers(left.bounds.y, right.bounds.y)
  if (top !== 0) return top
  const horizontal = compareNumbers(left.bounds.x, right.bounds.x)
  if (horizontal !== 0) return horizontal
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
}

function right(bounds: OcrBounds): number {
  return bounds.x + bounds.width
}

function compareNumbers(left: number, right: number): number {
  return left < right ? -1 : left > right ? 1 : 0
}
