import {
  DEFAULT_KEY_BINDINGS,
  MOUSE_WHEEL_DOWN_BINDING_CODE,
  MOUSE_WHEEL_UP_BINDING_CODE,
  isKeyModifier,
  type KeyBinding,
  type KeyBindings,
  type KeyModifier,
  type PlayerKeyAction
} from '../../../shared/playerSettings'

export function keyToAction(
  binding: KeyBinding,
  bindings: KeyBindings = DEFAULT_KEY_BINDINGS
): PlayerKeyAction | null {
  const entry = (Object.entries(bindings) as [PlayerKeyAction, KeyBinding][]).find(
    ([, bound]) => bound === binding
  )
  return entry ? entry[0] : null
}

const MODIFIER_KEY_CODES = new Set([
  'ControlLeft',
  'ControlRight',
  'ShiftLeft',
  'ShiftRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight'
])

export interface EditableTarget {
  tagName?: string
  isContentEditable?: boolean
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!target) return false
  const el = target as EditableTarget
  if (el.isContentEditable) return true
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT'
}

export interface KeyChord {
  code: string
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
}

export interface WheelChord {
  /** Chromium/the OS translates a shifted vertical wheel to `deltaX` on some
   * platforms, so the direction is read off whichever axis moved. */
  deltaX: number
  deltaY: number
  ctrlKey: boolean
  shiftKey: boolean
  altKey: boolean
  metaKey: boolean
}

/** Maps a wheel gesture to one vertical direction, regardless of axis.
 * `-1` is wheel up, `1` is wheel down, `0` is a wheel event to ignore. */
export function wheelDirection(deltaY: number, deltaX: number): -1 | 0 | 1 {
  const axis = Number.isFinite(deltaY) && deltaY !== 0 ? deltaY : deltaX
  if (!Number.isFinite(axis) || axis === 0) return 0
  return axis < 0 ? -1 : 1
}

export function eventKeyBinding(event: KeyChord, held: ReadonlySet<string>): KeyBinding | null {
  if (MODIFIER_KEY_CODES.has(event.code)) return null
  if (event.altKey || event.metaKey) return null
  if (event.ctrlKey && event.shiftKey) return null
  if (event.ctrlKey) return held.has('ControlLeft') ? `ControlLeft+${event.code}` : null
  if (event.shiftKey) return held.has('ShiftLeft') ? `ShiftLeft+${event.code}` : null
  return event.code
}

function leftModifierIsHeld(
  held: ReadonlySet<string>,
  left: 'ControlLeft' | 'ShiftLeft',
  right: 'ControlRight' | 'ShiftRight'
): boolean {
  // WheelEvent does not identify which side supplied the modifier. During
  // isolated capture/tests there may be no tracker state, so the modifier
  // flags are treated as the left-side binding; the live tracker still
  // rejects an explicitly held right-side modifier.
  return held.size === 0 || (held.has(left) && !held.has(right))
}

/** The binding a wheel gesture produces, direction included. A zero-delta event
 * yields null so it can neither reassign nor trigger a binding. */
export function wheelEventKeyBinding(
  event: WheelChord,
  held: ReadonlySet<string>
): KeyBinding | null {
  if (event.altKey || event.metaKey) return null
  if (event.ctrlKey && event.shiftKey) return null
  const direction = wheelDirection(event.deltaY, event.deltaX)
  if (direction === 0) return null
  const code = direction < 0 ? MOUSE_WHEEL_UP_BINDING_CODE : MOUSE_WHEEL_DOWN_BINDING_CODE
  if (event.ctrlKey) {
    return leftModifierIsHeld(held, 'ControlLeft', 'ControlRight') ? `ControlLeft+${code}` : null
  }
  if (event.shiftKey) {
    return leftModifierIsHeld(held, 'ShiftLeft', 'ShiftRight') ? `ShiftLeft+${code}` : null
  }
  return code
}

export interface ModifierTracker {
  readonly held: ReadonlySet<string>
  keyDown(event: { code: string }): void
  keyUp(event: { code: string }): void
  clear(): void
}

export function createModifierTracker(): ModifierTracker {
  const held = new Set<string>()
  return {
    held,
    keyDown: (event) => {
      if (MODIFIER_KEY_CODES.has(event.code)) held.add(event.code)
    },
    keyUp: (event) => {
      held.delete(event.code)
    },
    clear: () => held.clear()
  }
}

export function describeKeyCode(code: string): string {
  const named: Record<string, string> = {
    Space: 'Space',
    Escape: 'Esc',
    ArrowLeft: '←',
    ArrowRight: '→',
    ArrowUp: '↑',
    ArrowDown: '↓',
    [MOUSE_WHEEL_UP_BINDING_CODE]: 'mouse wheel up',
    [MOUSE_WHEEL_DOWN_BINDING_CODE]: 'mouse wheel down'
  }
  if (named[code]) return named[code]
  if (code.startsWith('Key')) return code.slice(3)
  if (code.startsWith('Digit')) return code.slice(5)
  return code
}

const MODIFIER_LABELS: Record<KeyModifier, string> = {
  ControlLeft: 'Ctrl',
  ShiftLeft: 'Shift'
}

export function describeKeyBinding(binding: KeyBinding): string {
  const parts = binding.split('+')
  const code = parts[parts.length - 1]
  const modifiers = parts
    .slice(0, -1)
    .map((modifier) => (isKeyModifier(modifier) ? MODIFIER_LABELS[modifier] : modifier))
  return [...modifiers, describeKeyCode(code)].join(' + ')
}
