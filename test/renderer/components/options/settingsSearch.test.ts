import { describe, expect, it } from 'vitest'
import {
  matchSettings,
  type SettingEntry
} from '@src/renderer/src/components/options/settingsSearch'
import { SETTING_ENTRIES } from '@src/renderer/src/components/OptionsMenu'

const entries: SettingEntry[] = [
  { id: 'a', label: 'Normalize loudness', category: 'playback', keywords: ['volume', 'audio'] },
  { id: 'b', label: 'Screenshot folder', category: 'playback' },
  { id: 'c', label: 'A–B loop', category: 'keybindings', keywords: ['shortcut'] }
]

describe('matchSettings', () => {
  it('matches a case-insensitive substring of the label', () => {
    expect(matchSettings('LOUD', entries).map((e) => e.id)).toEqual(['a'])
  })

  it('matches a keyword the label does not contain', () => {
    expect(matchSettings('volume', entries).map((e) => e.id)).toEqual(['a'])
  })

  it('requires every whitespace-separated term to hit', () => {
    expect(matchSettings('normalize audio', entries).map((e) => e.id)).toEqual(['a'])
    expect(matchSettings('normalize folder', entries)).toEqual([])
  })

  it('folds dashes, so a typed hyphen finds an en-dashed label', () => {
    expect(matchSettings('a-b', entries).map((e) => e.id)).toEqual(['c'])
  })

  it('returns nothing for a blank query, so the tabbed view stays', () => {
    expect(matchSettings('', entries)).toEqual([])
    expect(matchSettings('   ', entries)).toEqual([])
  })

  it('preserves input order for a query that hits several entries', () => {
    expect(matchSettings('o', entries).map((e) => e.id)).toEqual(['a', 'b', 'c'])
  })
})

describe('SETTING_ENTRIES', () => {
  it('finds the settings the acceptance criteria name, in the right tab', () => {
    const found = (query: string): { label: string; category: string }[] =>
      matchSettings(query, SETTING_ENTRIES).map((e) => ({ label: e.label, category: e.category }))

    expect(found('loudness')).toContainEqual({ label: 'Normalize loudness', category: 'playback' })
    expect(found('screenshot')).toContainEqual({
      label: 'Screenshot folder',
      category: 'playback'
    })
    expect(found('theme')).toContainEqual({ label: 'Theme', category: 'appearance' })
    expect(found('skip')).toContainEqual({
      label: 'Skip back/ahead seconds',
      category: 'playback'
    })
    expect(found('a-b')).toContainEqual({ label: 'A–B loop', category: 'keybindings' })
  })

  it('has unique entry ids', () => {
    const ids = SETTING_ENTRIES.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
