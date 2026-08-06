import { describe, expect, it } from 'vitest'
import type { KnowledgeDetails } from '@src/shared/knowledge'
import type { Token } from '@src/shared/token'
import type { VocabularySpan } from '@src/renderer/src/state/vocabularySpans'
import { buildSubtitleReport } from '@src/renderer/src/state/subtitleReport'
import {
  defaultSelection,
  displayedCandidates,
  deriveMiningCandidates,
  hasTargetDeckMatch,
  hiddenTargetDeckMatchCount,
  hiddenNoDataCount,
  miningSet,
  parseMinimumCount,
  parseThreshold,
  restoreReadyAfterRun,
  summarizeStatuses,
  visibleCandidates,
  type BulkMiningFilters,
  type BulkMiningReadyPhase,
  type MiningCandidate,
  type ResolvedEntry
} from '@src/renderer/src/state/bulkMining'
import { makeLookupResult } from '@test/harness/dictFixtures'
import { makeToken } from '@test/harness/tokenFixtures'

function token(overrides: Partial<Token> = {}): Token {
  return makeToken({ surface: 'word', reading: 'reading', pos: 'noun', ...overrides })
}

function candidate(lemma: string, count = 1, firstOccurrence?: number): MiningCandidate {
  return {
    lemma,
    token: token({ lemma, surface: lemma }),
    sentence: `${lemma} sentence`,
    count,
    firstOccurrence
  }
}

const entry = {
  entry: makeLookupResult({ expression: 'word', reading: 'reading', glossary: '' }),
  frequency: 10
}

function filters(overrides: Partial<BulkMiningFilters> = {}): BulkMiningFilters {
  return {
    maximumFrequency: null,
    minimumCount: null,
    frequencyDictConfigured: true,
    targetDeckMatches: {},
    hideTargetDeckMatches: false,
    ...overrides
  }
}

function span(overrides: Partial<VocabularySpan> = {}): VocabularySpan {
  return {
    cueKey: 'cue-1',
    startOffset: 0,
    endOffset: 4,
    memberTokenOffsets: [0, 2],
    expression: '閻魔様',
    matchedSurface: '閻魔様',
    level: 'unknown',
    ...overrides
  }
}

