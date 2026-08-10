import { describe, expect, it } from 'vitest'
import {
  calculateGameOcrLayout,
  type GameOcrLayoutInput,
  type GameOcrLayoutRegion
} from '@src/renderer/src/state/gameOcrLayout'

function region(
  id: string,
  bounds: GameOcrLayoutRegion['bounds'],
  preferredSize: GameOcrLayoutRegion['preferredSize'] = {
    width: bounds.width,
    height: bounds.height
  }
): GameOcrLayoutRegion {
  return { id, bounds, preferredSize }
}

function layout(regions: GameOcrLayoutRegion[], overrides: Partial<GameOcrLayoutInput> = {}) {
  return calculateGameOcrLayout({
    imageSize: { width: 100, height: 100 },
    viewportSize: { width: 100, height: 100 },
    regions,
    ...overrides
  })
}

describe('calculateGameOcrLayout', () => {
  it('maps pixel bounds at one-to-one and non-integer CSS scales', () => {
    expect(
      layout([region('one', { x: 10, y: 20, width: 30, height: 8 })])[0].originalBounds
    ).toEqual({ x: 10, y: 20, width: 30, height: 8 })

    const [scaled] = layout([region('scaled', { x: 10, y: 20, width: 30, height: 8 })], {
      imageSize: { width: 640, height: 360 },
      viewportSize: { width: 853, height: 479 }
    })
    expect(scaled.originalBounds.x).toBeCloseTo(13.328125)
    expect(scaled.originalBounds.y).toBeCloseTo(26.61111111111111)
    expect(scaled.originalBounds.width).toBeCloseTo(39.984375)
    expect(scaled.originalBounds.height).toBeCloseTo(10.644444444444445)
    expect(scaled.displayBounds).toEqual(scaled.originalBounds)
  })

  it('clamps boxes against all viewport edges and keeps oversized input on-screen', () => {
    const results = layout([], {
      regions: [
        region('top-left', { x: -20, y: -10, width: 15, height: 12 }, { width: 30, height: 30 }),
        region('top-right', { x: 95, y: -10, width: 20, height: 12 }, { width: 30, height: 30 }),
        region('bottom-left', { x: -20, y: 95, width: 15, height: 20 }, { width: 30, height: 30 }),
        region('bottom-right', { x: 95, y: 95, width: 20, height: 20 }, { width: 200, height: 200 })
      ]
    })

    expect(results).toHaveLength(4)
    for (const result of results) {
      expect(result.displayBounds.x).toBeGreaterThanOrEqual(0)
      expect(result.displayBounds.y).toBeGreaterThanOrEqual(0)
      expect(result.displayBounds.x + result.displayBounds.width).toBeLessThanOrEqual(100)
      expect(result.displayBounds.y + result.displayBounds.height).toBeLessThanOrEqual(100)
    }
    expect(results.at(-1)?.displayBounds).toEqual({ x: 0, y: 0, width: 100, height: 100 })
  })

  it('adds the minimum gap to adjacent boxes with the smallest translation', () => {
    const results = layout([
      region('first', { x: 0, y: 10, width: 20, height: 12 }),
      region('second', { x: 21, y: 10, width: 20, height: 12 })
    ])

    expect(results[1].displayBounds).toEqual({ x: 24, y: 10, width: 20, height: 12 })
  })

  it('chooses the lower-displacement axis for an overlap', () => {
    const results = layout([
      region('first', { x: 40, y: 40, width: 20, height: 20 }),
      region('second', { x: 50, y: 55, width: 20, height: 20 })
    ])

    expect(results[1].displayBounds).toEqual({ x: 50, y: 64, width: 20, height: 20 })
  })

  it('uses a horizontal translation when it is the smaller valid separation', () => {
    const results = layout([
      region('first', { x: 40, y: 40, width: 20, height: 20 }),
      region('second', { x: 55, y: 50, width: 20, height: 20 })
    ])

    expect(results[1].displayBounds).toEqual({ x: 64, y: 50, width: 20, height: 20 })
  })

  it('resolves chained overlaps without moving an earlier region', () => {
    const results = layout(
      [
        region('a', { x: 0, y: 0, width: 40, height: 20 }),
        region('b', { x: 10, y: 0, width: 40, height: 20 }),
        region('c', { x: 20, y: 0, width: 40, height: 20 })
      ],
      { imageSize: { width: 140, height: 20 }, viewportSize: { width: 140, height: 20 } }
    )

    expect(results.map(({ id }) => id)).toEqual(['a', 'b', 'c'])
    expect(results.map(({ displayBounds }) => displayBounds.x)).toEqual([0, 44, 88])
    expect(results[0].displayBounds).toEqual({ x: 0, y: 0, width: 40, height: 20 })
  })

  it('uses the measured multiline size while retaining the source position', () => {
    const [result] = layout([
      region('multiline', { x: 12, y: 18, width: 20, height: 8 }, { width: 64, height: 42 })
    ])

    expect(result.originalBounds).toEqual({ x: 12, y: 18, width: 20, height: 8 })
    expect(result.displayBounds).toEqual({ x: 12, y: 18, width: 64, height: 42 })
  })

  it('sorts by original top, left, then region ID independent of input order', () => {
    const results = layout([
      region('z', { x: 20, y: 20, width: 5, height: 5 }),
      region('b', { x: 10, y: 10, width: 5, height: 5 }),
      region('a', { x: 10, y: 10, width: 5, height: 5 }),
      region('top', { x: 90, y: 0, width: 5, height: 5 })
    ])

    expect(results.map(({ id }) => id)).toEqual(['top', 'a', 'b', 'z'])
  })

  it('retains dense impossible layouts and terminates with bounded boxes', () => {
    const regions = Array.from({ length: 200 }, (_, index) =>
      region(`region-${index}`, { x: 0, y: 0, width: 100, height: 100 })
    )
    const results = layout(regions, { viewportSize: { width: 40, height: 30 } })

    expect(results).toHaveLength(regions.length)
    expect(
      results.every(({ displayBounds }) => displayBounds.x === 0 && displayBounds.y === 0)
    ).toBe(true)
    expect(
      results.every(
        ({ displayBounds }) => displayBounds.width === 40 && displayBounds.height === 30
      )
    ).toBe(true)
  })
})
