import { describe, expect, it, vi } from 'vitest'
import type { Cue } from '@src/shared/cue'
import type { LookupResult } from '@src/shared/dictionary'
import type { KnowledgeLevel } from '@src/shared/knowledge'
import type { Token } from '@src/shared/token'
import {
  createWholeTrackVocabularyCoordinator,
  type WholeTrackVocabularyInput
} from '@src/renderer/src/state/wholeTrackVocabulary'
import type {
  VocabularySpanController,
  VocabularySpanEpoch,
  VocabularySpanResolveResult
} from '@src/renderer/src/state/vocabularySpanController'
import { makeLookupResult } from '@test/harness/dictFixtures'
import { makeToken } from '@test/harness/tokenFixtures'

const epoch: VocabularySpanEpoch = {
  file: 1,
  track: 1,
  tokenization: 1,
  dictionary: 1,
  knowledge: 1
}
const cues: Cue[] = [{ start: 0, end: 1, text: 'word' }]
const tokens: Token[] = [makeToken({ surface: 'word', pos: 'noun' })]
const result: LookupResult = makeLookupResult({
  expression: 'word',
  matchedSurface: 'word',
  reading: '',
  glossary: ''
})

function input(overrides: Partial<WholeTrackVocabularyInput> = {}): WholeTrackVocabularyInput {
  return {
    mecab: { tokenizeBatch: vi.fn().mockResolvedValue([tokens]) },
    dict: { lookup: vi.fn().mockResolvedValue([result]) },
    knowledge: {
      levelsFor: vi.fn().mockResolvedValue({}),
      detailsFor: vi.fn().mockResolvedValue({})
    },
    dispatch: vi.fn(),
    cues,
    tokenCache: new Map(),
    knownLevelsCache: new Map<string, KnowledgeLevel>(),
    allCuesToken: { current: 0 },
    allCuesLevelsToken: { current: 0 },
    frequencyDictId: null,
    epoch,
    ...overrides
  }
}

function spanController(): VocabularySpanController & { resolve: ReturnType<typeof vi.fn> } {
  return {
    resolve: vi.fn().mockResolvedValue({ kind: 'resolved', spansByCue: { '0|1|word': [] } }),
    invalidate: vi.fn()
  }
}

