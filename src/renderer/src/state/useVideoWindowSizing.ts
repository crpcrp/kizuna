import { useEffect, useRef, useState, type RefObject } from 'react'
import type { VideoDimensions } from '../../../shared/track'
import { useLatestCallback } from './useLatestRef'
import {
  sidebarPreservingWindowSize,
  videoContentBaseline,
  videoScaleWindowSize,
  type VideoContentBaseline
} from './windowSizing'

export interface UseVideoWindowSizingInput {
  topBarRef: RefObject<HTMLDivElement | null>
  bottomBarRef: RefObject<HTMLDivElement | null>
  leftSidebarStackRef: RefObject<HTMLElement | null>
  rightSidebarStackRef: RefObject<HTMLElement | null>
  videoDimensions: VideoDimensions | undefined
  fullscreen: boolean
  miniPlayerActive: boolean
  settingsReady: boolean
  sidebarOpen: boolean
  playlistOpen: boolean
  setWindowSize(width: number, height: number): void
}

export interface UseVideoWindowSizingResult {
  onSetVideoScale(scale: number): void
}

/** Owns the stateful lifecycle around the pure window-sizing calculations. */
export function useVideoWindowSizing({
  topBarRef,
  bottomBarRef,
  leftSidebarStackRef,
  rightSidebarStackRef,
  videoDimensions,
  fullscreen,
  miniPlayerActive,
  settingsReady,
  sidebarOpen,
  playlistOpen,
  setWindowSize
}: UseVideoWindowSizingInput): UseVideoWindowSizingResult {
  // The last size preset the user explicitly picked from Video ▸ Size, kept so
  // opening/closing a side panel can re-apply it. Undefined means the default
  // size is preserved through videoContentBaselineRef instead.
  const [requestedVideoScale, setRequestedVideoScale] = useState<number | undefined>(undefined)
  // The video rectangle a side-panel toggle has to preserve while no preset is
  // in play — the window content box minus the panels open when it was measured.
  // Re-measured whenever the window itself resizes, never during a panel
  // transition, so it describes the picture the user is currently looking at.
  const videoContentBaselineRef = useRef<VideoContentBaseline | undefined>(undefined)

  // Resizes the app window so the video renders at `scale` × its native
  // resolution, clamped to the display's available area. The open side panels
  // are measured from the same refs useVideoMargins observes.
  const applyVideoScale = useLatestCallback((scale: number): void => {
    const size = videoScaleWindowSize(
      videoDimensions,
      scale,
      topBarRef.current?.offsetHeight ?? 0,
      bottomBarRef.current?.offsetHeight ?? 0,
      { width: window.screen.availWidth, height: window.screen.availHeight },
      leftSidebarStackRef.current?.offsetWidth ?? 0,
      rightSidebarStackRef.current?.offsetWidth ?? 0
    )
    if (size) setWindowSize(size.width, size.height)
  })

  const onSetVideoScale = (scale: number): void => {
    setRequestedVideoScale(scale)
    // Applied here as well as from the effect below: re-picking the preset
    // that is already remembered leaves the state untouched, and the user
    // still expects a resize after a manual window resize.
    applyVideoScale(scale)
  }

  // Re-measures the preservation baseline from the window as it stands now.
  // Only ever called outside a panel transition: mid-transition the panels are
  // already laid out while the window still has its old size.
  const captureVideoContentBaseline = useLatestCallback((): void => {
    videoContentBaselineRef.current = videoContentBaseline(
      { width: window.innerWidth, height: window.innerHeight },
      leftSidebarStackRef.current?.offsetWidth ?? 0,
      rightSidebarStackRef.current?.offsetWidth ?? 0
    )
  })

  // Resizes the window so the video keeps the dimensions it had before a panel
  // transition, for the default/unmodified size (no preset picked).
  const applySidebarSizeCompensation = useLatestCallback((): void => {
    if (fullscreen || miniPlayerActive || !videoDimensions) return
    const size = sidebarPreservingWindowSize(
      videoContentBaselineRef.current,
      { width: window.screen.availWidth, height: window.screen.availHeight },
      leftSidebarStackRef.current?.offsetWidth ?? 0,
      rightSidebarStackRef.current?.offsetWidth ?? 0
    )
    if (size) setWindowSize(size.width, size.height)
  })

  // Keeps the baseline current between panel transitions. Window resizing — by
  // the user, a preset, or compensation — is the only thing that changes the
  // video rectangle, so resize is the right place to re-measure it.
  useEffect(() => {
    if (fullscreen || miniPlayerActive) return
    captureVideoContentBaseline()
    const onResize = (): void => captureVideoContentBaseline()
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [fullscreen, miniPlayerActive, settingsReady, videoDimensions, captureVideoContentBaseline])

  // True once the restored panel layout has been observed, so panels reopened
  // at startup establish the baseline instead of triggering compensation.
  const panelLayoutObservedRef = useRef(false)

  // Keeps the visible video the same size across panel toggles. Runs
  // post-commit, so the sidebar refs measure the panel's real width.
  useEffect(() => {
    if (requestedVideoScale !== undefined) {
      applyVideoScale(requestedVideoScale)
      return
    }
    if (!settingsReady) return
    if (!panelLayoutObservedRef.current) {
      panelLayoutObservedRef.current = true
      return
    }
    applySidebarSizeCompensation()
  }, [
    settingsReady,
    sidebarOpen,
    playlistOpen,
    requestedVideoScale,
    applyVideoScale,
    applySidebarSizeCompensation
  ])

  return { onSetVideoScale }
}