describe('deriveMiningCandidates', () => {
  it('keeps unknown non-symbol vocabulary with its first token and sentence, ordered by count then occurrence', () => {
    const first = token({ lemma: 'first', surface: 'first-surface' })
    const candidates = deriveMiningCandidates(
      [
        { text: 'first sentence', tokens: [first, token({ lemma: 'tieA' })] },
        { text: 'later sentence', tokens: [token({ lemma: 'first' }), token({ lemma: 'tieB' })] }
      ],
      {}
    )
    expect(candidates.map(({ lemma, count }) => ({ lemma, count }))).toEqual([
      { lemma: 'first', count: 2 },
      { lemma: 'tieA', count: 1 },
      { lemma: 'tieB', count: 1 }
    ])
    expect(candidates[0].token).toBe(first)
    expect(candidates[0].sentence).toBe('first sentence')
  })

  it('excludes symbols, grammar, and lemmas known through a differing surface', () => {
    const details: Record<string, KnowledgeDetails> = {
      inflected: { level: 'known', sourceKinds: [], sources: [] }
    }
    const candidates = deriveMiningCandidates(
      [
        {
          text: 'cue',
          tokens: [
            token({ lemma: '。', surface: '。', pos: 'symbol' }),
            token({ lemma: 'grammar', pos: '助詞' }),
            token({ lemma: 'base', surface: 'inflected' }),
            token({ lemma: 'missing' })
          ]
        }
      ],
      details
    )
    expect(candidates.map((row) => row.lemma)).toEqual(['missing'])
  })

  it('returns no candidates for empty input', () => {
    expect(deriveMiningCandidates([], {})).toEqual([])
  })

  it('aggregates accepted compounds and collapses bare members into the projection', () => {
    const compound = [
      token({ lemma: '閻魔', surface: '閻魔', startOffset: 0 }),
      token({ lemma: '様', surface: '様', startOffset: 2 })
    ]
    const candidates = deriveMiningCandidates(
      [
        { cueKey: 'cue-1', text: '閻魔様だ', tokens: compound, spans: [span()] },
        {
          cueKey: 'cue-2',
          text: '様がいる',
          tokens: [token({ lemma: '様', surface: '様' })],
          spans: []
        }
      ],
      {}
    )

    expect(candidates.map(({ lemma, count, sentence }) => ({ lemma, count, sentence }))).toEqual([
      { lemma: '閻魔様', count: 2, sentence: '閻魔様だ' }
    ])
    expect(candidates[0].token).toMatchObject({
      lemma: '閻魔様',
      surface: '閻魔様',
      startOffset: 0
    })
  })

  it('does not mine a grammar token covered by a single-token projection', () => {
    const grammar = token({ lemma: 'に', surface: 'に', pos: '助詞' })
    expect(
      deriveMiningCandidates(
        [
          {
            cueKey: 'cue-1',
            text: 'に',
            tokens: [grammar],
            spans: [
              span({
                memberTokenOffsets: [grammar.startOffset],
                expression: 'に',
                matchedSurface: 'に'
              })
            ]
          }
        ],
        {}
      )
    ).toEqual([])
  })

  it('does not mine a symbol-only span', () => {
    const symbol = token({ lemma: '。', surface: '。', pos: '記号' })
    expect(
      deriveMiningCandidates(
        [
          {
            cueKey: 'cue-1',
            text: '。',
            tokens: [symbol],
            spans: [span({ memberTokenOffsets: [symbol.startOffset], expression: '記号' })]
          }
        ],
        {}
      )
    ).toEqual([])
  })

  it('counts repeated compounds from their first sentence and respects compound knowledge levels', () => {
    const tokens = [
      token({ lemma: '閻魔', surface: '閻魔', startOffset: 0 }),
      token({ lemma: '様', surface: '様', startOffset: 2 })
    ]
    const candidates = deriveMiningCandidates(
      [
        { cueKey: 'cue-1', text: 'first', tokens, spans: [span()] },
        { cueKey: 'cue-2', text: 'second', tokens, spans: [span({ cueKey: 'cue-2' })] },
        {
          cueKey: 'cue-3',
          text: 'known',
          tokens,
          spans: [
            span({
              cueKey: 'cue-3',
              expression: '大王様',
              matchedSurface: '大王様',
              level: 'known'
            })
          ]
        }
      ],
      {}
    )

    expect(candidates.map(({ lemma, count, sentence }) => ({ lemma, count, sentence }))).toEqual([
      { lemma: '閻魔様', count: 2, sentence: 'first' }
    ])
  })

  it('ignores a span whose cue identity does not match, preventing offset collisions across cues', () => {
    const candidates = deriveMiningCandidates(
      [
        {
          cueKey: 'cue-2',
          text: 'other cue',
          tokens: [
            token({ lemma: '閻魔', surface: '閻魔', startOffset: 0 }),
            token({ lemma: '様', surface: '様', startOffset: 2 })
          ],
          spans: [span({ cueKey: 'cue-1' })]
        }
      ],
      {}
    )

    expect(candidates.map(({ lemma }) => lemma)).toEqual(['閻魔', '様'])
  })

  it('agrees with the report for compound vocabulary rows while token totals count rendered members', () => {
    const accepted = span()
    const compoundTokens = [
      token({ lemma: '閻魔', surface: '閻魔', startOffset: 0 }),
      token({ lemma: '様', surface: '様', startOffset: 2 })
    ]
    const standaloneTokens = [token({ lemma: '様', surface: '様', startOffset: 0 })]
    const miningInput = [
      { cueKey: 'cue-1', text: '閻魔様だ', tokens: compoundTokens, spans: [accepted] },
      { cueKey: 'cue-2', text: '様がいる', tokens: standaloneTokens, spans: [] }
    ]
    const report = buildSubtitleReport(
      [
        { cueKey: 'cue-1', tokens: compoundTokens, acceptedSpans: [accepted] },
        { cueKey: 'cue-2', tokens: standaloneTokens }
      ],
      {}
    )
    const candidates = deriveMiningCandidates(miningInput, {})

    expect(report.topUnknown.map(({ lemma, count }) => ({ lemma, count }))).toEqual(
      candidates.map(({ lemma, count }) => ({ lemma, count }))
    )
    expect(report.totalTokens).toBe(3)
    expect(report.tokenLevels).toEqual({
      unknown: 3,
      inDeck: 0,
      learning: 0,
      known: 0,
      wellKnown: 0
    })
  })

  // `inDeck` (an Anki card exists in a configured known deck, but it is new,
  // suspended, or buried) outranks `unknown`, so the level filter alone drops the
  // word from the candidate set. This does not replace `hideTargetDeckMatches`:
  // that filter is a live membership check against the mining *target* deck and
  // still covers decks that are not configured knowledge sources, and notes added
  // since the last knowledge sync. Both mechanisms coexist by design.
  it('excludes already-mined lemmas whose level is inDeck, by lemma or by surface', () => {
    const details: Record<string, KnowledgeDetails> = {
      mined: { level: 'inDeck', sourceKinds: [], sources: [] },
      minedSurface: { level: 'inDeck', sourceKinds: [], sources: [] }
    }
    const candidates = deriveMiningCandidates(
      [
        {
          text: 'cue',
          tokens: [
            token({ lemma: 'mined', surface: 'mined' }),
            token({ lemma: 'minedBase', surface: 'minedSurface' }),
            token({ lemma: 'fresh', surface: 'fresh' })
          ]
        }
      ],
      details
    )

    expect(candidates.map((row) => row.lemma)).toEqual(['fresh'])
  })

  it('excludes an accepted compound span whose level is inDeck', () => {
    const compound = [
      token({ lemma: '閻魔', surface: '閻魔', startOffset: 0 }),
      token({ lemma: '様', surface: '様', startOffset: 2 })
    ]
    const candidates = deriveMiningCandidates(
      [
        { cueKey: 'cue-1', text: '閻魔様だ', tokens: compound, spans: [span({ level: 'inDeck' })] },
        {
          cueKey: 'cue-2',
          text: '新顔がいる',
          tokens: [token({ lemma: '新顔', surface: '新顔' })],
          spans: []
        }
      ],
      {}
    )

    expect(candidates.map((row) => row.lemma)).toEqual(['新顔'])
  })
})

