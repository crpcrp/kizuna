import { useEffect } from 'react'
import { computeVideoMargins } from '../util/uiHelpers'
import type { BulkMiningPresentation } from './bulkMiningPresentation'

export interface VideoMarginsPlayer {
  setVideoMargins: (top: number, bottom: number, right?: number, left?: number) => Promise<unknown>
}

export interface UseVideoMarginsInput {
  topBarRef: React.RefObject<HTMLElement | null>
  bottomBarRef: React.RefObject<HTMLElement | null>
  rightSidebarStackRef: React.RefObject<HTMLElement | null>
  leftSidebarStackRef: React.RefObject<HTMLElement | null>
  fullscreen: boolean
  sidebarOpen: boolean
  playlistOpen: boolean
  miningPresentation: BulkMiningPresentation
  miniPlayerActive: boolean
  player: VideoMarginsPlayer
}

/**
 * Keeps the mpv video frame out from under the top/bottom bars and, when open,
 * the subtitle sidebar by setting mpv's measured video margins.
 */
export function useVideoMargins({
  topBarRef,
  bottomBarRef,
  rightSidebarStackRef,
  leftSidebarStackRef,
  fullscreen,
  sidebarOpen,
  playlistOpen,
  miningPresentation,
  miniPlayerActive,
  player
}: UseVideoMarginsInput): void {
  // Keeps the mpv video frame out from under the top/bottom bars (and, when
  // open, the subtitle sidebar) in windowed mode by setting mpv's own video
  // margins to their measured heights/width. In fullscreen and mini-player
  // mode the compact chrome floats over the video instead, so margins go to
  // 0 and the embedded mpv viewport keeps the full mini window dimensions.
  useEffect(() => {
    const recompute = (): void => {
      const topHeight = topBarRef.current?.offsetHeight ?? 0
      const bottomHeight = bottomBarRef.current?.offsetHeight ?? 0
      const sidebarWidth = rightSidebarStackRef.current?.offsetWidth ?? 0
      const leftWidth = leftSidebarStackRef.current?.offsetWidth ?? 0
      const margins = computeVideoMargins(
        topHeight,
        bottomHeight,
        window.innerHeight,
        fullscreen || miniPlayerActive,
        sidebarWidth,
        window.innerWidth,
        leftWidth
      )
      void player.setVideoMargins(margins.top, margins.bottom, margins.right, margins.left)
    }
    recompute()
    const observer = new ResizeObserver(recompute)
    if (topBarRef.current) observer.observe(topBarRef.current)
    if (bottomBarRef.current) observer.observe(bottomBarRef.current)
    if (rightSidebarStackRef.current) observer.observe(rightSidebarStackRef.current)
    if (leftSidebarStackRef.current) observer.observe(leftSidebarStackRef.current)
    window.addEventListener('resize', recompute)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', recompute)
    }
  }, [
    topBarRef,
    bottomBarRef,
    rightSidebarStackRef,
    leftSidebarStackRef,
    fullscreen,
    sidebarOpen,
    playlistOpen,
    miningPresentation,
    miniPlayerActive,
    player
  ])
}
