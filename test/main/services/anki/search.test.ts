import { describe, it, expect } from 'vitest'
import { duplicateScope, findExistingQuery } from '@src/main/services/anki/search'

describe('findExistingQuery', () => {
  it('builds a deck-scoped exact field query without turning the field clause into plain text', () => {
    expect(findExistingQuery('Japanese', 'Word', '地獄耳')).toBe('deck:"Japanese" Word:"地獄耳"')
  })

  it('escapes quotes and backslashes in search values', () => {
    expect(findExistingQuery('My "Deck"', 'Word', 'foo\\"bar')).toBe(
      'deck:"My \\"Deck\\"" Word:"foo\\\\\\"bar"'
    )
  })

  it('quotes a field clause only when its field name contains whitespace', () => {
    expect(findExistingQuery('Japanese', 'Word Field', 'cat', 'global')).toBe('"Word Field:cat"')
  })

  it('omits the deck clause entirely in global scope', () => {
    expect(findExistingQuery('Japanese', 'Word', 'cat', 'global')).toBe('Word:"cat"')
  })
})

describe('duplicateScope', () => {
  it('scopes prevent-deck to the configured deck', () => {
    expect(duplicateScope('prevent-deck')).toBe('deck')
  })

  it('scopes every other policy globally', () => {
    expect(duplicateScope('prevent-global')).toBe('global')
    expect(duplicateScope('allow')).toBe('global')
    expect(duplicateScope('overwrite')).toBe('global')
  })
})