describe('whole-track vocabulary coordinator', () => {
  it('joins concurrent report and mining preparation and preserves the token snapshot', async () => {
    const spans = spanController()
    const coordinator = createWholeTrackVocabularyCoordinator(spans)
    const request = input()

    const report = coordinator.prepare(request)
    const mining = coordinator.prepare(request)
    expect(mining).toBe(report)

    await expect(report).resolves.toEqual({
      kind: 'ready',
      snapshot: {
        cueTokens: [{ cueKey: '0|1|word', tokens }],
        spansByCue: { '0|1|word': [] },
        cueHasUnknown: { '0|1|word': true }
      }
    })
    expect(request.mecab.tokenizeBatch).toHaveBeenCalledOnce()
    expect(spans.resolve).toHaveBeenCalledOnce()
  })

  it('reuses a completed snapshot when Anki-only settings change', async () => {
    const spans = spanController()
    const coordinator = createWholeTrackVocabularyCoordinator(spans)
    const first = input()
    const prepared = await coordinator.prepare(first)

    const ankiRefresh = Object.assign(
      { ...first },
      {
        ankiSettings: { duplicatePolicy: 'overwrite', deck: 'Target', tags: ['tag'] }
      }
    )
    const cached = await coordinator.prepare(ankiRefresh)
    expect(cached).toBe(prepared)
    expect(first.mecab.tokenizeBatch).toHaveBeenCalledOnce()
    expect(spans.resolve).toHaveBeenCalledOnce()
  })

  it('classifies every cue from prepared spans and cached levels', async () => {
    const trackCues: Cue[] = [
      { start: 0, end: 2, text: '棒人間' },
      { start: 2, end: 3, text: '神' }
    ]
    const compoundTokens = [
      makeToken({ surface: '棒', lemma: '棒', pos: 'noun' }),
      makeToken({ surface: '人間', lemma: '人間', pos: 'noun', startOffset: 1 })
    ]
    const knownTokens = [makeToken({ surface: '神', lemma: '神', pos: 'noun' })]
    const compoundKey = '0|2|棒人間'
    const knownKey = '2|3|神'
    const spans = spanController()
    const spansByCue = {
      [compoundKey]: [
        {
          cueKey: compoundKey,
          startOffset: 0,
          endOffset: 3,
          memberTokenOffsets: [0, 1],
          expression: '棒人間',
          matchedSurface: '棒人間',
          level: 'unknown' as const
        }
      ],
      [knownKey]: [
        {
          cueKey: knownKey,
          startOffset: 0,
          endOffset: 1,
          memberTokenOffsets: [0],
          expression: '神',
          matchedSurface: '神',
          level: 'known' as const
        }
      ]
    }
    spans.resolve.mockResolvedValue({ kind: 'resolved', spansByCue })
    const request = input({
      cues: trackCues,
      mecab: { tokenizeBatch: vi.fn().mockResolvedValue([compoundTokens, knownTokens]) },
      knownLevelsCache: new Map<string, KnowledgeLevel>([
        ['棒', 'unknown'],
        ['人間', 'known'],
        ['神', 'known']
      ])
    })
    const coordinator = createWholeTrackVocabularyCoordinator(spans)

    const prepared = await coordinator.prepare(request)

    expect(prepared).toEqual({
      kind: 'ready',
      snapshot: {
        cueTokens: [
          { cueKey: compoundKey, tokens: compoundTokens },
          { cueKey: knownKey, tokens: knownTokens }
        ],
        spansByCue,
        cueHasUnknown: { [compoundKey]: true, [knownKey]: false }
      }
    })
    expect(request.knowledge.levelsFor).not.toHaveBeenCalled()
    expect(request.knowledge.detailsFor).not.toHaveBeenCalled()
    expect(request.dict.lookup).not.toHaveBeenCalled()

    const cached = await coordinator.prepare(request)
    expect(cached).toBe(prepared)
    expect(request.mecab.tokenizeBatch).toHaveBeenCalledOnce()
    expect(spans.resolve).toHaveBeenCalledOnce()
  })

  it.each([
    ['dictionary', { ...epoch, dictionary: 2 }],
    ['knowledge', { ...epoch, knowledge: 2 }]
  ])('creates a new preparation for a changed %s epoch', async (_name, changedEpoch) => {
    const spans = spanController()
    const coordinator = createWholeTrackVocabularyCoordinator(spans)
    const first = input()
    await coordinator.prepare(first)
    await coordinator.prepare(input({ epoch: changedEpoch }))

    expect(spans.resolve).toHaveBeenCalledTimes(2)
  })

  it('returns stale when a file change invalidates preparation', async () => {
    let resolveBatch!: (value: Token[][]) => void
    const batch = new Promise<Token[][]>((resolve) => {
      resolveBatch = resolve
    })
    const request = input({ mecab: { tokenizeBatch: vi.fn(() => batch) } })
    const coordinator = createWholeTrackVocabularyCoordinator(spanController())

    const pending = coordinator.prepare(request)
    coordinator.invalidate()
    resolveBatch([tokens])

    await expect(pending).resolves.toEqual({ kind: 'stale' })
  })

  it('discards cue classification when span resolution becomes stale', async () => {
    let resolveSpans!: (value: VocabularySpanResolveResult) => void
    const pendingSpans = new Promise<VocabularySpanResolveResult>((resolve) => {
      resolveSpans = resolve
    })
    const spans = spanController()
    spans.resolve.mockReturnValue(pendingSpans)
    const coordinator = createWholeTrackVocabularyCoordinator(spans)
    const pending = coordinator.prepare(
      input({ knownLevelsCache: new Map<string, KnowledgeLevel>([['word', 'unknown']]) })
    )

    await vi.waitFor(() => expect(spans.resolve).toHaveBeenCalledOnce())
    coordinator.invalidate()
    resolveSpans({ kind: 'resolved', spansByCue: { '0|1|word': [] } })

    await expect(pending).resolves.toEqual({ kind: 'stale' })
  })

  it('recomputes cue classification after invalidation', async () => {
    const spans = spanController()
    const coordinator = createWholeTrackVocabularyCoordinator(spans)
    const knownLevelsCache = new Map<string, KnowledgeLevel>([['word', 'unknown']])
    const request = input({ knownLevelsCache })

    const first = await coordinator.prepare(request)
    expect(first).toMatchObject({
      kind: 'ready',
      snapshot: { cueHasUnknown: { '0|1|word': true } }
    })

    knownLevelsCache.set('word', 'known')
    coordinator.invalidate()
    const second = await coordinator.prepare(request)

    expect(second).toMatchObject({
      kind: 'ready',
      snapshot: { cueHasUnknown: { '0|1|word': false } }
    })
    expect(spans.resolve).toHaveBeenCalledTimes(2)
  })

  it('does not rejoin an old request after the snapshot key changes away and back', async () => {
    let resolveFirst!: (value: Token[][]) => void
    const firstBatch = new Promise<Token[][]>((resolve) => {
      resolveFirst = resolve
    })
    const mecab = {
      tokenizeBatch: vi
        .fn()
        .mockImplementationOnce(() => firstBatch)
        .mockResolvedValue([tokens])
    }
    const coordinator = createWholeTrackVocabularyCoordinator(spanController())
    const first = coordinator.prepare(input({ mecab }))

    await coordinator.prepare(input({ epoch: { ...epoch, file: 2 } }))
    const current = coordinator.prepare(input({ mecab }))
    resolveFirst([tokens])

    await expect(first).resolves.toEqual({ kind: 'stale' })
    await expect(current).resolves.toMatchObject({ kind: 'ready' })
    expect(mecab.tokenizeBatch).toHaveBeenCalledTimes(2)
  })

  it.each(['mecab', 'span resolution'])(
    'settles a %s rejection as a sanitized error',
    async (failure) => {
      const spans = spanController()
      const request =
        failure === 'mecab'
          ? input({
              mecab: { tokenizeBatch: vi.fn().mockRejectedValue(new Error('bridge detail')) }
            })
          : input()
      if (failure === 'span resolution') spans.resolve.mockRejectedValue(new Error('bridge detail'))

      await expect(createWholeTrackVocabularyCoordinator(spans).prepare(request)).resolves.toEqual({
        kind: 'error',
        message: 'Could not prepare whole-track vocabulary.'
      })
    }
  )
})
