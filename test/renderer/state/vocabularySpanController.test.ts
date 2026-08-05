import { describe, expect, it, vi } from 'vitest'
import type { LookupResult } from '@src/shared/dictionary'
import type { Token } from '@src/shared/token'
import {
  createVocabularySpanController,
  retryStaleVocabularySpanResolve,
  type VocabularySpanEpoch
} from '@src/renderer/src/state/vocabularySpanController'
import { deriveMiningCandidates } from '@src/renderer/src/state/bulkMining'
import { makeLookupResult } from '@test/harness/dictFixtures'

const epoch: VocabularySpanEpoch = {
  file: 1,
  track: 1,
  tokenization: 1,
  dictionary: 1,
  knowledge: 1
}
const token = (surface: string, startOffset: number): Token => ({
  surface,
  startOffset,
  lemma: surface,
  reading: '',
  pos: 'noun'
})
const result = (expression: string, matchedSurface = expression): LookupResult =>
  makeLookupResult({ expression, matchedSurface, reading: expression, glossary: '' })
const deferred = <T>() => {
  let resolve!: (value: T) => void
  return {
    promise: new Promise<T>((done) => {
      resolve = done
    }),
    resolve
  }
}

describe('vocabulary span controller', () => {
  it('returns a stale resolution once without retrying', async () => {
    const resolve = vi.fn().mockResolvedValue({ kind: 'stale' })
    const isCurrent = vi.fn().mockReturnValue(true)

    await expect(retryStaleVocabularySpanResolve(resolve, isCurrent)).resolves.toEqual({
      kind: 'stale'
    })
    expect(resolve).toHaveBeenCalledOnce()
    expect(isCurrent).not.toHaveBeenCalled()
  })

  it('joins identical concurrent requests and performs each lookup once', async () => {
    const controller = createVocabularySpanController()
    const lookup = deferred<LookupResult[]>()
    const dict = { lookup: vi.fn(() => lookup.promise) }
    const knowledge = { detailsFor: vi.fn().mockResolvedValue({}) }
    const input = {
      dict,
      knowledge,
      frequencyDictId: null,
      epoch,
      cues: [{ cueKey: 'one', tokens: [token('A', 0)] }]
    }

    const first = controller.resolve(input)
    const second = controller.resolve(input)
    expect(second).toBe(first)
    expect(dict.lookup).toHaveBeenCalledOnce()

    lookup.resolve([result('A')])
    await expect(first).resolves.toMatchObject({ kind: 'resolved', spansByCue: { one: [] } })
    expect(knowledge.detailsFor).toHaveBeenCalledWith(['A'])
  })

  it('deduplicates identical lookups while retaining a span for every cue offset', async () => {
    const controller = createVocabularySpanController()
    const dict = { lookup: vi.fn().mockResolvedValue([result('AB', 'A')]) }
    const knowledge = { detailsFor: vi.fn().mockResolvedValue({}) }

    const resolved = await controller.resolve({
      dict,
      knowledge,
      frequencyDictId: null,
      epoch,
      cues: [
        { cueKey: 'first', tokens: [token('A', 0)] },
        { cueKey: 'second', tokens: [token('A', 4)] }
      ]
    })

    expect(dict.lookup).toHaveBeenCalledOnce()
    expect(resolved).toEqual({
      kind: 'resolved',
      spansByCue: {
        first: [expect.objectContaining({ cueKey: 'first', startOffset: 0, endOffset: 1 })],
        second: [expect.objectContaining({ cueKey: 'second', startOffset: 4, endOffset: 5 })]
      }
    })
  })

  it('keeps lookup requests distinct when their surface, reading, or candidates differ', async () => {
    const controller = createVocabularySpanController()
    const first = { ...token('A', 0), lemma: 'same', reading: 'one' }
    const second = { ...token('B', 0), lemma: 'same', reading: 'two' }
    const third = { ...token('A', 0), lemma: 'same', reading: 'one' }
    const suffix = token('C', 1)
    const dict = { lookup: vi.fn().mockResolvedValue([]) }
    const knowledge = { detailsFor: vi.fn().mockResolvedValue({}) }

    await controller.resolve({
      dict,
      knowledge,
      frequencyDictId: null,
      epoch,
      cues: [
        { cueKey: 'surface', tokens: [first] },
        { cueKey: 'reading', tokens: [second] },
        { cueKey: 'candidates', tokens: [third, suffix] }
      ]
    })

    expect(dict.lookup).toHaveBeenCalledTimes(4)
  })

  it('projects a known compound while leaving a standalone suffix unknown', async () => {
    const controller = createVocabularySpanController()
    const dict = {
      lookup: vi.fn((lemma: string) => Promise.resolve([result(lemma === '神' ? '神様' : lemma)]))
    }
    const knowledge = {
      detailsFor: vi
        .fn()
        .mockResolvedValue({ 神様: { level: 'known', sourceKinds: [], sources: [] } })
    }
    const resolved = await controller.resolve({
      dict,
      knowledge,
      frequencyDictId: null,
      epoch,
      cues: [{ cueKey: 'one', tokens: [token('神', 0), token('様', 1), token('様', 3)] }]
    })

    expect(resolved).toEqual({
      kind: 'resolved',
      spansByCue: {
        one: [
          expect.objectContaining({
            expression: '神様',
            memberTokenOffsets: [0, 1],
            level: 'known'
          })
        ]
      }
    })
    expect(dict.lookup).toHaveBeenCalledWith(
      '神',
      undefined,
      null,
      undefined,
      ['神様様', '神様', '神'],
      '神'
    )
    expect(knowledge.detailsFor).toHaveBeenCalledWith(['神様', '様'])
  })

  it('keeps the whole subtitle match across split and single-token contexts', async () => {
    const controller = createVocabularySpanController()
    const niShite = token('にして', 3)
    const mo = token('も', 6)
    const fused = { ...token('にしても', 3), lemma: 'にして' }
    // Real lookup ranks the exact whole-surface written match (にしても) above
    // the bare-lemma match; the projection keys off that top-ranked result.
    const dict = {
      lookup: vi.fn((lemma: string) =>
        Promise.resolve(lemma === 'にして' ? [result('にしても'), result('にして')] : [])
      )
    }
    const knowledge = { detailsFor: vi.fn().mockResolvedValue({}) }
    const resolved = await controller.resolve({
      dict,
      knowledge,
      frequencyDictId: 7,
      epoch,
      cues: [
        { cueKey: 'split', tokens: [niShite, mo] },
        { cueKey: 'fused', tokens: [fused] }
      ]
    })

    expect(resolved).toEqual({
      kind: 'resolved',
      spansByCue: {
        split: [
          expect.objectContaining({
            expression: 'にしても',
            matchedSurface: 'にしても',
            memberTokenOffsets: [3, 6]
          })
        ],
        fused: [
          expect.objectContaining({
            expression: 'にしても',
            matchedSurface: 'にしても',
            memberTokenOffsets: [3]
          })
        ]
      }
    })
    if (resolved.kind !== 'resolved') throw new Error('expected resolved spans')
    expect(
      deriveMiningCandidates(
        [
          {
            cueKey: 'split',
            text: 'どっちにしても',
            tokens: [niShite, mo],
            spans: resolved.spansByCue.split
          },
          {
            cueKey: 'fused',
            text: 'それにしても',
            tokens: [fused],
            spans: resolved.spansByCue.fused
          }
        ],
        {}
      ).map(({ lemma, token, count }) => ({ lemma, surface: token.surface, count }))
    ).toEqual([{ lemma: 'にしても', surface: 'にしても', count: 2 }])
  })

  it('never lets a lower-ranked alias headword hide a known word', async () => {
    const controller = createVocabularySpanController()
    // ヤツ with UniDic: lemma is already the top headword 奴 — the katakana
    // alias entry ヤツ ranked below it must not project 'unknown' over it.
    const unidic = { ...token('ヤツ', 0), lemma: '奴' }
    // ヤツ with IPADIC: lemma stays ヤツ, so the top result 奴 projects a
    // span whose level merges the DB rows for headword and lemma alike.
    const ipadic = token('ヤツ', 0)
    const dict = { lookup: vi.fn(() => Promise.resolve([result('奴', 'ヤツ'), result('ヤツ')])) }
    const knowledge = {
      detailsFor: vi
        .fn()
        .mockResolvedValue({ 奴: { level: 'known', sourceKinds: [], sources: [] } })
    }
    const resolved = await controller.resolve({
      dict,
      knowledge,
      frequencyDictId: null,
      epoch,
      cues: [
        { cueKey: 'unidic', tokens: [unidic] },
        { cueKey: 'ipadic', tokens: [ipadic] }
      ]
    })

    expect(resolved).toEqual({
      kind: 'resolved',
      spansByCue: {
        unidic: [],
        ipadic: [
          expect.objectContaining({ expression: '奴', matchedSurface: 'ヤツ', level: 'known' })
        ]
      }
    })
    expect(knowledge.detailsFor).toHaveBeenCalledWith(['奴', 'ヤツ'])
  })

  it('uses popup lookup ranking options and caches a resolved cue per epoch', async () => {
    const controller = createVocabularySpanController()
    const dict = { lookup: vi.fn().mockResolvedValue([result('神様')]) }
    const knowledge = {
      detailsFor: vi
        .fn()
        .mockResolvedValue({ 神様: { level: 'known', sourceKinds: [], sources: [] } })
    }
    const input = {
      dict,
      knowledge,
      frequencyDictId: 7,
      sortOrder: 'occurrence-based' as const,
      epoch,
      cues: [{ cueKey: 'one', tokens: [token('神', 0), token('様', 1)] }]
    }
    await controller.resolve(input)
    await controller.resolve(input)

    expect(dict.lookup).toHaveBeenCalledTimes(2)
    expect(dict.lookup).toHaveBeenCalledWith(
      '神',
      undefined,
      7,
      'occurrence-based',
      ['神様', '神'],
      '神'
    )
  })

  it('allows a background subset and foreground whole-track request in the same epoch to settle', async () => {
    const controller = createVocabularySpanController()
    const lookup = deferred<LookupResult[]>()
    const dict = { lookup: vi.fn(() => lookup.promise) }
    const knowledge = { detailsFor: vi.fn().mockResolvedValue({}) }
    const cues = [
      { cueKey: 'one', tokens: [token('A', 0)] },
      { cueKey: 'two', tokens: [token('B', 0)] }
    ]

    const background = controller.resolve({
      dict,
      knowledge,
      frequencyDictId: null,
      epoch,
      cues: cues.slice(0, 1)
    })
    const foreground = controller.resolve({ dict, knowledge, frequencyDictId: null, epoch, cues })
    lookup.resolve([])

    await expect(background).resolves.toEqual({ kind: 'resolved', spansByCue: { one: [] } })
    await expect(foreground).resolves.toEqual({
      kind: 'resolved',
      spansByCue: { one: [], two: [] }
    })
  })

  it('makes only an old epoch stale and limits dictionary lookup concurrency', async () => {
    const controller = createVocabularySpanController()
    const slow = deferred<LookupResult[]>()
    let active = 0
    let maximum = 0
    const dict = {
      lookup: vi.fn(() => {
        active++
        maximum = Math.max(maximum, active)
        return slow.promise.finally(() => {
          active--
        })
      })
    }
    const knowledge = { detailsFor: vi.fn().mockResolvedValue({}) }
    const first = controller.resolve({
      dict,
      knowledge,
      frequencyDictId: null,
      epoch,
      concurrency: 2,
      cues: [{ cueKey: 'one', tokens: [token('A', 0), token('B', 1), token('C', 2)] }]
    })
    await Promise.resolve()
    const second = controller.resolve({
      dict,
      knowledge,
      frequencyDictId: null,
      epoch: { ...epoch, track: 2 },
      cues: []
    })
    slow.resolve([])

    await expect(first).resolves.toEqual({ kind: 'stale' })
    await expect(second).resolves.toEqual({ kind: 'resolved', spansByCue: {} })
    expect(maximum).toBe(2)
  })

  it('does not cache a request invalidated during dictionary lookup', async () => {
    const controller = createVocabularySpanController()
    const lookup = deferred<LookupResult[]>()
    const dict = { lookup: vi.fn(() => lookup.promise) }
    const knowledge = { detailsFor: vi.fn().mockResolvedValue({}) }
    const input = {
      dict,
      knowledge,
      frequencyDictId: null,
      epoch,
      cues: [{ cueKey: 'one', tokens: [token('A', 0)] }]
    }

    const request = controller.resolve(input)
    controller.invalidate()
    lookup.resolve([])
    await expect(request).resolves.toEqual({ kind: 'stale' })

    await controller.resolve(input)
    expect(dict.lookup).toHaveBeenCalledTimes(2)
  })

  it('does not cache a request invalidated during knowledge lookup', async () => {
    const controller = createVocabularySpanController()
    const details = deferred<Record<string, { level: 'known'; sourceKinds: []; sources: [] }>>()
    const dict = { lookup: vi.fn().mockResolvedValue([result('A')]) }
    const knowledge = { detailsFor: vi.fn(() => details.promise) }
    const input = {
      dict,
      knowledge,
      frequencyDictId: null,
      epoch,
      cues: [{ cueKey: 'one', tokens: [token('A', 0)] }]
    }

    const request = controller.resolve(input)
    await Promise.resolve()
    controller.invalidate()
    details.resolve({ A: { level: 'known', sourceKinds: [], sources: [] } })

    await expect(request).resolves.toEqual({ kind: 'stale' })
    await controller.resolve(input)
    expect(dict.lookup).toHaveBeenCalledTimes(2)
  })

  it('keeps successful cue spans when another lookup fails', async () => {
    const controller = createVocabularySpanController()
    const dict = {
      lookup: vi.fn((lemma: string) =>
        lemma === '悪' ? Promise.reject(new Error('offline')) : Promise.resolve([result('神様')])
      )
    }
    const knowledge = {
      detailsFor: vi
        .fn()
        .mockResolvedValue({ 神様: { level: 'known', sourceKinds: [], sources: [] } })
    }
    const resolved = await controller.resolve({
      dict,
      knowledge,
      frequencyDictId: null,
      epoch,
      cues: [
        { cueKey: 'good', tokens: [token('神', 0), token('様', 1)] },
        { cueKey: 'bad', tokens: [token('悪', 0)] }
      ]
    })

    expect(resolved).toEqual({
      kind: 'resolved',
      spansByCue: {
        good: [expect.objectContaining({ matchedSurface: '神様', level: 'known' })],
        bad: []
      }
    })
  })
})
