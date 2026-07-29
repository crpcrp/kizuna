import { describe, expect, it } from 'vitest'
import { LEVEL_ORDER, maxKnowledgeLevel } from '@src/shared/knowledge'

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
