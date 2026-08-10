import {
  DEFAULT_KEY_BINDINGS,
  SUBTITLE_FONT_SCALE_MAX,
  SUBTITLE_FONT_SCALE_MIN,
  SUBTITLE_FONT_SCALE_STEP,
  type KeyBindings
} from '../../../shared/playerSettings'
import { wheelEventKeyBinding } from './keyBindings'

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

/** One subtitle-size step: `1` grows the text, `-1` shrinks it. */
export type SubtitleFontScaleStep = -1 | 1

/** Returns the next persisted font scale, one whole UI step in `step`'s
 * direction, clamped to the persisted bounds. Percent arithmetic keeps the
 * result free of floating-point drift. */
export function adjustSubtitleFontScale(fontScale: number, step: SubtitleFontScaleStep): number {
  const currentPercent = Math.round(fontScale * 100)
  const nextPercent = Math.min(
    SUBTITLE_FONT_SCALE_MAX * 100,
    Math.max(SUBTITLE_FONT_SCALE_MIN * 100, currentPercent + step * SUBTITLE_FONT_SCALE_STEP * 100)
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

const NO_HELD_MODIFIERS: ReadonlySet<string> = new Set()

/**
 * The subtitle-size step a wheel gesture over the playback surface should
 * apply, or null when the gesture matches neither configured binding (wrong
 * chord, wrong direction, zero delta, or outside the surface). The App uses a
 * non-null result as its cue to prevent the browser's wheel default.
 */
export function subtitleFontWheelStep(
  event: SubtitleFontWheelEventLike,
  bindings: KeyBindings = DEFAULT_KEY_BINDINGS,
  held: ReadonlySet<string> = NO_HELD_MODIFIERS
): SubtitleFontScaleStep | null {
  if (!isTargetInsideCurrentTarget(event.target, event.currentTarget)) return null
  const binding = wheelEventKeyBinding(event, held)
  if (!binding) return null
  if (binding === bindings.subtitleFontScaleUp) return 1
  if (binding === bindings.subtitleFontScaleDown) return -1
  return null
}
