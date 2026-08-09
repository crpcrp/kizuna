import {
  SUBTITLE_FONT_SCALE_MAX,
  SUBTITLE_FONT_SCALE_MIN,
  SUBTITLE_FONT_SCALE_STEP
} from '../../../shared/playerSettings'

export type SubtitleFontWheelDirection = -1 | 0 | 1

export interface SubtitleFontWheelEventLike {
  deltaX: number
  deltaY: number
  shiftKey: boolean
  ctrlKey: boolean
  altKey: boolean
  metaKey: boolean
  target: unknown
  currentTarget: unknown
}

/** Maps a wheel gesture to one vertical direction, regardless of axis. */
export function subtitleFontWheelDirection(
  deltaY: number,
  deltaX: number
): SubtitleFontWheelDirection {
  const axis = Number.isFinite(deltaY) && deltaY !== 0 ? deltaY : deltaX
  if (!Number.isFinite(axis) || axis === 0) return 0
  return axis < 0 ? -1 : 1
}

/** Returns the next persisted font scale using one whole UI step per gesture.
 * A negative wheel direction is wheel-up, which increases the font size. */
export function adjustSubtitleFontScale(
  fontScale: number,
  direction: Exclude<SubtitleFontWheelDirection, 0>
): number {
  const currentPercent = Math.round(fontScale * 100)
  const nextPercent = Math.min(
    SUBTITLE_FONT_SCALE_MAX * 100,
    Math.max(
      SUBTITLE_FONT_SCALE_MIN * 100,
      currentPercent - direction * SUBTITLE_FONT_SCALE_STEP * 100
    )
  )
  return nextPercent / 100
}

function isTargetInsideCurrentTarget(target: unknown, currentTarget: unknown): boolean {
  if (target === currentTarget) return true
  if (
    (typeof currentTarget !== 'object' || currentTarget === null) &&
    typeof currentTarget !== 'function'
  ) {
    return false
  }
  const contains = (currentTarget as { contains?: unknown }).contains
  return typeof contains === 'function' && contains.call(currentTarget, target)
}

/** Guards the fixed shortcut before the App prevents the browser's wheel default. */
export function isSubtitleFontWheelShortcut(event: SubtitleFontWheelEventLike): boolean {
  return (
    event.shiftKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.metaKey &&
    subtitleFontWheelDirection(event.deltaY, event.deltaX) !== 0 &&
    isTargetInsideCurrentTarget(event.target, event.currentTarget)
  )
}
