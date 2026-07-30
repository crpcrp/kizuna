import type { VideoDimensions } from '../../../shared/track'

export interface WindowSize {
  width: number
  height: number
}

export function computeVideoWindowSize(
  video: { width: number; height: number },
  scale: number,
  topBarHeight: number,
  bottomBarHeight: number,
  leftSidebarWidth = 0,
  rightSidebarWidth = 0
): WindowSize {
  return {
    width: Math.round(video.width * scale + leftSidebarWidth + rightSidebarWidth),
    height: Math.round(video.height * scale + topBarHeight + bottomBarHeight)
  }
}

export function clampWindowSize(size: WindowSize, maxWidth: number, maxHeight: number): WindowSize {
  if (size.width <= maxWidth && size.height <= maxHeight) return size
  const scale = Math.min(maxWidth / size.width, maxHeight / size.height)
  return { width: Math.round(size.width * scale), height: Math.round(size.height * scale) }
}

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
