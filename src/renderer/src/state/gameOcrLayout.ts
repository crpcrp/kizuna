import type { OcrBounds, OcrImageSize } from '../../../shared/ocr'

export interface GameOcrLayoutSize {
  width: number
  height: number
}

export interface GameOcrLayoutRegion {
  id: string
  bounds: OcrBounds
  preferredSize: GameOcrLayoutSize
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

const MIN_BOX_GAP = 4
const MAX_LAYOUT_PASSES = 32

/**
 * Converts OCR pixels into viewport CSS coordinates and places every text box
 * in deterministic reading order. The OCR rectangle supplies the position
 * and minimum size; the measured size lets multiline replacement text grow
 * without being placed outside the frozen viewport.
 */
export function calculateGameOcrLayout(input: GameOcrLayoutInput): GameOcrLayoutResult[] {
  const viewport = {
    width: nonNegativeFinite(input.viewportSize.width),
    height: nonNegativeFinite(input.viewportSize.height)
  }
  const scaleX = scaleFor(input.imageSize.width, viewport.width)
  const scaleY = scaleFor(input.imageSize.height, viewport.height)

  const pending = input.regions.map((region, index) => {
    const originalBounds = toCssBounds(region.bounds, scaleX, scaleY)
    const width = Math.min(
      viewport.width,
      Math.max(originalBounds.width, nonNegativeFinite(region.preferredSize.width))
    )
    const height = Math.min(
      viewport.height,
      Math.max(originalBounds.height, nonNegativeFinite(region.preferredSize.height))
    )

    return {
      id: region.id,
      originalBounds,
      box: clampBox(
        {
          x: originalBounds.x,
          y: originalBounds.y,
          width,
          height
        },
        viewport
      ),
      index
    }
  })

  pending.sort((left, right) => {
    const top = compareNumbers(left.originalBounds.y, right.originalBounds.y)
    if (top !== 0) return top
    const horizontal = compareNumbers(left.originalBounds.x, right.originalBounds.x)
    if (horizontal !== 0) return horizontal
    const id = left.id < right.id ? -1 : left.id > right.id ? 1 : 0
    return id !== 0 ? id : left.index - right.index
  })

  const placed: GameOcrLayoutBounds[] = []
  return pending.map(({ id, originalBounds, box }) => {
    const displayBounds = resolveCollisions(box, placed, viewport)
    placed.push(displayBounds)
    return { id, originalBounds, displayBounds }
  })
}

function toCssBounds(bounds: OcrBounds, scaleX: number, scaleY: number): GameOcrLayoutBounds {
  return {
    x: scaledFinite(bounds.x, scaleX),
    y: scaledFinite(bounds.y, scaleY),
    width: Math.max(0, scaledFinite(bounds.width, scaleX)),
    height: Math.max(0, scaledFinite(bounds.height, scaleY))
  }
}

function resolveCollisions(
  initial: GameOcrLayoutBounds,
  placed: GameOcrLayoutBounds[],
  viewport: GameOcrLayoutSize
): GameOcrLayoutBounds {
  let current = initial

  for (let pass = 0; pass < MAX_LAYOUT_PASSES; pass++) {
    const colliders = placed.filter((other) => needsGap(current, other))
    if (colliders.length === 0) return current

    const candidates: PlacementCandidate[] = [
      { axis: 'none', bounds: current },
      ...colliders.flatMap((other) => candidatesAround(current, other, viewport))
    ]
    const best = candidates.reduce((selected, candidate) =>
      isBetterCandidate(candidate, selected, current, placed) ? candidate : selected
    )

    if (samePosition(best.bounds, current)) return current
    current = clampBox(best.bounds, viewport)
  }

  return current
}

type PlacementAxis = 'none' | 'x' | 'y'

interface PlacementCandidate {
  axis: PlacementAxis
  bounds: GameOcrLayoutBounds
}

function candidatesAround(
  current: GameOcrLayoutBounds,
  other: GameOcrLayoutBounds,
  viewport: GameOcrLayoutSize
): PlacementCandidate[] {
  const candidates: PlacementCandidate[] = []
  if (intervalsWithinGap(current.y, bottom(current), other.y, bottom(other))) {
    candidates.push(
      {
        axis: 'x',
        bounds: clampBox({ ...current, x: other.x - current.width - MIN_BOX_GAP }, viewport)
      },
      {
        axis: 'x',
        bounds: clampBox({ ...current, x: other.x + other.width + MIN_BOX_GAP }, viewport)
      }
    )
  }
  if (intervalsWithinGap(current.x, right(current), other.x, right(other))) {
    candidates.push(
      {
        axis: 'y',
        bounds: clampBox({ ...current, y: other.y - current.height - MIN_BOX_GAP }, viewport)
      },
      {
        axis: 'y',
        bounds: clampBox({ ...current, y: other.y + other.height + MIN_BOX_GAP }, viewport)
      }
    )
  }
  return candidates
}

function isBetterCandidate(
  candidate: PlacementCandidate,
  selected: PlacementCandidate,
  origin: GameOcrLayoutBounds,
  placed: GameOcrLayoutBounds[]
): boolean {
  const candidateScore = score(candidate, origin, placed)
  const selectedScore = score(selected, origin, placed)
  if (candidateScore.collisions !== selectedScore.collisions) {
    return candidateScore.collisions < selectedScore.collisions
  }
  if (candidateScore.penetration !== selectedScore.penetration) {
    return candidateScore.penetration < selectedScore.penetration
  }
  if (candidateScore.displacement !== selectedScore.displacement) {
    return candidateScore.displacement < selectedScore.displacement
  }
  return axisRank(candidate.axis) < axisRank(selected.axis)
}

function score(
  candidate: PlacementCandidate,
  origin: GameOcrLayoutBounds,
  placed: GameOcrLayoutBounds[]
) {
  let collisions = 0
  let penetration = 0
  for (const other of placed) {
    if (needsGap(candidate.bounds, other)) collisions++
    penetration += gapPenetration(candidate.bounds, other)
  }
  return {
    collisions,
    penetration,
    displacement: Math.abs(candidate.bounds.x - origin.x) + Math.abs(candidate.bounds.y - origin.y),
    axis: candidate.axis
  }
}

function gapPenetration(left: GameOcrLayoutBounds, rightBox: GameOcrLayoutBounds): number {
  const horizontal = Math.max(
    0,
    Math.min(right(left), right(rightBox)) - Math.max(left.x, rightBox.x) + MIN_BOX_GAP
  )
  const vertical = Math.max(
    0,
    Math.min(bottom(left), bottom(rightBox)) - Math.max(left.y, rightBox.y) + MIN_BOX_GAP
  )
  return horizontal * vertical
}

function needsGap(left: GameOcrLayoutBounds, rightBox: GameOcrLayoutBounds): boolean {
  return !(
    right(left) + MIN_BOX_GAP <= rightBox.x ||
    right(rightBox) + MIN_BOX_GAP <= left.x ||
    bottom(left) + MIN_BOX_GAP <= rightBox.y ||
    bottom(rightBox) + MIN_BOX_GAP <= left.y
  )
}

function intervalsWithinGap(
  firstStart: number,
  firstEnd: number,
  secondStart: number,
  secondEnd: number
): boolean {
  return firstStart < secondEnd + MIN_BOX_GAP && firstEnd + MIN_BOX_GAP > secondStart
}

function clampBox(box: GameOcrLayoutBounds, viewport: GameOcrLayoutSize): GameOcrLayoutBounds {
  const width = Math.min(viewport.width, Math.max(0, nonNegativeFinite(box.width)))
  const height = Math.min(viewport.height, Math.max(0, nonNegativeFinite(box.height)))
  return {
    x: clamp(nonNegativeOrZero(box.x), 0, Math.max(0, viewport.width - width)),
    y: clamp(nonNegativeOrZero(box.y), 0, Math.max(0, viewport.height - height)),
    width,
    height
  }
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

function nonNegativeOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum)
}

function right(bounds: GameOcrLayoutBounds): number {
  return bounds.x + bounds.width
}

function bottom(bounds: GameOcrLayoutBounds): number {
  return bounds.y + bounds.height
}

function samePosition(left: GameOcrLayoutBounds, rightBox: GameOcrLayoutBounds): boolean {
  return left.x === rightBox.x && left.y === rightBox.y
}

function compareNumbers(left: number, rightValue: number): number {
  return left < rightValue ? -1 : left > rightValue ? 1 : 0
}

function axisRank(axis: PlacementAxis): number {
  return axis === 'x' ? 0 : axis === 'y' ? 1 : 2
}
