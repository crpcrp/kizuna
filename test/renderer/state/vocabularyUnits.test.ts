import { describe, expect, it } from 'vitest'
import type { KnowledgeDetails } from '@src/shared/knowledge'
import type { Token } from '@src/shared/token'
import {
  deriveVocabularyUnits,
  vocabularyLevelsByToken
} from '@src/renderer/src/state/vocabularyUnits'
import type { VocabularySpan } from '@src/renderer/src/state/vocabularySpans'
import { makeToken } from '@test/harness/tokenFixtures'

function token(overrides: Partial<Token> = {}): Token {
  return makeToken({ pos: '名詞', ...overrides })
}

function span(overrides: Partial<VocabularySpan> = {}): VocabularySpan {
  return {
    cueKey: 'cue-1',
    startOffset: 0,
    endOffset: 2,
    memberTokenOffsets: [0, 1],
    expression: '神様',
    matchedSurface: '神様',
    level: 'unknown',
    ...overrides
  }
}

describe('deriveVocabularyUnits', () => {
  it('skips symbols, including a symbol-only span', () => {
    const symbol = token({ surface: '。', lemma: '。', pos: '記号' })
    const units = deriveVocabularyUnits(
      [
        {
          cueKey: 'cue-1',
          tokens: [symbol],
          spans: [span({ memberTokenOffsets: [0], expression: '記号' })]
        }
      ],
      {}
    )

    expect(units).toEqual([])
  })

  it('treats a multi-token compound as one unit while counting each member token', () => {
    const units = deriveVocabularyUnits(
      [
        {
          cueKey: 'cue-1',
          text: '神様',
          tokens: [
            token({ surface: '神', lemma: '神' }),
            token({ surface: '様', lemma: '様', startOffset: 1 })
          ],
          spans: [span()]
        }
      ],
      {}
    )

    expect(units).toHaveLength(1)
    expect(units[0]).toMatchObject({
      key: '神様',
      surface: '神様',
      count: 1,
      tokenCount: 2,
      level: 'unknown',
      grammar: false,
      order: 0
    })
  })

  it('keys a single-token projection by its dictionary expression', () => {
    const projected = token({ surface: 'ヤツ', lemma: 'ヤツ' })
    const [unit] = deriveVocabularyUnits(
      [
        {
          cueKey: 'cue-1',
          text: 'ヤツ',
          tokens: [projected],
          spans: [
            span({
              memberTokenOffsets: [0],
              expression: '奴',
              matchedSurface: 'ヤツ'
            })
          ]
        }
      ],
      {}
    )

    expect(unit).toMatchObject({ key: '奴', surface: 'ヤツ', count: 1, tokenCount: 1 })
  })

  it('collapses bare occurrences under the first projected identity', () => {
    const units = deriveVocabularyUnits(
      [
        {
          cueKey: 'cue-1',
          tokens: [token({ surface: 'ヤツ', lemma: 'ヤツ' })],
          spans: [span({ memberTokenOffsets: [0], expression: '奴', matchedSurface: 'ヤツ' })]
        },
        {
          cueKey: 'cue-2',
          tokens: [token({ surface: 'ヤツ', lemma: 'ヤツ' })]
        }
      ],
      {}
    )

    expect(units).toHaveLength(1)
    expect(units[0]).toMatchObject({ key: '奴', count: 2, tokenCount: 2 })
  })

  it('keeps grammar status when a grammar token is span-covered', () => {
    const grammar = token({ surface: 'に', lemma: 'に', pos: '助詞' })
    const [unit] = deriveVocabularyUnits(
      [
        {
          cueKey: 'cue-1',
          tokens: [grammar],
          spans: [span({ memberTokenOffsets: [0], expression: 'に', matchedSurface: 'に' })]
        }
      ],
      {}
    )

    expect(unit).toMatchObject({ key: 'に', grammar: true })
  })

  it('uses the highest level across details, span levels, and repeated occurrences', () => {
    const details: Record<string, KnowledgeDetails> = {
      lemma: { level: 'learning', sourceKinds: [], sources: [] },
      surface: { level: 'known', sourceKinds: [], sources: [] }
    }
    const units = deriveVocabularyUnits(
      [
        {
          cueKey: 'cue-1',
          tokens: [token({ surface: 'surface', lemma: 'lemma' })],
          spans: [
            span({
              memberTokenOffsets: [0],
              expression: 'lemma',
              matchedSurface: 'surface',
              level: 'unknown'
            })
          ]
        },
        {
          cueKey: 'cue-2',
          tokens: [token({ surface: 'surface', lemma: 'lemma' })],
          spans: [
            span({
              cueKey: 'cue-2',
              memberTokenOffsets: [0],
              expression: 'lemma',
              matchedSurface: 'surface',
              level: 'wellKnown'
            })
          ]
        }
      ],
      details
    )

    expect(units[0].level).toBe('wellKnown')
  })
})

describe('vocabularyLevelsByToken', () => {
  it('levels every member of a compound the same way the derived unit is levelled', () => {
    const cue = {
      cueKey: 'cue-1',
      text: '神様',
      tokens: [
        token({ surface: '神', lemma: '神' }),
        token({ surface: '様', lemma: '様', startOffset: 1 })
      ],
      spans: [span()]
    }
    const details: Record<string, KnowledgeDetails> = {
      様: { level: 'known', sourceKinds: [], sources: [] }
    }

    expect(vocabularyLevelsByToken(cue, { 様: 'known' })).toEqual(
      new Map([
        [0, 'known'],
        [1, 'known']
      ])
    )
    expect(deriveVocabularyUnits([cue], details)[0].level).toBe('known')
  })

  it('keeps a span-covered grammar token wellKnown, as the report and mining treat it', () => {
    const grammar = token({ surface: 'に', lemma: 'に', pos: '助詞' })
    const cue = {
      cueKey: 'cue-1',
      text: 'に',
      tokens: [grammar],
      spans: [
        span({ memberTokenOffsets: [0], endOffset: 1, expression: 'に', matchedSurface: 'に' })
      ]
    }

    expect(vocabularyLevelsByToken(cue, { に: 'unknown' })).toEqual(new Map([[0, 'wellKnown']]))
  })

  it('leaves symbols out of the map and defaults unseen lemmas to unknown', () => {
    const levels = vocabularyLevelsByToken(
      {
        cueKey: 'cue-1',
        text: '猫。',
        tokens: [
          token({ surface: '猫', lemma: '猫' }),
          token({ surface: '。', lemma: '。', pos: '記号', startOffset: 1 })
        ]
      },
      {}
    )

    expect(levels).toEqual(new Map([[0, 'unknown']]))
  })
})
