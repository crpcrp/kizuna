import { describe, it, expect } from 'vitest'
import {
  MINI_PLAYER_VIDEO_HEIGHT,
  MINI_PLAYER_WIDTH,
  isWindowBounds,
  miniPlayerBounds,
  type WindowBounds
} from '@src/shared/windowBounds'

describe('miniPlayerBounds', () => {
  const workArea: WindowBounds = { x: 0, y: 0, width: 1920, height: 1040 }

  it('flushes a 480×(270+bar) window to the work area bottom-right corner', () => {
    const bounds = miniPlayerBounds(workArea, 32, 60)
    expect(bounds.width).toBe(MINI_PLAYER_WIDTH)
    expect(bounds.height).toBe(MINI_PLAYER_VIDEO_HEIGHT + 32 + 60)
    // right edge and bottom edge align with the work area's far corner.
    expect(bounds.x + bounds.width).toBe(workArea.x + workArea.width)
    expect(bounds.y + bounds.height).toBe(workArea.y + workArea.height)
  })

  it('offsets by the work area origin (taskbar-inset / non-zero corner)', () => {
    const inset: WindowBounds = { x: 100, y: 50, width: 1280, height: 700 }
    const bounds = miniPlayerBounds(inset, 32, 40)
    expect(bounds).toEqual({
      x: 100 + 1280 - MINI_PLAYER_WIDTH,
      y: 50 + 700 - (MINI_PLAYER_VIDEO_HEIGHT + 32 + 40),
      width: MINI_PLAYER_WIDTH,
      height: MINI_PLAYER_VIDEO_HEIGHT + 32 + 40
    })
  })

  it('clamps a non-finite or negative bar height to zero', () => {
    expect(miniPlayerBounds(workArea, Number.NaN, Number.NEGATIVE_INFINITY).height).toBe(
      MINI_PLAYER_VIDEO_HEIGHT
    )
    expect(miniPlayerBounds(workArea, -20, -1).height).toBe(MINI_PLAYER_VIDEO_HEIGHT)
  })

  it('rounds a fractional bar height and origin', () => {
    const bounds = miniPlayerBounds({ x: 0.4, y: 0.6, width: 1000, height: 800 }, 32.2, 60.7)
    expect(bounds.height).toBe(MINI_PLAYER_VIDEO_HEIGHT + 32 + 61)
    expect(Number.isInteger(bounds.x)).toBe(true)
    expect(Number.isInteger(bounds.y)).toBe(true)
  })
})

describe('isWindowBounds', () => {
  it('accepts a well-formed rectangle', () => {
    expect(isWindowBounds({ x: 1, y: 2, width: 3, height: 4 })).toBe(true)
  })

  it('rejects missing keys, non-numbers, and non-finite values', () => {
    expect(isWindowBounds({ x: 1, y: 2, width: 3 })).toBe(false)
    expect(isWindowBounds({ x: 1, y: 2, width: 3, height: '4' })).toBe(false)
    expect(isWindowBounds({ x: 1, y: 2, width: 3, height: Number.NaN })).toBe(false)
    expect(isWindowBounds(null)).toBe(false)
    expect(isWindowBounds('nope')).toBe(false)
  })
})
