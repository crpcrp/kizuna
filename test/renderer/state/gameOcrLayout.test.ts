import { describe, expect, it } from 'vitest'
import {
  calculateGameOcrLayout,
  type GameOcrLayoutInput,
  type GameOcrLayoutRegion
} from '@src/renderer/src/state/gameOcrLayout'

function region(id: string, bounds: GameOcrLayoutRegion['bounds']): GameOcrLayoutRegion {
  return { id, bounds }
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
      layout([region('one', { x: 10, y: 20, width: 30, height: 8 })])[0].displayBounds
    ).toEqual({ x: 10, y: 20, width: 30, height: 8 })

    const [scaled] = layout([region('scaled', { x: 10, y: 20, width: 30, height: 8 })], {
      imageSize: { width: 640, height: 360 },
      viewportSize: { width: 853, height: 479 }
    })
    expect(scaled.displayBounds.x).toBeCloseTo(13.328125)
    expect(scaled.displayBounds.y).toBeCloseTo(26.61111111111111)
    expect(scaled.displayBounds.width).toBeCloseTo(39.984375)
    expect(scaled.displayBounds.height).toBeCloseTo(10.644444444444445)
    expect(scaled.displayBounds).toEqual(scaled.originalBounds)
  })

  it('clips edge overflow without translating a box away from its detected pixels', () => {
    const results = layout([
      region('top-left', { x: -5, y: -4, width: 15, height: 12 }),
      region('bottom-right', { x: 95, y: 96, width: 20, height: 20 })
    ])

    expect(results[0].displayBounds).toEqual({ x: 0, y: 0, width: 10, height: 8 })
    expect(results[1].displayBounds).toEqual({ x: 95, y: 96, width: 5, height: 4 })
  })

  it('preserves overlapping and adjacent detector rectangles exactly', () => {
    const results = layout([
      region('first', { x: 10, y: 10, width: 20, height: 12 }),
      region('second', { x: 21, y: 10, width: 20, height: 12 })
    ])

    expect(results.map(({ displayBounds }) => displayBounds)).toEqual([
      { x: 10, y: 10, width: 20, height: 12 },
      { x: 21, y: 10, width: 20, height: 12 }
    ])
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
})
