import { describe, expect, it } from 'vitest'
import { defaultAnkiSettings, mergeAnkiSettings } from '@src/shared/anki'

describe('mergeAnkiSettings', () => {
  it('defaults and validates the persisted duplicate policy', () => {
    expect(defaultAnkiSettings.duplicatePolicy).toBe('prevent-deck')
    expect(mergeAnkiSettings({ duplicatePolicy: 'prevent-global' }).duplicatePolicy).toBe(
      'prevent-global'
    )
    expect(mergeAnkiSettings({ duplicatePolicy: 'unknown' }).duplicatePolicy).toBe('prevent-deck')
  })

  it('leaves optional field mappings unset when an older settings file omits them', () => {
    const { fieldMap } = mergeAnkiSettings({ deckName: 'Japanese' })
    for (const field of [
      'picture',
      'frequency',
      'pitchAccent',
      'sentenceAudio',
      'jlptLevel'
    ] as const) {
      expect(fieldMap[field]).toBe('')
    }
  })
})
