// Window geometry types shared across main, preload, and renderer. The mpv
// video lives in the OS window itself, so mini-player mode moves/resizes the
// *window* — these types cross the `window:getBounds`/`window:setBounds`
// bridge, and the corner math is pure so it can be unit-tested without a
// display attached.

/** A plain rectangle, matching Electron's `Rectangle` shape. */
export interface WindowBounds {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Payload of the `window:setBounds` channel. `explicit` sets an exact
 * rectangle (for restoring saved pre-mini window bounds); `miniPlayer`
 * asks main to compute the bottom-right corner of the *current* display's work
 * area itself (only main has `screen`), fitting a 480×270 video plus the
 * measured top and bottom chrome heights.
 */
export type SetWindowBoundsRequest =
  | { mode: 'explicit'; bounds: WindowBounds }
  | { mode: 'miniPlayer'; topBarHeight: number; bottomBarHeight: number }

/** Mini-player video area (px). Height gains both visible chrome bars. */
export const MINI_PLAYER_WIDTH = 480
export const MINI_PLAYER_VIDEO_HEIGHT = 270

/**
 * Pure: the mini-player window rectangle, flushed to the bottom-right corner of
 * `workArea` (the display's usable area, taskbar excluded). The measured top
 * and bottom chrome heights are added around the 480×270 video so mpv's
 * matching video margins leave the full picture visible. Non-finite or
 * negative heights clamp to 0. All coordinates are rounded to whole pixels.
 */
export function miniPlayerBounds(
  workArea: WindowBounds,
  topBarHeight: number,
  bottomBarHeight: number
): WindowBounds {
  const topBar = Number.isFinite(topBarHeight) && topBarHeight > 0 ? Math.round(topBarHeight) : 0
  const bottomBar =
    Number.isFinite(bottomBarHeight) && bottomBarHeight > 0 ? Math.round(bottomBarHeight) : 0
  const width = MINI_PLAYER_WIDTH
  const height = MINI_PLAYER_VIDEO_HEIGHT + topBar + bottomBar
  return {
    x: Math.round(workArea.x + workArea.width - width),
    y: Math.round(workArea.y + workArea.height - height),
    width,
    height
  }
}

/** Runtime guard for a well-formed bounds object arriving from untrusted IPC. */
export function isWindowBounds(value: unknown): value is WindowBounds {
  if (!value || typeof value !== 'object') return false
  const bounds = value as Record<string, unknown>
  return (['x', 'y', 'width', 'height'] as const).every(
    (key) => typeof bounds[key] === 'number' && Number.isFinite(bounds[key])
  )
}
