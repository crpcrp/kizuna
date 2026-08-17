// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Cue } from '@src/shared/cue'
import type { Token } from '@src/shared/token'
import {
  useVocabularyPipeline,
  type UseVocabularyPipelineInput,
  type VocabularyPipelineBridges
} from '@src/renderer/src/state/useVocabularyPipeline'
import {
  createWholeTrackVocabularyCoordinator,
  type WholeTrackVocabularyCoordinator,
  type WholeTrackVocabularyInput,
  type WholeTrackVocabularyResult
} from '@src/renderer/src/state/wholeTrackVocabulary'
import { createSubtitleReportController } from '@src/renderer/src/state/subtitleReportController'
import { makeToken } from '@test/harness/tokenFixtures'

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

const cueA: Cue = { start: 0, end: 1, text: 'a' }
const cueB: Cue = { start: 1, end: 2, text: 'b' }
const cueAKey = '0|1|a'
const cueBKey = '1|2|b'
const tokenA: Token = makeToken({ surface: 'a', pos: 'noun' })
const tokenB: Token = makeToken({ surface: 'b', pos: 'noun' })

function makeBridges(
  overrides: Partial<{
    tokenize: VocabularyPipelineBridges['mecab']['tokenize']
    tokenizeBatch: VocabularyPipelineBridges['mecab']['tokenizeBatch']
    levelsFor: VocabularyPipelineBridges['knowledge']['levelsFor']
    detailsFor: VocabularyPipelineBridges['knowledge']['detailsFor']
    syncStatus: VocabularyPipelineBridges['knowledge']['syncStatus']
    lookup: VocabularyPipelineBridges['dict']['lookup']
  }> = {}
): VocabularyPipelineBridges {
  return {
    mecab: {
      tokenize: overrides.tokenize ?? vi.fn().mockResolvedValue([tokenA]),
      tokenizeBatch: overrides.tokenizeBatch ?? vi.fn().mockResolvedValue([[tokenA]])
    },
    knowledge: {
      levelsFor: overrides.levelsFor ?? vi.fn().mockResolvedValue({}),
      detailsFor: overrides.detailsFor ?? vi.fn().mockResolvedValue({}),
      syncStatus:
        overrides.syncStatus ??
        vi.fn().mockResolvedValue({ wanikani: { configured: false }, anki: { configured: false } })
    },
    dict: { lookup: overrides.lookup ?? vi.fn().mockResolvedValue([]) }
  }
}

function fakeCoordinator(): WholeTrackVocabularyCoordinator & {
  prepare: ReturnType<
    typeof vi.fn<(input: WholeTrackVocabularyInput) => Promise<WholeTrackVocabularyResult>>
  >
  invalidate: ReturnType<typeof vi.fn<() => void>>
} {
  return {
    prepare: vi.fn<(input: WholeTrackVocabularyInput) => Promise<WholeTrackVocabularyResult>>(
      async () => ({ kind: 'stale' })
    ),
    invalidate: vi.fn<() => void>()
  }
}

