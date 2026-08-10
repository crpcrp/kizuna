import { describe, expect, it, vi } from 'vitest'
import { makeLookupResult } from '@test/harness/dictFixtures'
import { deferred } from '@test/harness/deferred'
import {
  createGameOcrTextPipeline,
  type GameOcrTextPipelineOptions
} from '@src/renderer/src/state/gameOcrTextPipeline'
import type { KnowledgeDetails, KnowledgeLevel } from '@src/shared/knowledge'
import type { Token } from '@src/shared/token'

const tokens = (): Token[] => [
  { surface: '日本', reading: 'にほん', lemma: '日本', pos: '名詞', startOffset: 0 },
  { surface: '語', reading: 'ご', lemma: '語', pos: '名詞', startOffset: 2 }
]

function services(overrides: Partial<GameOcrTextPipelineOptions> = {}): GameOcrTextPipelineOptions {
  return {
    mecab: { tokenizeBatch: vi.fn(async (texts: string[]) => texts.map(() => tokens())) },
    dict: {
      lookup: vi.fn(async (_lemma, _reading, _frequency, _sort, candidates) =>
        candidates?.includes('日本語')
          ? [makeLookupResult({ expression: '日本語', matchedSurface: '日本語' })]
          : []
      )
    },
    knowledge: {
      levelsFor: vi.fn(async (): Promise<Record<string, KnowledgeLevel>> => ({
        日本: 'known',
        語: 'learning'
      })),
      detailsFor: vi.fn(async (): Promise<Record<string, KnowledgeDetails>> => ({
        日本語: { level: 'known', sourceKinds: [], sources: [] }
      }))
    },
    ...overrides
  }
}

