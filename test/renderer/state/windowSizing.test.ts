import { describe, expect, it } from 'vitest'
import {
  clampWindowSize,
  computeVideoWindowSize,
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

describe('window-size calculations', () => {
  it('scales video dimensions and adds chrome and panel sizes', () => {
    expect(computeVideoWindowSize({ width: 1920, height: 1080 }, 2, 32, 48, 320, 360)).toEqual({
      width: 4520,
      height: 2240
    })
    expect(computeVideoWindowSize({ width: 853, height: 480 }, 1.5, 0, 0)).toEqual({
      width: 1280,
      height: 720
    })
  })

  it('clamps oversized windows proportionally', () => {
    expect(clampWindowSize({ width: 800, height: 600 }, 1920, 1080)).toEqual({
      width: 800,
      height: 600
    })
    expect(clampWindowSize({ width: 3840, height: 1300 }, 1920, 1080)).toEqual({
      width: 1920,
      height: 650
    })
  })
})