describe('candidate filtering and selection', () => {
  const candidates = [
    candidate('unresolved'),
    candidate('common'),
    candidate('rare'),
    candidate('noData'),
    candidate('noEntry')
  ]
  const resolved: Record<string, ResolvedEntry> = {
    common: { ...entry, frequency: 50 },
    rare: { ...entry, frequency: 500 },
    noData: { ...entry, frequency: null },
    noEntry: { entry: null, frequency: null }
  }

  it('keeps all candidates without a threshold and ignores one without a configured frequency dictionary', () => {
    expect(visibleCandidates(candidates, resolved, filters())).toEqual(candidates)
    expect(
      visibleCandidates(
        candidates,
        resolved,
        filters({ maximumFrequency: 100, frequencyDictConfigured: false })
      )
    ).toEqual(candidates)
  })

  it('filters resolved frequency rows but keeps unresolved rows and counts hidden no-data rows', () => {
    expect(
      visibleCandidates(candidates, resolved, filters({ maximumFrequency: 100 })).map(
        (row) => row.lemma
      )
    ).toEqual(['unresolved', 'common'])
    expect(hiddenNoDataCount(candidates, resolved, filters({ maximumFrequency: 100 }))).toBe(2)
    expect(hiddenNoDataCount(candidates, resolved, filters())).toBe(0)
    expect(
      hiddenNoDataCount(
        candidates,
        resolved,
        filters({ maximumFrequency: 100, frequencyDictConfigured: false })
      )
    ).toBe(0)
  })

  it('deselects no-entry candidates and mines only visible selected candidates in order', () => {
    const selected = { ...defaultSelection(candidates, resolved), common: false, rare: true }
    expect(defaultSelection(candidates, resolved).noEntry).toBe(false)
    expect(
      miningSet(candidates, resolved, selected, filters({ maximumFrequency: 600 })).map(
        (row) => row.lemma
      )
    ).toEqual(['unresolved', 'rare'])
  })

  it('applies count, frequency, and target-deck filters together without changing selection identity or order', () => {
    const counted = [
      candidate('below', 1, 2),
      candidate('boundary', 2, 1),
      candidate('target', 3, 0),
      candidate('unresolved', 4, 3)
    ]
    const countedResolved = {
      below: { ...entry, frequency: 2 },
      boundary: { ...entry, frequency: 10 },
      target: { ...entry, frequency: 5 }
    }
    const selected = { below: true, boundary: true, target: true, unresolved: true }
    const filter = filters({
      minimumCount: 2,
      maximumFrequency: 10,
      targetDeckMatches: { target: { cardId: 1, deckNames: ['Target'] } },
      hideTargetDeckMatches: true
    })

    expect(visibleCandidates(counted, countedResolved, filter).map((row) => row.lemma)).toEqual([
      'boundary',
      'unresolved'
    ])
    expect(
      displayedCandidates(counted, countedResolved, filter, 'count').map((row) => row.lemma)
    ).toEqual(['unresolved', 'boundary'])
    expect(miningSet(counted, countedResolved, selected, filter).map((row) => row.lemma)).toEqual([
      'unresolved',
      'boundary'
    ])
    expect(selected).toEqual({ below: true, boundary: true, target: true, unresolved: true })
    expect(
      visibleCandidates(
        counted,
        countedResolved,
        filters({ minimumCount: 2, frequencyDictConfigured: false })
      ).map((row) => row.lemma)
    ).toEqual(['boundary', 'target', 'unresolved'])
  })
})

