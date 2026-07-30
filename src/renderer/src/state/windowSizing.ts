import type { VideoDimensions } from '../../../shared/track'
import { clampWindowSize, computeVideoWindowSize, type WindowSize } from '../util/uiHelpers'

export interface VideoContentBaseline {
  width: number
  height: number
}

export function videoScaleWindowSize(
  videoDimensions: VideoDimensions | undefined,
  scale: number,
  topBarHeight: number,
  bottomBarHeight: number,
  screenSize: WindowSize,
  leftSidebarWidth = 0,
  rightSidebarWidth = 0
): WindowSize | undefined {
  if (!videoDimensions) return undefined
  const size = computeVideoWindowSize(
    videoDimensions,
    scale,
    topBarHeight,
    bottomBarHeight,
    leftSidebarWidth,
    rightSidebarWidth
  )
  return clampWindowSize(size, screenSize.width, screenSize.height)
}

export function videoContentBaseline(
  windowSize: WindowSize,
  leftSidebarWidth = 0,
  rightSidebarWidth = 0
): VideoContentBaseline {
  return {
    width: Math.max(0, Math.round(windowSize.width - leftSidebarWidth - rightSidebarWidth)),
    height: Math.max(0, Math.round(windowSize.height))
  }
}

export function sidebarPreservingWindowSize(
  baseline: VideoContentBaseline | undefined,
  screenSize: WindowSize,
  leftSidebarWidth = 0,
  rightSidebarWidth = 0
): WindowSize | undefined {
  if (!baseline || baseline.width <= 0 || baseline.height <= 0) return undefined
  return clampWindowSize(
    {
      width: Math.round(baseline.width + leftSidebarWidth + rightSidebarWidth),
      height: baseline.height
    },
    screenSize.width,
    screenSize.height
  )
}
