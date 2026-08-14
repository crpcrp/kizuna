import type { WindowBounds } from './windowBounds'

/** The compact native content size used by the startup chooser. */
export const SPLASH_SURFACE_WIDTH = 640
export const SPLASH_SURFACE_HEIGHT = 400

/**
 * Centers a surface in a display work area, shrinking it when the work area is
 * smaller than the requested size so the whole surface remains visible.
 */
export function centeredSurfaceBounds(
  workArea: WindowBounds,
  width = SPLASH_SURFACE_WIDTH,
  height = SPLASH_SURFACE_HEIGHT
): WindowBounds {
  const availableWidth = positiveInteger(workArea.width)
  const availableHeight = positiveInteger(workArea.height)
  const surfaceWidth = Math.min(positiveInteger(width), availableWidth)
  const surfaceHeight = Math.min(positiveInteger(height), availableHeight)

  return {
    x: Math.round(workArea.x + (workArea.width - surfaceWidth) / 2),
    y: Math.round(workArea.y + (workArea.height - surfaceHeight) / 2),
    width: surfaceWidth,
    height: surfaceHeight
  }
}

function positiveInteger(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.max(1, Math.round(value)) : 1
}
