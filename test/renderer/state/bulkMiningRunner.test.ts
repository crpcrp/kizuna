import { describe, expect, it } from 'vitest'
import type { LookupResult } from '@src/shared/dictionary'
import type { Token } from '@src/shared/token'
import type { MiningCandidate, ResolvedEntry } from '@src/renderer/src/state/bulkMining'
import type { DictLookupBridge, SubtitleRequestToken } from '@src/renderer/src/state/playerActions'
import { resolveCandidateEntries } from '@src/renderer/src/state/bulkMiningRunner'

function token(overrides: Partial<Token> = {}): Token {
  return {
    surface: 'surface',
    reading: 'reading',
    lemma: 'lemma',
    pos: 'noun',
    startOffset: 0,
    ...overrides
  }
}

function candidate(lemma: string, overrides: Partial<Token> = {}): MiningCandidate {
  return {
    lemma,
    token: token({ lemma, surface: lemma, ...overrides }),
    sentence: `${lemma} sentence`,
    count: 1
  }
}

function result(expression: string, frequency: number | null): LookupResult {
  return {
    expression,
    reading: '',
    glossary: '',
    dictTitle: 'test',
    dictId: 1,
    stylesCss: null,
    frequency,
    frequencyDisplay: null,
    pitchAccent: null,
    defTags: '',
    termTags: '',
    score: 0,
    rules: ''
  }
}

function fakeDict(
  handler: (...args: Parameters<DictLookupBridge['lookup']>) => Promise<LookupResult[]>
): DictLookupBridge {
  return { lookup: handler }
}

describe('resolveCandidateEntries', () => {
  it('uses the candidate headword frequency when a surface result is ranked first', async () => {
    const calls: unknown[][] = []
    const dict = fakeDict(async (...args) => {
      calls.push(args)
      return args[0] === 'written'
        ? [result('written-form', 1), result('written', 30)]
        : [result('same', 34)]
    })
    const patches: Record<string, ResolvedEntry>[] = []

    await resolveCandidateEntries(
      dict,
      [candidate('written', { surface: 'written-form' }), candidate('same')],
      {},
      { frequencyDictId: 7, sortOrder: 'rank-based' },
      { current: 0 },
      (patch) => patches.push(patch)
    )

    expect(calls).toEqual([
      ['written', 'reading', 7, 'rank-based', ['written-form'], 'written-form'],
      ['same', 'reading', 7, 'rank-based', undefined, 'same']
    ])
    expect(patches).toEqual([
      {
        written: { entry: result('written', 30), frequency: 30 },
        same: { entry: result('same', 34), frequency: 34 }
      }
    ])
  })

  it('skips resolved lemmas, turns empty or rejected lookups into null entries, and continues', async () => {
    const calls: string[] = []
    const dict = fakeDict(async (lemma) => {
      calls.push(lemma)
      if (lemma === 'broken') throw new Error('dictionary unavailable')
      return []
    })
    const patches: Record<string, ResolvedEntry>[] = []
    const existing = { entry: result('cached', 1), frequency: 1 }

    await resolveCandidateEntries(
      dict,
      [candidate('cached'), candidate('empty'), candidate('broken')],
      { cached: existing },
      { frequencyDictId: null, sortOrder: 'auto' },
      { current: 0 },
      (patch) => patches.push(patch)
    )

    expect(calls).toEqual(['empty', 'broken'])
    expect(patches).toEqual([
      { empty: { entry: null, frequency: null }, broken: { entry: null, frequency: null } }
    ])
  })

  it('emits only completed chunk patches and stops silently when its request is superseded', async () => {
    const cancelToken: SubtitleRequestToken = { current: 3 }
    const calls: string[] = []
    const dict = fakeDict(async (lemma) => {
      calls.push(lemma)
      if (lemma === 'second') cancelToken.current++
      return [result(lemma, 1)]
    })
    const patches: Record<string, ResolvedEntry>[] = []

    await resolveCandidateEntries(
      dict,
      [candidate('first'), candidate('second'), candidate('third')],
      {},
      { frequencyDictId: null, chunkSize: 2 },
      cancelToken,
      (patch) => patches.push(patch)
    )

    expect(calls).toEqual(['first', 'second'])
    expect(patches).toEqual([])
  })

  it('does not touch the bridge for zero candidates', async () => {
    const dict = fakeDict(async () => {
      throw new Error('should not be called')
    })
    const patches: Record<string, ResolvedEntry>[] = []

    await resolveCandidateEntries(
      dict,
      [],
      {},
      { frequencyDictId: null },
      { current: 0 },
      (patch) => patches.push(patch)
    )

    expect(patches).toEqual([])
  })
})
