import type { WindowBounds } from '../shared/windowBounds'
import { centeredSurfaceBounds, normalSurfaceBounds } from '../shared/surfaceBounds'
import type { AppWindowSet } from './windowPair'
import type { ScreenLike } from './windowOptions'

type SurfaceWindows = Pick<AppWindowSet, 'videoHost' | 'uiOverlay' | 'coordinator'>

export interface SurfacePresentation {
  /** Makes the splash compact, then presents the renderer-owned surface. */
  presentSplash(presentOverlay: () => void | Promise<void>): Promise<void>
  /** Restores normal application bounds, then presents standalone Options. */
  presentOptions(presentOverlay: () => void | Promise<void>): Promise<void>
  /** Restores the saved player rectangle before the host is mapped. */
  restorePlayerBounds(): void
}

/**
 * Owns the native geometry that differs between the splash and player
 * surfaces. The renderer only chooses content; this helper sizes the native
 * window before it is shown and keeps the player's windowed rectangle intact.
 */
export function createSurfacePresentation(
  windows: SurfaceWindows,
  screen: ScreenLike
): SurfacePresentation {
  let playerBounds: WindowBounds | undefined
  let splashPresented = false

  const workAreaForCurrentWindow = (): WindowBounds => {
    const currentBounds = windows.coordinator.getBounds()
    try {
      return screen.getDisplayMatching(currentBounds).workArea
    } catch {
      return currentBounds
    }
  }

  const leaveFullscreen = (): Promise<void> => {
    if (!windows.coordinator.isFullScreen()) return Promise.resolve()

    return new Promise<void>((resolve) => {
      let unsubscribe = (): void => undefined
      const finish = (): void => {
        unsubscribe()
        resolve()
      }
      unsubscribe = windows.coordinator.onFullscreenChanged((fullscreen) => {
        if (!fullscreen) finish()
      })
      windows.coordinator.setFullScreen(false)
      if (!windows.coordinator.isFullScreen()) finish()
    })
  }

  const boundsForOptions = (): WindowBounds => {
    if (splashPresented && playerBounds) return playerBounds

    if (playerBounds) {
      playerBounds = windows.coordinator.getBounds()
      return playerBounds
    }

    playerBounds = normalSurfaceBounds(workAreaForCurrentWindow())
    return playerBounds
  }

  return {
    async presentSplash(presentOverlay): Promise<void> {
      await leaveFullscreen()
      if (!splashPresented) playerBounds = windows.coordinator.getBounds()
      splashPresented = true
      windows.coordinator.setOverlayBounds(centeredSurfaceBounds(workAreaForCurrentWindow()))
      await presentOverlay()
    },

    async presentOptions(presentOverlay): Promise<void> {
      await leaveFullscreen()
      windows.coordinator.setBounds(boundsForOptions())
      splashPresented = false
      await presentOverlay()
    },

    restorePlayerBounds(): void {
      if (!playerBounds) playerBounds = windows.coordinator.getBounds()
      if (playerBounds) windows.coordinator.setBounds(playerBounds)
      splashPresented = false
    }
  }
}
