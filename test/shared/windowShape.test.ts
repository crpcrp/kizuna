import { describe, expect, it } from 'vitest'
import { normalizeWindowShapeRects } from '@src/shared/windowShape'

describe('normalizeWindowShapeRects', () => {
  it('rounds outward and clips rectangles to the window', () => {
    expect(
      normalizeWindowShapeRects(
        [
          { x: -4.2, y: 3.8, width: 20.5, height: 10.1 },
          { x: 95, y: 45, width: 20, height: 20 }
        ],
        100,
        50
      )
    ).toEqual([
      { x: 0, y: 3, width: 17, height: 11 },
      { x: 95, y: 45, width: 5, height: 5 }
    ])
  })

  it('drops rectangles wholly outside the window', () => {
    expect(normalizeWindowShapeRects([{ x: 200, y: 200, width: 10, height: 10 }], 100, 50)).toEqual(
      []
    )
  })

  it('rejects malformed, non-finite, negative, or excessive payloads', () => {
    expect(normalizeWindowShapeRects('nope', 100, 50)).toBeNull()
    expect(
      normalizeWindowShapeRects([{ x: 0, y: 0, width: Number.NaN, height: 1 }], 100, 50)
    ).toBeNull()
    expect(normalizeWindowShapeRects([{ x: 0, y: 0, width: -1, height: 1 }], 100, 50)).toBeNull()
    expect(
      normalizeWindowShapeRects(
        Array.from({ length: 513 }, () => ({ x: 0, y: 0, width: 1, height: 1 })),
        100,
        50
      )
    ).toBeNull()
  })
})
