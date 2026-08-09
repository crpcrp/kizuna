import { describe, expect, it } from 'vitest'
import {
  adjustSubtitleFontScale,
  isSubtitleFontWheelShortcut,
  subtitleFontWheelDirection
} from '@src/renderer/src/state/subtitleFontWheel'

const child = {}
const surface = { contains: (target: unknown): boolean => target === child }

function event(overrides: Partial<Parameters<typeof isSubtitleFontWheelShortcut>[0]> = {}) {
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

describe('subtitleFontWheelDirection', () => {
  it('maps vertical and translated horizontal wheel axes to up/down', () => {
    expect(subtitleFontWheelDirection(-40, 0)).toBe(-1)
    expect(subtitleFontWheelDirection(40, 0)).toBe(1)
    expect(subtitleFontWheelDirection(0, -40)).toBe(-1)
    expect(subtitleFontWheelDirection(0, 40)).toBe(1)
    expect(subtitleFontWheelDirection(0, 0)).toBe(0)
  })
})

describe('adjustSubtitleFontScale', () => {
  it('changes one exact ten-point step without floating-point drift', () => {
    expect(adjustSubtitleFontScale(1, -1)).toBe(1.1)
    expect(adjustSubtitleFontScale(1, 1)).toBe(0.9)
    expect(adjustSubtitleFontScale(1.2, -1)).toBe(1.3)
  })

  it('clamps at both persisted-setting boundaries', () => {
    expect(adjustSubtitleFontScale(0.5, 1)).toBe(0.5)
    expect(adjustSubtitleFontScale(3, -1)).toBe(3)
  })
})

describe('isSubtitleFontWheelShortcut', () => {
  it('accepts only shifted wheel events inside the playback surface', () => {
    expect(isSubtitleFontWheelShortcut(event())).toBe(true)
    expect(isSubtitleFontWheelShortcut(event({ target: {}, currentTarget: surface }))).toBe(false)
    expect(isSubtitleFontWheelShortcut(event({ currentTarget: child }))).toBe(true)
  })

  it('rejects plain, modified, and zero-delta wheel events', () => {
    expect(isSubtitleFontWheelShortcut(event({ shiftKey: false }))).toBe(false)
    expect(isSubtitleFontWheelShortcut(event({ ctrlKey: true }))).toBe(false)
    expect(isSubtitleFontWheelShortcut(event({ altKey: true }))).toBe(false)
    expect(isSubtitleFontWheelShortcut(event({ metaKey: true }))).toBe(false)
    expect(isSubtitleFontWheelShortcut(event({ deltaY: 0, deltaX: 0 }))).toBe(false)
  })
})
