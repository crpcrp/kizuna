import { describe, expect, it } from 'vitest'
import {
  adjustSubtitleFontScale,
  subtitleFontWheelStep
} from '@src/renderer/src/state/subtitleFontWheel'
import { DEFAULT_KEY_BINDINGS, type KeyBindings } from '@src/shared/playerSettings'

const child = {}
const surface = { contains: (target: unknown): boolean => target === child }

function event(overrides: Partial<Parameters<typeof subtitleFontWheelStep>[0]> = {}) {
  return {
    deltaX: 0,
    deltaY: -1,
    shiftKey: true,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    target: child,
    currentTarget: surface,
    ...overrides
  }
}

describe('adjustSubtitleFontScale', () => {
  it('changes one exact ten-point step without floating-point drift', () => {
    expect(adjustSubtitleFontScale(1, 1)).toBe(1.1)
    expect(adjustSubtitleFontScale(1, -1)).toBe(0.9)
    expect(adjustSubtitleFontScale(1.2, 1)).toBe(1.3)
  })

  it('clamps at both persisted-setting boundaries', () => {
    expect(adjustSubtitleFontScale(0.5, -1)).toBe(0.5)
    expect(adjustSubtitleFontScale(3, 1)).toBe(3)
  })
})

describe('subtitleFontWheelStep', () => {
  it('maps the default Shift chord to opposite steps by wheel direction', () => {
    expect(subtitleFontWheelStep(event())).toBe(1)
    expect(subtitleFontWheelStep(event({ deltaY: 1 }))).toBe(-1)
  })

  it('uses the Shift-translated horizontal axis when deltaY is zero', () => {
    expect(subtitleFontWheelStep(event({ deltaY: 0, deltaX: -40 }))).toBe(1)
    expect(subtitleFontWheelStep(event({ deltaY: 0, deltaX: 40 }))).toBe(-1)
  })

  it('only fires inside the playback surface', () => {
    expect(subtitleFontWheelStep(event({ target: {}, currentTarget: surface }))).toBeNull()
    expect(subtitleFontWheelStep(event({ currentTarget: child }))).toBe(1)
  })

  it('rejects plain, modified, and zero-delta wheel events', () => {
    expect(subtitleFontWheelStep(event({ shiftKey: false }))).toBeNull()
    expect(subtitleFontWheelStep(event({ ctrlKey: true }))).toBeNull()
    expect(subtitleFontWheelStep(event({ altKey: true }))).toBeNull()
    expect(subtitleFontWheelStep(event({ metaKey: true }))).toBeNull()
    expect(subtitleFontWheelStep(event({ deltaY: 0, deltaX: 0 }))).toBeNull()
  })

  it('follows custom bindings, including a swapped or keyboard-only pair', () => {
    const swapped: KeyBindings = {
      ...DEFAULT_KEY_BINDINGS,
      subtitleFontScaleUp: 'ShiftLeft+MouseWheelDown',
      subtitleFontScaleDown: 'ShiftLeft+MouseWheelUp'
    }
    expect(subtitleFontWheelStep(event(), swapped)).toBe(-1)
    expect(subtitleFontWheelStep(event({ deltaY: 1 }), swapped)).toBe(1)

    const keyboardOnly: KeyBindings = {
      ...DEFAULT_KEY_BINDINGS,
      subtitleFontScaleUp: 'KeyZ',
      subtitleFontScaleDown: 'KeyX'
    }
    expect(subtitleFontWheelStep(event(), keyboardOnly)).toBeNull()
  })
})
