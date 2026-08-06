import { describe, expect, it } from 'vitest'
import {
  DEFAULT_KNOWLEDGE_TUNING,
  isKnowledgeSourceDetail,
  LEVEL_ORDER,
  maxKnowledgeLevel
} from '@src/shared/knowledge'

// The one place the shipped tuning values are pinned as literals. Everywhere
// else spreads DEFAULT_KNOWLEDGE_TUNING so a deliberate change lands here only.
describe('DEFAULT_KNOWLEDGE_TUNING', () => {
  it('ships the documented thresholds', () => {
    expect(DEFAULT_KNOWLEDGE_TUNING).toEqual({
      ankiKnownDecks: [],
      ankiKnownField: '',
      knownIntervalDays: 21,
      wellKnownIntervalDays: 90,
      coloringEnabled: true,
      staleAfterHours: 23
    })
  })
})

describe('LEVEL_ORDER', () => {
  it('ranks inDeck directly above unknown and below learning', () => {
    expect(LEVEL_ORDER).toEqual(['unknown', 'inDeck', 'learning', 'known', 'wellKnown'])
    expect(LEVEL_ORDER.indexOf('inDeck')).toBe(1)
  })
})

describe('maxKnowledgeLevel', () => {
  it('returns the higher-ranked level for every pair', () => {
    expect(maxKnowledgeLevel('unknown', 'learning')).toBe('learning')
    expect(maxKnowledgeLevel('known', 'learning')).toBe('known')
    expect(maxKnowledgeLevel('wellKnown', 'known')).toBe('wellKnown')
  })

  it('lets inDeck beat unknown but lose to any real learning progress', () => {
    expect(maxKnowledgeLevel('inDeck', 'unknown')).toBe('inDeck')
    expect(maxKnowledgeLevel('unknown', 'inDeck')).toBe('inDeck')
    expect(maxKnowledgeLevel('inDeck', 'learning')).toBe('learning')
    expect(maxKnowledgeLevel('inDeck', 'wellKnown')).toBe('wellKnown')
  })
})

describe('isKnowledgeSourceDetail', () => {
  it('accepts a WaniKani detail without a curriculum level', () => {
    expect(isKnowledgeSourceDetail({ source: 'wanikani', proficiency: 'Guru II' })).toBe(true)
  })

  it('rejects a WaniKani detail with an invalid curriculum level', () => {
    expect(
      isKnowledgeSourceDetail({ source: 'wanikani', curriculumLevel: 0, proficiency: 'Guru II' })
    ).toBe(false)
    expect(
      isKnowledgeSourceDetail({
        source: 'wanikani',
        curriculumLevel: undefined,
        proficiency: 'Guru II'
      })
    ).toBe(false)
  })
})
