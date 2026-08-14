import { describe, expect, it } from 'vitest'
import {
  APPLICATION_SURFACE_HEIGHT,
  APPLICATION_SURFACE_WIDTH,
  centeredSurfaceBounds,
  normalSurfaceBounds,
  SPLASH_SURFACE_HEIGHT,
  SPLASH_SURFACE_WIDTH
} from '@src/shared/surfaceBounds'

describe('centeredSurfaceBounds', () => {
  it('centers the compact splash on a secondary display', () => {
    expect(centeredSurfaceBounds({ x: -1920, y: 40, width: 1920, height: 1040 })).toEqual({
      x: -1280,
      y: 380,
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

  it('centers and clips the normal application surface', () => {
    expect(normalSurfaceBounds({ x: -900, y: 20, width: 900, height: 500 })).toEqual({
      x: -900,
      y: 20,
      width: 900,
      height: 500
    })
    expect(normalSurfaceBounds({ x: -1920, y: 40, width: 1920, height: 1040 })).toEqual({
      x: -1600,
      y: 200,
      width: APPLICATION_SURFACE_WIDTH,
      height: APPLICATION_SURFACE_HEIGHT
    })
  })
})