describe('displayedCandidates', () => {
  const candidates = [
    candidate('lateTie', 2, 3),
    candidate('firstTie', 2, 0),
    candidate('common', 5, 2),
    candidate('unresolved', 1, 1),
    candidate('noData', 8, 4),
    candidate('thresholdEdge', 3, 5),
    candidate('overThreshold', 4, 6)
  ]
  const resolved: Record<string, ResolvedEntry> = {
    lateTie: { ...entry, frequency: 20 },
    firstTie: { ...entry, frequency: 20 },
    common: { ...entry, frequency: 10 },
    noData: { ...entry, frequency: null },
    thresholdEdge: { ...entry, frequency: 5000 },
    overThreshold: { ...entry, frequency: 5001 }
  }

  it('filters thresholded rows while retaining unresolved rows and their selection identity', () => {
    const selected = { noData: true, overThreshold: true }
    expect(
      displayedCandidates(candidates, resolved, filters({ maximumFrequency: 5000 }), 'count').map(
        (row) => row.lemma
      )
    ).toEqual(['common', 'thresholdEdge', 'firstTie', 'lateTie', 'unresolved'])
    expect(selected).toEqual({ noData: true, overThreshold: true })
    expect(
      displayedCandidates(candidates, resolved, filters(), 'count').map((row) => row.lemma)
    ).toContain('noData')
    expect(
      displayedCandidates(candidates, resolved, filters(), 'count').map((row) => row.lemma)
    ).toContain('overThreshold')
  })

  it('sorts count and frequency deterministically, including ties, unresolved, and missing data', () => {
    expect(
      displayedCandidates(candidates, resolved, filters(), 'count').map((row) => row.lemma)
    ).toEqual([
      'noData',
      'common',
      'overThreshold',
      'thresholdEdge',
      'firstTie',
      'lateTie',
      'unresolved'
    ])
    expect(
      displayedCandidates(candidates, resolved, filters(), 'frequency').map((row) => row.lemma)
    ).toEqual([
      'common',
      'firstTie',
      'lateTie',
      'thresholdEdge',
      'overThreshold',
      'unresolved',
      'noData'
    ])
  })

  it('uses count ordering when no frequency dictionary is configured', () => {
    expect(
      displayedCandidates(
        candidates,
        resolved,
        filters({ maximumFrequency: 5000, frequencyDictConfigured: false }),
        'count'
      ).map((row) => row.lemma)
    ).toEqual([
      'noData',
      'common',
      'overThreshold',
      'thresholdEdge',
      'firstTie',
      'lateTie',
      'unresolved'
    ])
  })

  it('composes positive target-deck hiding with threshold filtering and sorting', () => {
    const matches = { common: { cardId: 1, deckNames: ['Target'] }, noData: null }
    expect(
      displayedCandidates(
        candidates,
        resolved,
        filters({
          maximumFrequency: 5000,
          targetDeckMatches: matches,
          hideTargetDeckMatches: true
        }),
        'frequency'
      ).map((row) => row.lemma)
    ).toEqual(['firstTie', 'lateTie', 'thresholdEdge', 'unresolved'])
    expect(
      displayedCandidates(
        candidates,
        resolved,
        filters({ maximumFrequency: 5000, targetDeckMatches: matches }),
        'frequency'
      ).map((row) => row.lemma)
    ).toContain('common')
    expect(
      miningSet(
        candidates,
        resolved,
        { common: true, firstTie: true },
        filters({ maximumFrequency: 5000, targetDeckMatches: matches, hideTargetDeckMatches: true })
      ).map((row) => row.lemma)
    ).toEqual(['firstTie'])
  })

  it('uses resolved expressions before lemma fallbacks for every target-deck decision', () => {
    const inflected = candidate('lemma')
    const shared = candidate('other')
    const unresolved = candidate('pending')
    const resolved = {
      lemma: { entry: { ...entry.entry, expression: 'exact-expression' }, frequency: 1 },
      other: { entry: { ...entry.entry, expression: 'exact-expression' }, frequency: 1 }
    }
    const expressionOnly = { 'exact-expression': { cardId: 1, deckNames: ['Target'] }, lemma: null }
    const lemmaFallback = { 'exact-expression': null, lemma: { cardId: 2, deckNames: ['Target'] } }

    expect(hasTargetDeckMatch(inflected, resolved, expressionOnly)).toBe(true)
    expect(hasTargetDeckMatch(inflected, resolved, lemmaFallback)).toBe(true)
    expect(hasTargetDeckMatch(unresolved, resolved, expressionOnly)).toBe(false)
    expect(
      displayedCandidates(
        [inflected, shared, unresolved],
        resolved,
        filters({ targetDeckMatches: expressionOnly, hideTargetDeckMatches: true }),
        'count'
      ).map((row) => row.lemma)
    ).toEqual(['pending'])
    expect(
      miningSet(
        [inflected, shared, unresolved],
        resolved,
        { lemma: true, other: true, pending: true },
        filters({ targetDeckMatches: expressionOnly, hideTargetDeckMatches: true })
      ).map((row) => row.lemma)
    ).toEqual(['pending'])
    expect(
      hiddenTargetDeckMatchCount(
        [inflected, shared, unresolved],
        resolved,
        filters({ targetDeckMatches: expressionOnly, hideTargetDeckMatches: true })
      )
    ).toBe(2)
  })
})

