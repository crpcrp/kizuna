import { describe, it, expect } from 'vitest'
import {
  applyLevelColors,
  DEFAULT_LEVEL_COLOR_HEX,
  LEVEL_COLOR_VARS,
  type LevelColorStyle
} from '@src/renderer/src/util/levelColors'
import { UNDERLINE_LEVELS } from '@src/shared/playerSettings'

/** Records every setProperty/removeProperty call, standing in for <html>.style. */
function fakeStyle(): LevelColorStyle & {
  set: Record<string, string>
  removed: string[]
} {
  const set: Record<string, string> = {}
  const removed: string[] = []
  return {
    set,
    removed,
    setProperty: (name, value) => {
      set[name] = value
    },
    removeProperty: (name) => {
      removed.push(name)
    }
  }
}

describe('LEVEL_COLOR_VARS / DEFAULT_LEVEL_COLOR_HEX', () => {
  it('cover exactly the underline levels', () => {
    expect(Object.keys(LEVEL_COLOR_VARS).sort()).toEqual([...UNDERLINE_LEVELS].sort())
    expect(Object.keys(DEFAULT_LEVEL_COLOR_HEX).sort()).toEqual([...UNDERLINE_LEVELS].sort())
    for (const level of UNDERLINE_LEVELS) {
      expect(DEFAULT_LEVEL_COLOR_HEX[level]).toMatch(/^#[0-9a-f]{6}$/)
    }
  })
})

describe('applyLevelColors', () => {
  it('sets the overridden levels and removes the rest', () => {
    const style = fakeStyle()
    applyLevelColors(style, { unknown: '#112233', known: '#445566' })
    expect(style.set).toEqual({
      '--level-unknown': '#112233',
      '--level-known': '#445566'
    })
    expect(style.removed).toEqual([
      '--level-in-deck',
      '--level-learning',
      '--level-well-known',
      '--level-well-known-underline'
    ])
  })

  it('sets --level-in-deck from an inDeck override', () => {
    const style = fakeStyle()
    applyLevelColors(style, { inDeck: '#6090e0' })
    expect(style.set).toEqual({ '--level-in-deck': '#6090e0' })
    expect(style.removed).toContain('--level-unknown')
    expect(style.removed).not.toContain('--level-in-deck')
  })

  it('sets both report and underline variables from a wellKnown override', () => {
    const style = fakeStyle()
    applyLevelColors(style, { wellKnown: '#ffffff' })
    expect(style.set).toEqual({
      '--level-well-known': '#ffffff',
      '--level-well-known-underline': '#ffffff'
    })
    expect(style.removed).toEqual([
      '--level-unknown',
      '--level-in-deck',
      '--level-learning',
      '--level-known'
    ])
  })

  it('removes every variable when no override is set', () => {
    const style = fakeStyle()
    applyLevelColors(style, {})
    expect(style.set).toEqual({})
    expect(style.removed).toEqual([
      '--level-unknown',
      '--level-in-deck',
      '--level-learning',
      '--level-known',
      '--level-well-known',
      '--level-well-known-underline'
    ])
  })
})
