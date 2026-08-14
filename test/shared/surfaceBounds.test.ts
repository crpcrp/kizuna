import { describe, expect, it } from 'vitest'
import {
  centeredSurfaceBounds,
  SPLASH_SURFACE_HEIGHT,
  SPLASH_SURFACE_WIDTH
} from '@src/shared/surfaceBounds'

describe('centeredSurfaceBounds', () => {
  it('centers the compact splash on a secondary display', () => {
    expect(centeredSurfaceBounds({ x: -1920, y: 40, width: 1920, height: 1040 })).toEqual({
      x: -1280,
      y: 360,
      width: SPLASH_SURFACE_WIDTH,
      height: SPLASH_SURFACE_HEIGHT
    })
  })

  it('clips the surface to a small work area', () => {
    expect(centeredSurfaceBounds({ x: 100, y: 80, width: 420, height: 260 })).toEqual({
      x: 100,
      y: 80,
      width: 420,
      height: 260
    })
  })
})
