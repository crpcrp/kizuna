import {
  DEFAULT_KEY_BINDINGS,
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

export function eventKeyBinding(event: KeyChord, held: ReadonlySet<string>): KeyBinding | null {
  if (MODIFIER_KEY_CODES.has(event.code)) return null
  if (event.altKey || event.metaKey) return null
  if (event.ctrlKey && event.shiftKey) return null
  if (event.ctrlKey) return held.has('ControlLeft') ? `ControlLeft+${event.code}` : null
  if (event.shiftKey) return held.has('ShiftLeft') ? `ShiftLeft+${event.code}` : null
  return event.code
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
    ArrowDown: '↓'
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