function setup(overrides: Partial<UseVocabularyPipelineInput> = {}) {
  const dispatch = vi.fn()
  const bridges = overrides.bridges ?? makeBridges()
  const input: UseVocabularyPipelineInput = {
    dispatch,
    bridges,
    cues: [cueA],
    activeCue: cueA,
    activeCueKey: cueAKey,
    allCueTokens: {},
    activeTokens: [tokenA],
    japaneseSubtitleSelected: true,
    sidebarOpen: false,
    reportOpen: false,
    filePath: '/video.mkv',
    selectedSubtitleId: 1,
    frequencyDictId: null,
    sortOrder: 'auto',
    dictionarySettings: null,
    knowledgeEpoch: 0,
    tokenCacheRef: { current: new Map() },
    tokenizeTokenRef: { current: { current: 0 } },
    knownLevelsCacheRef: { current: new Map() },
    knownLevelsTokenRef: { current: { current: 0 } },
    allCuesTokenRef: { current: { current: 0 } },
    allCuesLevelsTokenRef: { current: { current: 0 } },
    wholeTrackVocabularyRef: { current: createWholeTrackVocabularyCoordinator() },
    vocabularySpanEpochRef: { current: 0 },
    vocabularySpansByCue: {},
    setVocabularySpansByCue: vi.fn(),
    reportController: createSubtitleReportController(),
    ...overrides
  }
  const hook = renderHook(({ value }) => useVocabularyPipeline(value), {
    initialProps: { value: input }
  })
  return { input, hook, dispatch, bridges }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('useVocabularyPipeline', () => {
  it('tokenizes the active cue and resolves its known levels', async () => {
    const { bridges, dispatch } = setup()
    await act(async () => {
      await Promise.resolve()
    })
    expect(bridges.mecab.tokenize).toHaveBeenCalledWith('a')
    expect(dispatch).toHaveBeenCalledWith({ type: 'activeTokensLoaded', tokens: [tokenA] })
    expect(bridges.knowledge.levelsFor).toHaveBeenCalledWith(['a'])
  })

  it('requests fresh tokenization and publishes it under the new active-cue key', async () => {
    const tokenize = vi.fn().mockResolvedValueOnce([tokenA]).mockResolvedValueOnce([tokenB])
    const { input, hook, dispatch, bridges } = setup({ bridges: makeBridges({ tokenize }) })
    await act(async () => {
      await Promise.resolve()
    })
    dispatch.mockClear()

    hook.rerender({ value: { ...input, activeCue: cueB, activeCueKey: cueBKey } })
    await act(async () => {
      await Promise.resolve()
    })

    expect(bridges.mecab.tokenize).toHaveBeenCalledWith('b')
    expect(dispatch).toHaveBeenCalledWith({ type: 'activeTokensLoaded', tokens: [tokenB] })
  })

  it('drops a superseded tokenization result when the active cue changes before it resolves', async () => {
    const first = deferred<Token[]>()
    const tokenize = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue([tokenB])
    const { input, hook, dispatch } = setup({ bridges: makeBridges({ tokenize }) })
    dispatch.mockClear()

    hook.rerender({ value: { ...input, activeCue: cueB, activeCueKey: cueBKey } })
    await act(async () => {
      first.resolve([tokenA])
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(dispatch).not.toHaveBeenCalledWith({ type: 'activeTokensLoaded', tokens: [tokenA] })
  })

  it('keeps the sidebar tokenize-all path and the whole-track prepare path independent', async () => {
    const tokenizeBatch = vi.fn().mockResolvedValue([[tokenA]])
    const coordinator = fakeCoordinator()
    const { input, hook } = setup({
      sidebarOpen: true,
      bridges: makeBridges({ tokenizeBatch }),
      wholeTrackVocabularyRef: { current: coordinator }
    })
    await act(async () => {
      await Promise.resolve()
    })

    expect(tokenizeBatch).toHaveBeenCalledWith(['a'])
    expect(coordinator.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        cues: input.cues,
        tokenCache: input.tokenCacheRef.current,
        knownLevelsCache: input.knownLevelsCacheRef.current,
        allCuesToken: input.allCuesTokenRef.current,
        allCuesLevelsToken: input.allCuesLevelsTokenRef.current
      })
    )
    const tokenizeBatchCalls = tokenizeBatch.mock.calls.length

    await act(async () => {
      await hook.result.current.prepareWholeTrackVocabulary()
    })
    expect(tokenizeBatch.mock.calls.length).toBe(tokenizeBatchCalls)
  })

  it('resets tokenization guards when the subtitle track stops being Japanese', () => {
    const { input, hook, dispatch } = setup()
    const before = {
      tokenize: input.tokenizeTokenRef.current.current,
      knownLevels: input.knownLevelsTokenRef.current.current,
      allCues: input.allCuesTokenRef.current.current,
      allCuesLevels: input.allCuesLevelsTokenRef.current.current
    }
    dispatch.mockClear()

    hook.rerender({ value: { ...input, japaneseSubtitleSelected: false } })

    expect(dispatch).toHaveBeenCalledWith({ type: 'resetTokenization' })
    expect(input.tokenizeTokenRef.current.current).toBe(before.tokenize + 1)
    expect(input.knownLevelsTokenRef.current.current).toBe(before.knownLevels + 1)
    expect(input.allCuesTokenRef.current.current).toBe(before.allCues + 1)
    expect(input.allCuesLevelsTokenRef.current.current).toBe(before.allCuesLevels + 1)
  })

  it('invalidates the whole-track cache and clears spans when a dependency changes', async () => {
    const coordinator = fakeCoordinator()
    const setVocabularySpansByCue = vi.fn()
    const { input, hook } = setup({
      wholeTrackVocabularyRef: { current: coordinator },
      setVocabularySpansByCue
    })
    await act(async () => {
      await Promise.resolve()
    })
    coordinator.invalidate.mockClear()
    setVocabularySpansByCue.mockClear()
    const epochBefore = input.vocabularySpanEpochRef.current

    hook.rerender({ value: { ...input, dictionarySettings: { changed: true } } })

    expect(coordinator.invalidate).toHaveBeenCalledTimes(1)
    expect(input.vocabularySpanEpochRef.current).toBe(epochBefore + 1)
    expect(setVocabularySpansByCue).toHaveBeenCalledWith({})
  })

  it('opens the subtitle report only while it is open, with the current snapshot', () => {
    const reportController = createSubtitleReportController()
    const openSpy = vi.spyOn(reportController, 'open')
    const { input, hook } = setup({
      reportOpen: false,
      reportController
    })
    expect(openSpy).not.toHaveBeenCalled()

    hook.rerender({ value: { ...input, reportOpen: true } })

    expect(openSpy).toHaveBeenCalledWith(
      expect.objectContaining({ snapshot: expect.any(Function) })
    )
  })

  it('drops a subtitle-report snapshot that resolves after the report was closed', async () => {
    const reportController = createSubtitleReportController()
    const first = deferred<WholeTrackVocabularyResult>()
    const coordinator = { prepare: vi.fn().mockReturnValue(first.promise), invalidate: vi.fn() }
    setup({
      reportOpen: true,
      wholeTrackVocabularyRef: { current: coordinator },
      reportController
    })

    reportController.close()
    await act(async () => {
      first.resolve({
        kind: 'ready',
        snapshot: { cueTokens: [], spansByCue: {}, cueHasUnknown: {} }
      })
      await Promise.resolve()
    })

    expect(reportController.getState()).toEqual({ kind: 'idle' })
  })

  it('drops a whole-track vocabulary snapshot invalidated before it resolves', async () => {
    const coordinator = createWholeTrackVocabularyCoordinator()
    const batch = deferred<Token[][]>()
    const bridges = makeBridges({ tokenizeBatch: vi.fn().mockReturnValue(batch.promise) })
    const { input, hook } = setup({
      wholeTrackVocabularyRef: { current: coordinator },
      bridges
    })

    const pending = hook.result.current.prepareWholeTrackVocabulary()
    hook.rerender({ value: { ...input, filePath: '/other.mkv' } })
    batch.resolve([[tokenA]])

    await expect(pending).resolves.toEqual({ kind: 'stale' })
  })
})
