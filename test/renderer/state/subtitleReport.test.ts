import { describe, it, expect } from 'vitest'
import {
  buildSubtitleReport,
  inDeckPct,
  provenanceTotal,
  reportLemmas,
  understandingPct,
  TOP_UNKNOWN_CAP,
  type LevelCounts
} from '@src/renderer/src/state/subtitleReport'
import type { Token } from '@src/shared/token'
import type { KnowledgeDetails } from '@src/shared/knowledge'
import type { VocabularySpan } from '@src/renderer/src/state/vocabularySpans'
import { makeToken } from '@test/harness/tokenFixtures'

function token(overrides: Partial<Token>): Token {
  return makeToken({ surface: '食べる', reading: 'タベル', pos: '動詞', ...overrides })
}

function symbolToken(surface: string): Token {
  return token({ surface, reading: '', lemma: surface, pos: '記号' })
}

const emptyLevels = (): LevelCounts => ({
  unknown: 0,
  inDeck: 0,
  learning: 0,
  known: 0,
  wellKnown: 0
})

function expectProvenanceInvariant(report: ReturnType<typeof buildSubtitleReport>): void {
  expect(provenanceTotal(report.provenance)).toBe(
    report.lemmaLevels.inDeck +
      report.lemmaLevels.learning +
      report.lemmaLevels.known +
      report.lemmaLevels.wellKnown
  )
}

