import { describe, expect, it } from 'vitest'
import {
  sidebarPreservingWindowSize,
  videoContentBaseline,
  videoScaleWindowSize
} from '@src/renderer/src/state/windowSizing'

describe('windowSizing', () => {
  it('requires video dimensions for a scale preset', () => {
    expect(
      videoScaleWindowSize(undefined, 1, 32, 48, { width: 1920, height: 1080 })
    ).toBeUndefined()
  })

  it('includes bars and open side panels in the target size', () => {
    expect(
      videoScaleWindowSize(
        { width: 640, height: 360 },
        1,
        32,
        48,
        { width: 1920, height: 1080 },
        300,
        340
      )
    ).toEqual({ width: 1280, height: 440 })
  })

  it('clamps oversized scale targets to the screen', () => {
    expect(
      videoScaleWindowSize(
        { width: 1600, height: 900 },
        1,
        0,
        0,
        { width: 1920, height: 1080 },
        200,
        200
      )
    ).toEqual({ width: 1920, height: 864 })
  })

  it('measures the video baseline by subtracting open panels', () => {
    expect(videoContentBaseline({ width: 1280, height: 720 }, 320, 360)).toEqual({
      width: 600,
      height: 720
    })
    expect(videoContentBaseline({ width: 300, height: 720 }, 320, 360)).toEqual({
      width: 0,
      height: 720
    })
  })

  it('restores panel widths on top of a measured baseline', () => {
    expect(
      sidebarPreservingWindowSize(
        { width: 1280, height: 720 },
        { width: 2560, height: 1440 },
        320,
        360
      )
    ).toEqual({ width: 1960, height: 720 })
  })

  it('rejects missing or degenerate baselines and clamps oversized results', () => {
    const screen = { width: 2560, height: 1440 }
    expect(sidebarPreservingWindowSize(undefined, screen, 320)).toBeUndefined()
    expect(sidebarPreservingWindowSize({ width: 0, height: 720 }, screen, 320)).toBeUndefined()
    expect(sidebarPreservingWindowSize({ width: 2560, height: 720 }, screen, 360)).toEqual({
      width: 2560,
      height: 631
    })
  })
})