describe('parseThreshold', () => {
  it.each([
    ['', null],
    ['  ', null],
    ['500', 500],
    ['0', null],
    ['-3', null],
    ['abc', null],
    ['1.5', null]
  ])('parses %j as %j', (raw, expected) => expect(parseThreshold(raw)).toBe(expected))
})

describe('parseMinimumCount', () => {
  it.each([
    ['', null],
    ['  ', null],
    ['0', null],
    ['-3', null],
    ['1.5', null],
    ['9007199254740992', null],
    ['1', 1]
  ])('parses %j as %j', (raw, expected) => expect(parseMinimumCount(raw)).toBe(expected))
})

describe('summarizeStatuses', () => {
  it('counts every terminal status and ignores queued and mining states', () => {
    expect(
      summarizeStatuses({
        a: { kind: 'added' },
        b: { kind: 'updated' },
        c: { kind: 'duplicate', deckNames: ['Japanese'] },
        d: { kind: 'noEntry' },
        e: { kind: 'error', message: 'nope' },
        f: { kind: 'cancelled' },
        g: { kind: 'queued' },
        h: { kind: 'mining' }
      })
    ).toEqual({ added: 1, updated: 1, duplicate: 1, noEntry: 1, error: 1, cancelled: 1 })
  })
})

describe('restoreReadyAfterRun', () => {
  const resolvedEntry: ResolvedEntry = { entry: entry.entry, frequency: 10 }
  function ready(overrides: Partial<BulkMiningReadyPhase> = {}): BulkMiningReadyPhase {
    return {
      kind: 'ready',
      candidates: [candidate('a'), candidate('b'), candidate('c'), candidate('d')],
      resolved: { a: resolvedEntry, b: resolvedEntry, c: resolvedEntry, d: resolvedEntry },
      resolving: false,
      selected: { a: true, b: true, c: true, d: true },
      threshold: 5000,
      minimumCount: 2,
      sort: 'frequency',
      targetDeckMatches: {},
      checkingTargetDeck: false,
      hideTargetDeckMatches: true,
      ...overrides
    }
  }

  it('deselects added, updated, and duplicate rows while keeping filters and candidates', () => {
    const restored = restoreReadyAfterRun(ready(), {
      a: { kind: 'added' },
      b: { kind: 'updated' },
      c: { kind: 'duplicate', deckNames: ['Deck'] },
      d: { kind: 'noEntry' }
    })
    expect(restored.selected).toEqual({ a: false, b: false, c: false, d: true })
    expect(restored.threshold).toBe(5000)
    expect(restored.minimumCount).toBe(2)
    expect(restored.sort).toBe('frequency')
    expect(restored.hideTargetDeckMatches).toBe(true)
    expect(restored.candidates).toHaveLength(4)
  })

  it('retains error and cancelled selections so a failed run can be retried', () => {
    const restored = restoreReadyAfterRun(ready(), {
      a: { kind: 'error', message: 'boom' },
      b: { kind: 'cancelled' },
      c: { kind: 'added' }
    })
    expect(restored.selected).toEqual({ a: true, b: true, c: false, d: true })
  })

  it('recomputes resolving as true only when a candidate is still unresolved', () => {
    expect(restoreReadyAfterRun(ready(), {}).resolving).toBe(false)
    const withHole = ready({ resolved: { a: resolvedEntry, b: resolvedEntry, c: resolvedEntry } })
    expect(restoreReadyAfterRun(withHole, {}).resolving).toBe(true)
  })

  it('clears any advisory warning from the prior list state', () => {
    expect(
      restoreReadyAfterRun(ready({ advisoryWarning: 'stale' }), {}).advisoryWarning
    ).toBeUndefined()
  })
})

