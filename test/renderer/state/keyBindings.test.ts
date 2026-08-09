import { describe, expect, it } from 'vitest'
import {
  createModifierTracker,
  describeKeyBinding,
  describeKeyCode,
  eventKeyBinding,
  isEditableTarget,
  keyToAction,
  wheelEventKeyBinding,
  type KeyChord
} from '@src/renderer/src/state/keyBindings'
import {
  DEFAULT_KEY_BINDINGS,
  MOUSE_WHEEL_BINDING_CODE,
  type KeyBindings
} from '@src/shared/playerSettings'

describe('keyToAction', () => {
  it('maps default bindings and rejects unmapped keys', () => {
    expect(keyToAction('Space')).toBe('togglePause')
    expect(keyToAction('KeyF')).toBe('toggleFullscreen')
    expect(keyToAction('Escape')).toBe('exitFullscreen')
    expect(keyToAction('ArrowLeft')).toBe('skipBack')
    expect(keyToAction('ArrowRight')).toBe('skipForward')
    expect(keyToAction('KeyA')).toBeNull()
  })

  it('honors custom bindings and matches modifier chords exactly', () => {
    const custom: KeyBindings = {
      ...DEFAULT_KEY_BINDINGS,
      togglePause: 'KeyK',
      toggleFullscreen: 'ControlLeft+ArrowUp'
    }
    expect(keyToAction('KeyK', custom)).toBe('togglePause')
    expect(keyToAction('Space', custom)).toBeNull()
    expect(keyToAction('ControlLeft+ArrowUp', custom)).toBe('toggleFullscreen')
    expect(keyToAction('ArrowUp', custom)).toBeNull()
  })
})

function chord(overrides: Partial<KeyChord> & { code: string }): KeyChord {
  return { ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...overrides }
}

describe('eventKeyBinding', () => {
  const noModifiers: ReadonlySet<string> = new Set()
  const ctrlHeld: ReadonlySet<string> = new Set(['ControlLeft'])
  const shiftHeld: ReadonlySet<string> = new Set(['ShiftLeft'])

  it('returns a bare code or a tracked left-side modifier chord', () => {
    expect(eventKeyBinding(chord({ code: 'Space' }), noModifiers)).toBe('Space')
    expect(eventKeyBinding(chord({ code: 'ArrowUp', ctrlKey: true }), ctrlHeld)).toBe(
      'ControlLeft+ArrowUp'
    )
    expect(eventKeyBinding(chord({ code: 'KeyR', shiftKey: true }), shiftHeld)).toBe(
      'ShiftLeft+KeyR'
    )
  })

  it('rejects right-side, standalone, and unsupported modifier combinations', () => {
    expect(eventKeyBinding(chord({ code: 'ArrowUp', ctrlKey: true }), noModifiers)).toBeNull()
    expect(eventKeyBinding(chord({ code: 'ControlLeft', ctrlKey: true }), ctrlHeld)).toBeNull()
    expect(eventKeyBinding(chord({ code: 'KeyF', altKey: true }), noModifiers)).toBeNull()
    expect(eventKeyBinding(chord({ code: 'KeyF', metaKey: true }), noModifiers)).toBeNull()
    expect(
      eventKeyBinding(
        chord({ code: 'ArrowUp', ctrlKey: true, shiftKey: true }),
        new Set(['ControlLeft', 'ShiftLeft'])
      )
    ).toBeNull()
  })
})

describe('wheelEventKeyBinding', () => {
  const noModifiers: ReadonlySet<string> = new Set()

  it('returns a wheel code or a tracked modifier chord', () => {
    expect(
      wheelEventKeyBinding(
        { ctrlKey: false, shiftKey: false, altKey: false, metaKey: false },
        noModifiers
      )
    ).toBe(MOUSE_WHEEL_BINDING_CODE)
    expect(
      wheelEventKeyBinding(
        { ctrlKey: false, shiftKey: true, altKey: false, metaKey: false },
        new Set(['ShiftLeft'])
      )
    ).toBe('ShiftLeft+MouseWheel')
  })

  it('rejects unsupported modifiers and right-side tracked modifiers', () => {
    expect(
      wheelEventKeyBinding(
        { ctrlKey: true, shiftKey: true, altKey: false, metaKey: false },
        new Set(['ControlLeft', 'ShiftLeft'])
      )
    ).toBeNull()
    expect(
      wheelEventKeyBinding(
        { ctrlKey: false, shiftKey: true, altKey: false, metaKey: false },
        new Set(['ShiftRight'])
      )
    ).toBeNull()
    expect(
      wheelEventKeyBinding(
        { ctrlKey: false, shiftKey: false, altKey: true, metaKey: false },
        noModifiers
      )
    ).toBeNull()
  })
})

describe('isEditableTarget', () => {
  it('recognizes text-entry elements and contenteditable nodes', () => {
    expect(isEditableTarget({ tagName: 'INPUT' } as unknown as EventTarget)).toBe(true)
    expect(isEditableTarget({ tagName: 'TEXTAREA' } as unknown as EventTarget)).toBe(true)
    expect(isEditableTarget({ tagName: 'SELECT' } as unknown as EventTarget)).toBe(true)
    expect(
      isEditableTarget({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget)
    ).toBe(true)
  })

  it('rejects non-editable or missing targets', () => {
    expect(isEditableTarget({ tagName: 'DIV' } as unknown as EventTarget)).toBe(false)
    expect(isEditableTarget(null)).toBe(false)
  })
})

describe('createModifierTracker', () => {
  it('tracks modifier keys on both sides and ignores ordinary keys', () => {
    const tracker = createModifierTracker()
    tracker.keyDown({ code: 'ControlLeft' })
    tracker.keyDown({ code: 'ControlRight' })
    tracker.keyDown({ code: 'KeyF' })
    expect([...tracker.held]).toEqual(['ControlLeft', 'ControlRight'])
    tracker.keyUp({ code: 'ControlLeft' })
    expect([...tracker.held]).toEqual(['ControlRight'])
  })

  it('clear drops held modifiers', () => {
    const tracker = createModifierTracker()
    tracker.keyDown({ code: 'ShiftLeft' })
    tracker.keyDown({ code: 'ControlLeft' })
    tracker.clear()
    expect(tracker.held.size).toBe(0)
  })
})

describe('key binding labels', () => {
  it('describes common, alphanumeric, and unknown codes', () => {
    expect(describeKeyCode('Space')).toBe('Space')
    expect(describeKeyCode('Escape')).toBe('Esc')
    expect(describeKeyCode('ArrowLeft')).toBe('←')
    expect(describeKeyCode('KeyF')).toBe('F')
    expect(describeKeyCode('Digit5')).toBe('5')
    expect(describeKeyCode('F11')).toBe('F11')
    expect(describeKeyCode(MOUSE_WHEEL_BINDING_CODE)).toBe('mouse wheel')
  })

  it('includes modifier labels in chords', () => {
    expect(describeKeyBinding('Space')).toBe('Space')
    expect(describeKeyBinding('ControlLeft+ArrowDown')).toBe('Ctrl + ↓')
    expect(describeKeyBinding('ShiftLeft+KeyR')).toBe('Shift + R')
  })
})
