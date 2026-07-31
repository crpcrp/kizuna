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
  VocabularySpanEpoch
} from '@src/renderer/src/state/vocabularySpanController'
import { makeLookupResult } from '@test/harness/dictFixtures'

const epoch: VocabularySpanEpoch = {
  file: 1,
  track: 1,
  tokenization: 1,
  dictionary: 1,
  knowledge: 1
}
const cues: Cue[] = [{ start: 0, end: 1, text: 'word' }]
const tokens: Token[] = [
  { surface: 'word', reading: '', lemma: 'word', pos: 'noun', startOffset: 0 }
]
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
        spansByCue: { '0|1|word': [] }
      }
    })
    expect(request.mecab.tokenizeBatch).toHaveBeenCalledOnce()
    expect(spans.resolve).toHaveBeenCalledOnce()
  })

  it('reuses a completed snapshot when Anki-only settings change', async () => {
    const spans = spanController()
    const coordinator = createWholeTrackVocabularyCoordinator(spans)
    const first = input()
    await coordinator.prepare(first)

    const ankiRefresh = Object.assign(
      { ...first },
      {
        ankiSettings: { duplicatePolicy: 'overwrite', deck: 'Target', tags: ['tag'] }
      }
    )
    await coordinator.prepare(ankiRefresh)
    expect(first.mecab.tokenizeBatch).toHaveBeenCalledOnce()
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