describe('deriveMiningCandidates cue timing', () => {
  it('retains the first-occurrence cue start/end alongside its sentence', () => {
    const candidates = deriveMiningCandidates(
      [
        { text: 'first', tokens: [token({ lemma: 'first' })], start: 10, end: 12 },
        {
          text: 'later',
          tokens: [token({ lemma: 'first' }), token({ lemma: 'later' })],
          start: 30,
          end: 33
        }
      ],
      {}
    )

    const byLemma = Object.fromEntries(candidates.map((row) => [row.lemma, row]))
    // `first` occurs twice; the earlier cue's timing is the one kept.
    expect(byLemma.first).toEqual(
      expect.objectContaining({ sentence: 'first', cueStart: 10, cueEnd: 12 })
    )
    expect(byLemma.later).toEqual(
      expect.objectContaining({ sentence: 'later', cueStart: 30, cueEnd: 33 })
    )
  })

  it('leaves the timing undefined when the cue carried none', () => {
    const [row] = deriveMiningCandidates([{ text: 'cue', tokens: [token({ lemma: 'a' })] }], {})

    expect(row.cueStart).toBeUndefined()
    expect(row.cueEnd).toBeUndefined()
  })

  it('retains it for a span-derived candidate too', () => {
    const member = token({ lemma: 'part', surface: 'part', startOffset: 0 })
    const span: VocabularySpan = {
      cueKey: 'k',
      startOffset: 0,
      endOffset: 4,
      expression: 'compound',
      matchedSurface: 'part',
      memberTokenOffsets: [0],
      level: 'unknown'
    }

    const [row] = deriveMiningCandidates(
      [{ cueKey: 'k', text: 'cue', tokens: [member], spans: [span], start: 5, end: 7 }],
      {}
    )

    expect(row).toEqual(expect.objectContaining({ lemma: 'compound', cueStart: 5, cueEnd: 7 }))
  })
})