describe('createGameOcrTextPipeline', () => {
  it('keeps repeated text independently addressable and bounds compound spans to each region', async () => {
    const pipeline = createGameOcrTextPipeline(services())
    const result = await pipeline.process({ sessionId: 1, captureId: 2 }, [
      { id: 'left', text: '日本語' },
      { id: 'right', text: '日本語' }
    ])

    expect(result).toMatchObject({
      kind: 'resolved',
      snapshot: {
        sessionId: 1,
        captureId: 2,
        regions: {
          left: {
            id: 'left',
            text: '日本語',
            levels: { 日本: 'known', 語: 'learning' },
            vocabularySpans: [{ cueKey: 'left', matchedSurface: '日本語' }]
          },
          right: {
            id: 'right',
            text: '日本語',
            vocabularySpans: [{ cueKey: 'right', matchedSurface: '日本語' }]
          }
        }
      }
    })
    if (result.kind !== 'resolved') throw new Error('expected resolved result')
    expect(result.snapshot.regions.left).not.toBe(result.snapshot.regions.right)
    expect(
      Object.entries(result.snapshot.regions).every(([id, region]) =>
        region.vocabularySpans.every((span) => span.cueKey === id)
      )
    ).toBe(true)
  })

  it('does not publish a batch after a newer capture replaces it', async () => {
    const first = deferred<Token[][]>()
    const second = deferred<Token[][]>()
    const tokenizeBatch = vi
      .fn<(texts: string[]) => Promise<Token[][]>>()
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)
    const pipeline = createGameOcrTextPipeline(
      services({ mecab: { tokenizeBatch }, dict: { lookup: vi.fn(async () => []) } })
    )

    const oldResult = pipeline.process({ sessionId: 1, captureId: 1 }, [
      { id: 'old', text: '古い' }
    ])
    const newResult = pipeline.process({ sessionId: 1, captureId: 2 }, [
      { id: 'new', text: '新しい' }
    ])
    second.resolve([tokens()])
    await expect(newResult).resolves.toMatchObject({
      kind: 'resolved',
      snapshot: { captureId: 2, regions: { new: { text: '新しい' } } }
    })

    first.resolve([tokens()])
    await expect(oldResult).resolves.toEqual({ kind: 'stale' })
  })

  it('does not publish late knowledge from a replaced capture', async () => {
    const oldLevels = deferred<Record<string, KnowledgeLevel>>()
    const levelsFor = vi
      .fn<(identities: string[]) => Promise<Record<string, KnowledgeLevel>>>()
      .mockReturnValueOnce(oldLevels.promise)
      .mockResolvedValueOnce({})
    const pipeline = createGameOcrTextPipeline(
      services({
        dict: { lookup: vi.fn(async () => []) },
        knowledge: {
          levelsFor,
          detailsFor: vi.fn(async () => ({}))
        }
      })
    )

    const oldResult = pipeline.process({ sessionId: 2, captureId: 1 }, [
      { id: 'old', text: '古い' }
    ])
    await vi.waitFor(() => expect(levelsFor).toHaveBeenCalledTimes(1))
    const newResult = pipeline.process({ sessionId: 2, captureId: 2 }, [
      { id: 'new', text: '新しい' }
    ])
    await expect(newResult).resolves.toMatchObject({
      kind: 'resolved',
      snapshot: { captureId: 2 }
    })

    oldLevels.resolve({ 古い: 'known' })
    await expect(oldResult).resolves.toEqual({ kind: 'stale' })
  })

  it('does not publish late dictionary spans from a replaced capture', async () => {
    const oldLookup = deferred<ReturnType<typeof makeLookupResult>[]>()
    const lookup = vi
      .fn<GameOcrTextPipelineOptions['dict']['lookup']>()
      .mockReturnValueOnce(oldLookup.promise)
      .mockResolvedValue([])
    const oneToken = (surface: string): Token => ({
      surface,
      reading: '',
      lemma: surface,
      pos: '名詞',
      startOffset: 0
    })
    const pipeline = createGameOcrTextPipeline(
      services({
        mecab: {
          tokenizeBatch: vi.fn(async (texts: string[]) => texts.map((text) => [oneToken(text)]))
        },
        dict: { lookup }
      })
    )

    const oldResult = pipeline.process({ sessionId: 3, captureId: 1 }, [
      { id: 'old', text: '古い' }
    ])
    await vi.waitFor(() => expect(lookup).toHaveBeenCalledTimes(1))
    const newResult = pipeline.process({ sessionId: 3, captureId: 2 }, [
      { id: 'new', text: '新しい' }
    ])
    await expect(newResult).resolves.toMatchObject({
      kind: 'resolved',
      snapshot: { captureId: 2 }
    })

    oldLookup.resolve([])
    await expect(oldResult).resolves.toEqual({ kind: 'stale' })
  })

  it('reuses results only inside the active capture and drops them when it changes', async () => {
    const options = services({ dict: { lookup: vi.fn(async () => []) } })
    const pipeline = createGameOcrTextPipeline(options)
    const region = [{ id: 'same', text: '日本語' }]

    await pipeline.process({ sessionId: 1, captureId: 1 }, region)
    await pipeline.process({ sessionId: 1, captureId: 1 }, region)
    expect(options.mecab.tokenizeBatch).toHaveBeenCalledTimes(1)

    const replacement = await pipeline.process({ sessionId: 1, captureId: 2 }, [
      { id: 'plain', text: '...' }
    ])
    expect(replacement).toMatchObject({
      kind: 'resolved',
      snapshot: { regions: { plain: { text: '...', tokens: [], vocabularySpans: [] } } }
    })
    if (replacement.kind !== 'resolved') throw new Error('expected resolved result')
    expect(replacement.snapshot.regions).not.toHaveProperty('same')
  })

  it('degrades failed services and non-Japanese regions to current plain text', async () => {
    const tokenizeBatch = vi.fn(async () => {
      throw new Error('MeCab unavailable')
    })
    const options = services({ mecab: { tokenizeBatch } })
    const pipeline = createGameOcrTextPipeline(options)
    const result = await pipeline.process({ sessionId: 4, captureId: 5 }, [
      { id: 'empty', text: '' },
      { id: 'punctuation', text: '！？' },
      { id: 'latin', text: 'hello' },
      { id: 'japanese', text: '猫' }
    ])

    expect(tokenizeBatch).toHaveBeenCalledWith(['猫'])
    expect(result).toMatchObject({
      kind: 'resolved',
      snapshot: {
        regions: {
          empty: { text: '', tokens: [], levels: {}, vocabularySpans: [] },
          punctuation: { text: '！？', tokens: [], levels: {}, vocabularySpans: [] },
          latin: { text: 'hello', tokens: [], levels: {}, vocabularySpans: [] },
          japanese: { text: '猫', tokens: [], levels: {}, vocabularySpans: [] }
        }
      }
    })
    expect(options.knowledge.levelsFor).not.toHaveBeenCalled()
    expect(options.dict.lookup).not.toHaveBeenCalled()
  })

  it('keeps tokens with unknown levels when knowledge and dictionary resolution fail', async () => {
    const pipeline = createGameOcrTextPipeline(
      services({
        dict: { lookup: vi.fn(async () => Promise.reject(new Error('dictionary unavailable'))) },
        knowledge: {
          levelsFor: vi.fn(async () => Promise.reject(new Error('knowledge unavailable'))),
          detailsFor: vi.fn(async () => Promise.reject(new Error('knowledge unavailable')))
        }
      })
    )

    const result = await pipeline.process({ sessionId: 7, captureId: 8 }, [
      { id: 'region', text: '日本語' }
    ])
    expect(result).toMatchObject({
      kind: 'resolved',
      snapshot: {
        regions: {
          region: {
            text: '日本語',
            tokens: [{ surface: '日本' }, { surface: '語' }],
            levels: { 日本: 'unknown', 語: 'unknown' },
            vocabularySpans: []
          }
        }
      }
    })
  })
})