function compoundSpan(overrides: Partial<VocabularySpan> = {}): VocabularySpan {
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

describe('reportLemmas', () => {
  it('excludes symbol tokens (POS 記号, 補助記号, whitespace surface)', () => {
    const tokens = [
      token({ lemma: '食べる' }),
      symbolToken('。'),
      token({ surface: '猫', reading: 'ネコ', lemma: '猫', pos: '名詞、補助記号' }),
      symbolToken(' ')
    ]
    expect(reportLemmas(tokens)).toEqual(['食べる'])
  })

  it('includes each distinct surface that differs from its lemma', () => {
    const tokens = [
      token({ lemma: 'lemma', surface: 'surfaceA' }),
      token({ lemma: 'lemma', surface: 'surfaceB' }),
      token({ lemma: 'lemma', surface: 'surfaceA' })
    ]
    expect(reportLemmas(tokens)).toEqual(['lemma', 'surfaceA', 'surfaceB'])
  })

  it('returns [] for an empty token list', () => {
    expect(reportLemmas([])).toEqual([])
  })
})

describe('buildSubtitleReport', () => {
  it('aggregates a compound once while counting both rendered tokens at its projected level', () => {
    const tokens = [
      token({ lemma: '神', surface: '神', startOffset: 0 }),
      token({ lemma: '様', surface: '様', startOffset: 1 })
    ]
    const report = buildSubtitleReport(
      [{ cueKey: 'cue-1', tokens, acceptedSpans: [compoundSpan({ level: 'known' })] }],
      {}
    )

    expect(report.totalTokens).toBe(2)
    expect(report.tokenLevels).toEqual({ ...emptyLevels(), known: 2 })
    expect(report.uniqueLemmas).toBe(1)
    expect(report.lemmaLevels).toEqual({ ...emptyLevels(), known: 1 })
    expectProvenanceInvariant(report)
    expect(report.topUnknown).toEqual([])
  })

  it('keeps a standalone member independent from a compound occurrence', () => {
    const tokens = [
      token({ lemma: '神', surface: '神', startOffset: 0 }),
      token({ lemma: '様', surface: '様', startOffset: 1 }),
      token({ lemma: '様', surface: '様', startOffset: 3 })
    ]
    const report = buildSubtitleReport(
      [{ cueKey: 'cue-1', tokens, acceptedSpans: [compoundSpan()] }],
      {}
    )

    expectProvenanceInvariant(report)
    expect(report.topUnknown).toEqual([
      { lemma: '神様', surface: '神様', count: 1 },
      { lemma: '様', surface: '様', count: 1 }
    ])
  })

  it('counts repeated compounds by occurrence and preserves their first surface', () => {
    const tokens = [
      token({ lemma: '神', surface: '神', startOffset: 0 }),
      token({ lemma: '様', surface: '様', startOffset: 1 }),
      token({ lemma: '神', surface: '神', startOffset: 3 }),
      token({ lemma: '様', surface: '様', startOffset: 4 })
    ]
    const spans = [
      compoundSpan(),
      compoundSpan({ startOffset: 3, endOffset: 5, memberTokenOffsets: [3, 4] })
    ]

    const report = buildSubtitleReport([{ cueKey: 'cue-1', tokens, acceptedSpans: spans }], {})
    expectProvenanceInvariant(report)
    expect(report.topUnknown).toEqual([{ lemma: '神様', surface: '神様', count: 2 }])
  })

  it('uses each compound occurrence level for tokens and the highest level for its lemma', () => {
    const tokens = [
      token({ lemma: '神', surface: '神', startOffset: 0 }),
      token({ lemma: '様', surface: '様', startOffset: 1 }),
      token({ lemma: '神', surface: '神', startOffset: 3 }),
      token({ lemma: '様', surface: '様', startOffset: 4 })
    ]
    const spans = [
      compoundSpan({ level: 'unknown' }),
      compoundSpan({ startOffset: 3, endOffset: 5, memberTokenOffsets: [3, 4], level: 'learning' })
    ]
    const report = buildSubtitleReport([{ cueKey: 'cue-1', tokens, acceptedSpans: spans }], {})

    expect(report.tokenLevels).toEqual({ ...emptyLevels(), unknown: 2, learning: 2 })
    expect(report.lemmaLevels).toEqual({ ...emptyLevels(), learning: 1 })
    expectProvenanceInvariant(report)
    expect(report.topUnknown).toEqual([])
  })

  it('isolates equal member offsets by cue so an unspanned cue remains standalone', () => {
    const compoundTokens = [
      token({ lemma: '神', surface: '神', startOffset: 0 }),
      token({ lemma: '様', surface: '様', startOffset: 1 })
    ]
    const standaloneTokens = [token({ lemma: '様', surface: '様', startOffset: 1 })]
    const report = buildSubtitleReport(
      [
        { cueKey: 'cue-1', tokens: compoundTokens, acceptedSpans: [compoundSpan()] },
        { cueKey: 'cue-2', tokens: standaloneTokens }
      ],
      {}
    )

    expect(report.totalTokens).toBe(3)
    expectProvenanceInvariant(report)
    expect(report.topUnknown).toEqual([
      { lemma: '神様', surface: '神様', count: 1 },
      { lemma: '様', surface: '様', count: 1 }
    ])
  })

  it('ignores a malformed single-member span and retains both ordinary lemmas', () => {
    const tokens = [
      token({ lemma: '神', surface: '神', startOffset: 0 }),
      token({ lemma: '様', surface: '様', startOffset: 1 })
    ]
    const malformed = compoundSpan({ endOffset: 1, memberTokenOffsets: [0] })

    const report = buildSubtitleReport(
      [{ cueKey: 'cue-1', tokens, acceptedSpans: [malformed] }],
      {}
    )
    expectProvenanceInvariant(report)
    expect(report.topUnknown).toEqual([
      { lemma: '神', surface: '神', count: 1 },
      { lemma: '様', surface: '様', count: 1 }
    ])
  })

  it('ignores spans with a missing member or mismatched cue and retains ordinary lemmas', () => {
    const tokens = [
      token({ lemma: '神', surface: '神', startOffset: 0 }),
      token({ lemma: '様', surface: '様', startOffset: 1 })
    ]
    const missingMember = compoundSpan({ memberTokenOffsets: [0, 2] })
    const mismatchedCue = compoundSpan({ cueKey: 'cue-2' })
    const report = buildSubtitleReport(
      [{ cueKey: 'cue-1', tokens, acceptedSpans: [missingMember, mismatchedCue] }],
      {}
    )

    expect(report.uniqueLemmas).toBe(2)
    expectProvenanceInvariant(report)
    expect(report.topUnknown.map((row) => row.lemma)).toEqual(['神', '様'])
  })

  it('excludes symbol tokens from every count including topUnknown', () => {
    const tokens = [
      symbolToken('「'),
      token({ lemma: '猫', surface: '猫', reading: 'ネコ', pos: '補助記号' }),
      symbolToken(' '),
      symbolToken('。')
    ]
    const report = buildSubtitleReport(tokens, {})
    expect(report.totalTokens).toBe(0)
    expect(report.uniqueLemmas).toBe(0)
    expectProvenanceInvariant(report)
    expect(report.topUnknown).toEqual([])
  })

  it('counts a repeated lemma per-token and per-lemma separately', () => {
    const details: Record<string, KnowledgeDetails> = {
      食べる: { level: 'known', sourceKinds: [], sources: [] }
    }
    const tokens = [
      token({ lemma: '食べる' }),
      token({ lemma: '食べる' }),
      token({ lemma: '食べる' })
    ]
    const report = buildSubtitleReport(tokens, details)
    expect(report.totalTokens).toBe(3)
    expect(report.uniqueLemmas).toBe(1)
    expect(report.tokenLevels.known).toBe(3)
    expect(report.lemmaLevels.known).toBe(1)
    expectProvenanceInvariant(report)
  })

  it('treats a lemma missing from details as unknown and lists it in topUnknown', () => {
    const tokens = [token({ lemma: '謎' })]
    const report = buildSubtitleReport(tokens, {})
    expect(report.tokenLevels.unknown).toBe(1)
    expect(report.lemmaLevels.unknown).toBe(1)
    expectProvenanceInvariant(report)
    expect(report.topUnknown).toEqual([{ lemma: '謎', surface: '食べる', count: 1 }])
  })

  it('uses differing-surface details for level, provenance, decks, and topUnknown', () => {
    const surfaceDetails: KnowledgeDetails = {
      level: 'known',
      sourceKinds: ['anki'],
      sources: [{ source: 'anki', deck: 'Listening', intervalDays: 192, cardId: 1, noteId: 1 }]
    }
    const report = buildSubtitleReport([token({ lemma: 'properNounLemma', surface: '悟空' })], {
      悟空: surfaceDetails
    })

    expect(report.tokenLevels.known).toBe(1)
    expect(report.lemmaLevels.known).toBe(1)
    expectProvenanceInvariant(report)
    expect(report.provenance.ankiOnly).toBe(1)
    expect(report.ankiDecks).toEqual([{ deck: 'Listening', lemmaCount: 1 }])
    expect(report.topUnknown).toEqual([])
  })

  it('uses the highest level and combines sources across lemma and surfaces', () => {
    const report = buildSubtitleReport([token({ lemma: 'lemma', surface: 'surface' })], {
      lemma: {
        level: 'learning',
        sourceKinds: ['wanikani'],
        sources: [{ source: 'wanikani', curriculumLevel: 1, proficiency: 'apprentice' }]
      },
      surface: {
        level: 'wellKnown',
        sourceKinds: ['anki'],
        sources: [{ source: 'anki', deck: 'Core', intervalDays: 100, cardId: 1, noteId: 1 }]
      }
    })

    expect(report.lemmaLevels.wellKnown).toBe(1)
    expectProvenanceInvariant(report)
    expect(report.provenance.both).toBe(1)
  })

  it('classifies provenance from source kinds even when metadata is missing', () => {
    const details: Record<string, KnowledgeDetails> = {
      both: {
        level: 'known',
        sourceKinds: ['wanikani', 'anki'],
        sources: [
          { source: 'wanikani', curriculumLevel: 5, proficiency: 'burned' },
          { source: 'anki', deck: 'Core', intervalDays: 30, cardId: 1, noteId: 1 }
        ]
      },
      wkOnly: {
        level: 'known',
        sourceKinds: ['wanikani'],
        sources: [{ source: 'wanikani', curriculumLevel: 3, proficiency: 'guru' }]
      },
      ankiOnly: {
        level: 'known',
        sourceKinds: ['anki'],
        sources: [{ source: 'anki', deck: 'Core', intervalDays: 10, cardId: 2, noteId: 2 }]
      },
      incompleteAnki: { level: 'known', sourceKinds: ['anki'], sources: [] },
      unknownLemma: { level: 'unknown', sourceKinds: [], sources: [] }
    }
    const tokens = [
      token({ lemma: 'both' }),
      token({ lemma: 'wkOnly' }),
      token({ lemma: 'ankiOnly' }),
      token({ lemma: 'incompleteAnki' }),
      token({ lemma: 'unknownLemma' })
    ]
    const report = buildSubtitleReport(tokens, details)
    expectProvenanceInvariant(report)
    expect(report.provenance).toEqual({
      wanikaniOnly: 1,
      ankiOnly: 2,
      both: 1,
      grammar: 0,
      unsourced: 0
    })
  })

  it('attributes a projected compound from the expression source kind', () => {
    const report = buildSubtitleReport(
      [
        {
          cueKey: 'cue-1',
          tokens: [
            token({ lemma: '神', surface: '神', startOffset: 0 }),
            token({ lemma: '様', surface: '様', startOffset: 1 })
          ],
          acceptedSpans: [compoundSpan({ level: 'known' })]
        }
      ],
      { 神様: { level: 'known', sourceKinds: ['wanikani'], sources: [] } }
    )

    expectProvenanceInvariant(report)
    expect(report.provenance).toEqual({
      wanikaniOnly: 1,
      ankiOnly: 0,
      both: 0,
      grammar: 0,
      unsourced: 0
    })
  })

  it('does not mutate details when applying a projected compound level', () => {
    const expressionDetails = Object.freeze({
      level: 'learning' as const,
      sourceKinds: ['wanikani' as const],
      sources: []
    })
    const details: Record<string, KnowledgeDetails> = { 神様: expressionDetails }

    const report = buildSubtitleReport(
      [
        {
          cueKey: 'cue-1',
          tokens: [
            token({ lemma: '神', surface: '神', startOffset: 0 }),
            token({ lemma: '様', surface: '様', startOffset: 1 })
          ],
          acceptedSpans: [compoundSpan({ level: 'known' })]
        }
      ],
      details
    )

    expectProvenanceInvariant(report)
    expect(details.神様.level).toBe('learning')
  })

  it('deduplicates decks per lemma and sorts rows count desc then name asc', () => {
    const details: Record<string, KnowledgeDetails> = {
      twoCardsOneDeck: {
        level: 'known',
        sourceKinds: ['anki'],
        sources: [
          { source: 'anki', deck: 'A', intervalDays: 5, cardId: 1, noteId: 1 },
          { source: 'anki', deck: 'A', intervalDays: 8, cardId: 2, noteId: 2 }
        ]
      },
      twoDecks: {
        level: 'known',
        sourceKinds: ['anki'],
        sources: [
          { source: 'anki', deck: 'A', intervalDays: 5, cardId: 3, noteId: 3 },
          { source: 'anki', deck: 'B', intervalDays: 5, cardId: 4, noteId: 4 }
        ]
      },
      onlyB: {
        level: 'known',
        sourceKinds: ['anki'],
        sources: [{ source: 'anki', deck: 'B', intervalDays: 5, cardId: 5, noteId: 5 }]
      }
    }
    const tokens = [
      token({ lemma: 'twoCardsOneDeck' }),
      token({ lemma: 'twoDecks' }),
      token({ lemma: 'onlyB' })
    ]
    const report = buildSubtitleReport(tokens, details)
    expectProvenanceInvariant(report)
    expect(report.ankiDecks).toEqual([
      { deck: 'A', lemmaCount: 2 },
      { deck: 'B', lemmaCount: 2 }
    ])
  })

  it('sorts topUnknown by count desc, tie-breaks by first occurrence, caps at TOP_UNKNOWN_CAP', () => {
    const tokens: Token[] = []
    // 16 distinct unknown lemmas in first-occurrence order, lemma00 having the
    // highest count so it's guaranteed to survive the cap despite being first.
    for (let i = 0; i < 16; i++) {
      const lemma = `lemma${String(i).padStart(2, '0')}`
      const occurrences = i === 0 ? 5 : 1
      for (let n = 0; n < occurrences; n++) {
        tokens.push(token({ lemma, surface: lemma, reading: '' }))
      }
    }
    const report = buildSubtitleReport(tokens, {})
    expectProvenanceInvariant(report)
    expect(report.topUnknown).toHaveLength(TOP_UNKNOWN_CAP)
    expect(report.topUnknown[0]).toEqual({ lemma: 'lemma00', surface: 'lemma00', count: 5 })
    // remaining entries are the count-1 lemmas in first-occurrence order
    expect(report.topUnknown.slice(1).map((r) => r.lemma)).toEqual(
      Array.from(
        { length: TOP_UNKNOWN_CAP - 1 },
        (_, i) => `lemma${String(i + 1).padStart(2, '0')}`
      )
    )
  })

  it('returns an all-zero report with empty arrays for an empty token list', () => {
    const report = buildSubtitleReport([], {})
    expect(report.totalTokens).toBe(0)
    expect(report.uniqueLemmas).toBe(0)
    expect(report.tokenLevels).toEqual(emptyLevels())
    expect(report.lemmaLevels).toEqual(emptyLevels())
    expectProvenanceInvariant(report)
    expect(report.provenance).toEqual({
      wanikaniOnly: 0,
      ankiOnly: 0,
      both: 0,
      grammar: 0,
      unsourced: 0
    })
    expect(report.ankiDecks).toEqual([])
    expect(report.topUnknown).toEqual([])
  })

  it('counts grammar lemmas (助詞/助動詞) as wellKnown in both weightings (QA-4)', () => {
    const tokens = [
      token({ lemma: 'に', surface: 'に', pos: '助詞,格助詞' }),
      token({ lemma: 'に', surface: 'に', pos: '助詞,格助詞' }),
      token({ lemma: 'だ', surface: 'な', pos: '助動詞' }),
      token({ lemma: '謎' })
    ]
    const report = buildSubtitleReport(tokens, {})
    expect(report.tokenLevels.wellKnown).toBe(3)
    expect(report.lemmaLevels.wellKnown).toBe(2)
    expect(report.tokenLevels.unknown).toBe(1)
    expect(report.lemmaLevels.unknown).toBe(1)
    expectProvenanceInvariant(report)
    expect(report.provenance.grammar).toBe(2)
    expect(report.topUnknown.map((r) => r.lemma)).toEqual(['謎'])
  })

  it('accounts grammar lemmas separately from Anki provenance and decks (QA-4)', () => {
    const details: Record<string, KnowledgeDetails> = {
      に: {
        level: 'learning',
        sourceKinds: ['anki'],
        sources: [{ source: 'anki', deck: 'Core', intervalDays: 3, cardId: 1, noteId: 1 }]
      }
    }
    const report = buildSubtitleReport(
      [token({ lemma: 'に', surface: 'に', pos: '助詞,格助詞' })],
      details
    )
    expect(report.lemmaLevels.wellKnown).toBe(1)
    expect(report.lemmaLevels.learning).toBe(0)
    expectProvenanceInvariant(report)
    expect(report.provenance.grammar).toBe(1)
    expect(report.provenance.ankiOnly).toBe(0)
    expect(report.topUnknown).toEqual([])
    expect(report.provenance).toEqual({
      wanikaniOnly: 0,
      ankiOnly: 0,
      both: 0,
      grammar: 1,
      unsourced: 0
    })
    expect(report.ankiDecks).toEqual([])
  })

  it('keeps level and source breakdowns aligned for a mixed track', () => {
    const tokens = [
      token({ lemma: 'に', surface: 'に', pos: '助詞,格助詞', startOffset: 0 }),
      token({ lemma: 'wkOnly', surface: 'wkOnly', startOffset: 1 }),
      token({ lemma: 'ankiOnly', surface: 'ankiOnly', startOffset: 2 }),
      token({ lemma: 'both', surface: 'both', startOffset: 3 }),
      token({ lemma: '神', surface: '神', startOffset: 4 }),
      token({ lemma: '様', surface: '様', startOffset: 5 })
    ]
    const details: Record<string, KnowledgeDetails> = {
      に: {
        level: 'learning',
        sourceKinds: ['anki'],
        sources: [{ source: 'anki', deck: 'Grammar', intervalDays: 3, cardId: 1, noteId: 1 }]
      },
      wkOnly: { level: 'known', sourceKinds: ['wanikani'], sources: [] },
      ankiOnly: {
        level: 'known',
        sourceKinds: ['anki'],
        sources: [{ source: 'anki', deck: 'Core', intervalDays: 10, cardId: 2, noteId: 2 }]
      },
      both: {
        level: 'known',
        sourceKinds: ['wanikani', 'anki'],
        sources: [{ source: 'anki', deck: 'Both', intervalDays: 30, cardId: 3, noteId: 3 }]
      }
    }
    const report = buildSubtitleReport(
      [
        {
          cueKey: 'cue-1',
          tokens,
          acceptedSpans: [
            compoundSpan({
              startOffset: 4,
              endOffset: 6,
              memberTokenOffsets: [4, 5],
              level: 'known'
            })
          ]
        }
      ],
      details
    )

    expectProvenanceInvariant(report)
    expect(report.provenance).toEqual({
      wanikaniOnly: 1,
      ankiOnly: 1,
      both: 1,
      grammar: 1,
      unsourced: 1
    })
    expect(report.ankiDecks).toEqual([
      { deck: 'Both', lemmaCount: 1 },
      { deck: 'Core', lemmaCount: 1 }
    ])
  })

  it('treats a lemma as grammar when any occurrence has a grammar POS, not just the first (QA-4)', () => {
    const tokens = [
      token({ lemma: 'だ', surface: 'だ', pos: '動詞' }),
      token({ lemma: 'だ', surface: 'な', pos: '助動詞' })
    ]
    const report = buildSubtitleReport(tokens, {})
    expect(report.tokenLevels.wellKnown).toBe(2)
    expect(report.lemmaLevels.wellKnown).toBe(1)
    expectProvenanceInvariant(report)
    expect(report.provenance.grammar).toBe(1)
    expect(report.topUnknown).toEqual([])
  })

  it('always has every LevelCounts key present even when zero', () => {
    const report = buildSubtitleReport([token({ lemma: 'x' })], {
      x: { level: 'wellKnown', sourceKinds: [], sources: [] }
    })
    expectProvenanceInvariant(report)
    expect(Object.keys(report.tokenLevels).sort()).toEqual(
      ['inDeck', 'known', 'learning', 'unknown', 'wellKnown'].sort()
    )
    expect(Object.keys(report.lemmaLevels).sort()).toEqual(
      ['inDeck', 'known', 'learning', 'unknown', 'wellKnown'].sort()
    )
    expect(report.tokenLevels.unknown).toBe(0)
    expect(report.tokenLevels.inDeck).toBe(0)
    expect(report.tokenLevels.learning).toBe(0)
    expect(report.tokenLevels.known).toBe(0)
  })

  it('counts an inDeck lemma in its own level, keeps it out of topUnknown, and still credits its Anki provenance', () => {
    const details: Record<string, KnowledgeDetails> = {
      新しい: {
        level: 'inDeck',
        sourceKinds: ['anki'],
        sources: [{ source: 'anki', deck: 'Mining', intervalDays: 0, cardId: 1, noteId: 1 }]
      }
    }
    const tokens = [
      token({ lemma: '新しい', surface: '新しい' }),
      token({ lemma: '新しい', surface: '新しい' }),
      token({ lemma: '謎', surface: '謎' })
    ]
    const report = buildSubtitleReport(tokens, details)

    expect(report.tokenLevels.inDeck).toBe(2)
    expect(report.lemmaLevels.inDeck).toBe(1)
    expectProvenanceInvariant(report)
    expect(report.topUnknown.map((row) => row.lemma)).toEqual(['謎'])
    expect(report.provenance).toEqual({
      wanikaniOnly: 0,
      ankiOnly: 1,
      both: 0,
      grammar: 0,
      unsourced: 0
    })
    expect(report.ankiDecks).toEqual([{ deck: 'Mining', lemmaCount: 1 }])
  })

  it('counts an accepted span whose level is inDeck under inDeck, not unknown', () => {
    const tokens = [
      token({ lemma: '神', surface: '神', startOffset: 0 }),
      token({ lemma: '様', surface: '様', startOffset: 1 })
    ]
    const report = buildSubtitleReport(
      [{ cueKey: 'cue-1', tokens, acceptedSpans: [compoundSpan({ level: 'inDeck' })] }],
      {}
    )

    expect(report.tokenLevels).toEqual({ ...emptyLevels(), inDeck: 2 })
    expect(report.lemmaLevels).toEqual({ ...emptyLevels(), inDeck: 1 })
    expectProvenanceInvariant(report)
    expect(report.topUnknown).toEqual([])
  })
})

describe('understandingPct', () => {
  it('rounds mixed levels to one decimal; learning does not count as understood', () => {
    const levels: LevelCounts = { ...emptyLevels(), unknown: 1, learning: 1, known: 1 }
    expect(understandingPct(levels)).toBe(33.3)
  })

  it('returns 0 (not NaN) when total is 0', () => {
    expect(understandingPct(emptyLevels())).toBe(0)
  })

  it('counts both known and wellKnown as understood', () => {
    const levels: LevelCounts = { ...emptyLevels(), known: 1, wellKnown: 1 }
    expect(understandingPct(levels)).toBe(100)
  })

  it('is unchanged when a word moves from unknown to inDeck (denominator-only)', () => {
    const unknown: LevelCounts = { ...emptyLevels(), unknown: 2, known: 2 }
    const mined: LevelCounts = { ...emptyLevels(), unknown: 1, inDeck: 1, known: 2 }
    expect(understandingPct(mined)).toBe(understandingPct(unknown))
    expect(understandingPct(mined)).toBe(50)
  })
})

describe('inDeckPct', () => {
  it('returns the inDeck share of all levels, rounded to one decimal', () => {
    expect(inDeckPct({ ...emptyLevels(), unknown: 2, inDeck: 1 })).toBe(33.3)
    expect(inDeckPct({ ...emptyLevels(), inDeck: 4 })).toBe(100)
  })

  it('returns 0 when there are no inDeck words and 0 (not NaN) when total is 0', () => {
    expect(inDeckPct({ ...emptyLevels(), known: 3 })).toBe(0)
    expect(inDeckPct(emptyLevels())).toBe(0)
  })
})
