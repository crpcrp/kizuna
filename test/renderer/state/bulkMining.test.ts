import { describe, expect, it } from 'vitest'
import type { KnowledgeDetails } from '@src/shared/knowledge'
import type { Token } from '@src/shared/token'
import type { VocabularySpan } from '@src/renderer/src/state/vocabularySpans'
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
  type MiningCueTokens,
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
  it('maps first-occurrence context and orders unknown candidates by count then occurrence', () => {
    const first = token({ lemma: 'first', surface: 'first-surface' })
    const candidates = deriveMiningCandidates(
      [
        { text: 'first sentence', tokens: [first, token({ lemma: 'tieA' })], start: 10, end: 12 },
        {
          text: 'later sentence',
          tokens: [token({ lemma: 'first' }), token({ lemma: 'tieB' })],
          start: 30,
          end: 33
        }
      ],
      {}
    )
    expect(candidates).toEqual([
      {
        lemma: 'first',
        token: first,
        sentence: 'first sentence',
        count: 2,
        firstOccurrence: 0,
        cueStart: 10,
        cueEnd: 12
      },
      {
        lemma: 'tieA',
        token: token({ lemma: 'tieA' }),
        sentence: 'first sentence',
        count: 1,
        firstOccurrence: 1,
        cueStart: 10,
        cueEnd: 12
      },
      {
        lemma: 'tieB',
        token: token({ lemma: 'tieB' }),
        sentence: 'later sentence',
        count: 1,
        firstOccurrence: 3,
        cueStart: 30,
        cueEnd: 33
      }
    ])
    expect(candidates[0].token).toBe(first)
    expect(deriveMiningCandidates([], {})).toEqual([])
  })

  it('mines only unknown non-grammar units, including projected units', () => {
    const levels = ['unknown', 'inDeck', 'learning', 'known', 'wellKnown'] as const
    const details: Record<string, KnowledgeDetails> = Object.fromEntries(
      levels.map((level) => [level, { level, sourceKinds: [], sources: [] }])
    )
    const cues: MiningCueTokens[] = levels.map((level) => ({
      cueKey: level,
      text: level,
      tokens: [token({ lemma: `base-${level}`, surface: level })],
      spans: [
        span({
          cueKey: level,
          expression: `projected-${level}`,
          matchedSurface: level,
          memberTokenOffsets: [0],
          level
        })
      ]
    }))
    cues.push({
      cueKey: 'grammar',
      text: 'に',
      tokens: [token({ lemma: 'に', surface: 'に', pos: '助詞' })],
      spans: [
        span({ cueKey: 'grammar', expression: 'に', matchedSurface: 'に', memberTokenOffsets: [0] })
      ]
    })
    expect(deriveMiningCandidates(cues, details).map((row) => row.lemma)).toEqual([
      'projected-unknown'
    ])
    expect(
      deriveMiningCandidates(
        levels.map((level) => ({
          text: level,
          tokens: [token({ lemma: `base-${level}`, surface: level })]
        })),
        details
      ).map((row) => row.lemma)
    ).toEqual(['base-unknown'])
  })

  it('maps compound tokens and timing while leaving an untimed bare member independent', () => {
    const tokens = [
      token({ lemma: '閻魔', surface: '閻魔', startOffset: 0 }),
      token({ lemma: '様', surface: '様', startOffset: 2 })
    ]
    const candidates = deriveMiningCandidates(
      [
        { cueKey: 'cue-1', text: 'first', tokens, spans: [span()], start: 5, end: 7 },
        {
          cueKey: 'cue-2',
          text: 'later',
          tokens,
          spans: [span({ cueKey: 'cue-2' })],
          start: 20,
          end: 22
        },
        { text: 'bare', tokens: [tokens[1]] }
      ],
      {}
    )
    expect(candidates).toEqual([
      {
        lemma: '閻魔様',
        token: { ...tokens[0], lemma: '閻魔様', surface: '閻魔様' },
        sentence: 'first',
        count: 2,
        firstOccurrence: 0,
        cueStart: 5,
        cueEnd: 7
      },
      {
        lemma: '様',
        token: tokens[1],
        sentence: 'bare',
        count: 1,
        firstOccurrence: 2,
        cueStart: undefined,
        cueEnd: undefined
      }
    ])
  })

  it('ignores projections without a cue key instead of accepting an empty-key match', () => {
    const [row] = deriveMiningCandidates(
      [
        {
          text: 'cue',
          tokens: [token({ lemma: 'base' })],
          spans: [span({ cueKey: '', memberTokenOffsets: [0] })]
        }
      ],
      {}
    )
    expect(row.lemma).toBe('base')
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

  it('counts no-frequency rows only when the other filters would keep them', () => {
    const rows = [candidate('kept', 3), candidate('rare', 1), candidate('target', 3)]
    const resolved = Object.fromEntries(
      rows.map(({ lemma }) => [lemma, { ...entry, frequency: null }])
    )
    expect(
      hiddenNoDataCount(
        rows,
        resolved,
        filters({
          maximumFrequency: 5000,
          minimumCount: 2,
          hideTargetDeckMatches: true,
          targetDeckMatches: { target: { cardId: 1, deckNames: ['Mining'] } }
        })
      )
    ).toBe(1)
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
    expect(restored.resolving).toBe(false)
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

  it('clears any advisory warning from the prior list state', () => {
    expect(
      restoreReadyAfterRun(ready({ advisoryWarning: 'stale' }), {}).advisoryWarning
    ).toBeUndefined()
  })
})
