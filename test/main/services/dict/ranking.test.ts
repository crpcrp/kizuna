import { describe, it, expect } from 'vitest'
import { sortByFrequency } from '@src/main/services/dict/ranking'
import type { LookupResult } from '@src/shared/dictionary'

function makeResult(overrides: Partial<LookupResult>): LookupResult {
  return {
    expression: '猫',
    reading: 'ねこ',
    glossary: 'cat',
    dictTitle: 'Enabled Dict',
    dictId: 1,
    stylesCss: null,
    frequency: null,
    frequencyDisplay: null,
    pitchAccent: null,
    defTags: '',
    termTags: '',
    score: 0,
    rules: '',
    ...overrides
  }
}

describe('sortByFrequency', () => {
  it('rank-based mode puts the lower frequency value first (lower rank = more common)', () => {
    const a = makeResult({ expression: 'a', frequency: 50 })
    const b = makeResult({ expression: 'b', frequency: 5 })
    const sorted = sortByFrequency([a, b], 'rank-based')
    expect(sorted.map((r) => r.expression)).toEqual(['b', 'a'])
  })

  it('occurrence-based mode puts the higher frequency value first', () => {
    const a = makeResult({ expression: 'a', frequency: 50 })
    const b = makeResult({ expression: 'b', frequency: 5 })
    const sorted = sortByFrequency([a, b], 'occurrence-based')
    expect(sorted.map((r) => r.expression)).toEqual(['a', 'b'])
  })

  it('places null-frequency entries last, keeping their original relative order, regardless of mode', () => {
    const a = makeResult({ expression: 'a', frequency: null })
    const b = makeResult({ expression: 'b', frequency: 20 })
    const c = makeResult({ expression: 'c', frequency: null })
    const d = makeResult({ expression: 'd', frequency: 10 })
    const sortedRank = sortByFrequency([a, b, c, d], 'rank-based')
    expect(sortedRank.map((r) => r.expression)).toEqual(['d', 'b', 'a', 'c'])
    const sortedOccurrence = sortByFrequency([a, b, c, d], 'occurrence-based')
    expect(sortedOccurrence.map((r) => r.expression)).toEqual(['b', 'd', 'a', 'c'])
  })

  it('does not mutate the input array', () => {
    const a = makeResult({ expression: 'a', frequency: 50 })
    const b = makeResult({ expression: 'b', frequency: 5 })
    const input = [a, b]
    sortByFrequency(input, 'rank-based')
    expect(input.map((r) => r.expression)).toEqual(['a', 'b'])
  })

  it('puts the longest expression first even when its frequency is worse (higher) than a shorter match', () => {
    // Reproduces the 閻魔大王 bug: the compound (long, rarer) must lead over
    // its shorter, more-common constituent once frequency sorting is on.
    const compound = makeResult({ expression: '閻魔大王', frequency: 8000 })
    const constituent = makeResult({ expression: '閻魔', frequency: 200 })
    const sorted = sortByFrequency([constituent, compound], 'rank-based')
    expect(sorted.map((r) => r.expression)).toEqual(['閻魔大王', '閻魔'])
  })

  it('breaks ties by frequency only within the same expression length', () => {
    const long = makeResult({ expression: '閻魔大王', frequency: 10 })
    const shortRare = makeResult({ expression: '閻魔', frequency: 500 })
    const shortCommon = makeResult({ expression: '閻魔', frequency: 50 })
    const shortest = makeResult({ expression: '閻', frequency: null })
    const sorted = sortByFrequency([shortRare, long, shortest, shortCommon], 'rank-based')
    expect(sorted.map((r) => r.expression)).toEqual(['閻魔大王', '閻魔', '閻魔', '閻'])
    expect(sorted[1].frequency).toBe(50)
    expect(sorted[2].frequency).toBe(500)
  })
})
