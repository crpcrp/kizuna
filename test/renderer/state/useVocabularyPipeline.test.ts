// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Cue } from '@src/shared/cue'
import type { Token } from '@src/shared/token'
import {
  useVocabularyPipeline,
  type UseVocabularyPipelineInput,
  type VocabularyPipelineBridges
} from '@src/renderer/src/state/useVocabularyPipeline'
import type { WholeTrackVocabularyResult } from '@src/renderer/src/state/wholeTrackVocabulary'
import { invalidateTokenizationForDictionaryChange } from '@src/renderer/src/state/tokenizationInvalidation'
import { createSubtitleReportController } from '@src/renderer/src/state/subtitleReportController'
import { makeToken } from '@test/harness/tokenFixtures'
import { deferred } from '@test/harness/deferred'

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

function setup(overrides: Partial<UseVocabularyPipelineInput> = {}) {
  const dispatch = vi.fn()
  const bridges = overrides.bridges ?? makeBridges()
  const input: UseVocabularyPipelineInput = {
    dispatch,
    bridges,
    cues: [cueA],
    activeCue: cueA,
    // Span preparation is opt-in so these tests can isolate active/sidebar requests.
    activeCueKey: 'active-cue',
    allCueTokens: {},
    activeTokens: [],
    japaneseSubtitleSelected: true,
    sidebarOpen: false,
    reportOpen: false,
    filePath: '/video.mkv',
    selectedSubtitleId: 1,
    frequencyDictId: null,
    sortOrder: 'auto',
    dictionarySettings: null,
    knowledgeEpoch: 0,
    reportController: createSubtitleReportController(),
    ...overrides
  }
  const hook = renderHook(({ value }) => useVocabularyPipeline(value), {
    initialProps: { value: input }
  })
  return { input, hook, dispatch, bridges }
}

function switchDictionary(ctx: ReturnType<typeof setup>, sidebarOpen: boolean): Promise<void> {
  return invalidateTokenizationForDictionaryChange({
    mecab: ctx.bridges.mecab,
    knowledge: ctx.bridges.knowledge,
    dispatch: ctx.dispatch,
    activeCue: cueA,
    cues: [cueA],
    sidebarOpen,
    caches: ctx.hook.result.current.refs.current
  })
}

function activeTokensDispatched(dispatch: ReturnType<typeof vi.fn>): Token[][] {
  return dispatch.mock.calls
    .map(([action]) => action)
    .filter((action) => action.type === 'activeTokensLoaded' && action.tokens.length > 0)
    .map((action) => action.tokens)
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

  it('reuses the whole-track snapshot and publishes spans for the overlay and sidebar', async () => {
    const { input, hook, bridges } = setup()
    hook.rerender({ value: { ...input, activeCueKey: cueAKey, activeTokens: [tokenA] } })
    await waitFor(() => expect(hook.result.current.spansForCue(cueAKey)).toBeDefined())
    const lookups = vi.mocked(bridges.dict.lookup).mock.calls.length
    let first!: WholeTrackVocabularyResult
    let second!: WholeTrackVocabularyResult
    await act(async () => {
      first = await hook.result.current.prepareWholeTrackVocabulary()
      second = await hook.result.current.prepareWholeTrackVocabulary()
    })
    expect(first.kind).toBe('ready')
    expect(second).toEqual(first)
    expect(bridges.dict.lookup).toHaveBeenCalledTimes(lookups)
    expect(hook.result.current.spansForCue(undefined)).toBeUndefined()
  })

  it('clears spans and rebuilds the snapshot when a dictionary setting changes', async () => {
    const { input, hook, bridges } = setup({ activeCueKey: cueAKey, activeTokens: [tokenA] })
    await waitFor(() => expect(hook.result.current.spansForCue(cueAKey)).toBeDefined())
    vi.mocked(bridges.dict.lookup).mockClear()
    hook.rerender({ value: { ...input, dictionarySettings: { changed: true } } })
    expect(hook.result.current.spansForCue(cueAKey)).toBeUndefined()
    await waitFor(() => expect(hook.result.current.spansForCue(cueAKey)).toBeDefined())
    expect(bridges.dict.lookup).toHaveBeenCalled()

    act(() => hook.result.current.invalidateVocabularySpans())
    expect(hook.result.current.spansForCue(cueAKey)).toBeUndefined()
    vi.mocked(bridges.dict.lookup).mockClear()
    await act(() => hook.result.current.prepareWholeTrackVocabulary())
    expect(bridges.dict.lookup).toHaveBeenCalled()
  })

  it('drops late tokenization and level results after switching to a non-Japanese track', async () => {
    const active = deferred<Token[]>()
    const batch = deferred<Token[][]>()
    const levels = deferred<Record<string, 'known'>>()
    const { input, hook, dispatch } = setup({
      sidebarOpen: true,
      bridges: makeBridges({
        tokenize: vi.fn().mockReturnValue(active.promise),
        tokenizeBatch: vi.fn().mockReturnValue(batch.promise),
        levelsFor: vi.fn().mockReturnValue(levels.promise)
      })
    })
    await act(async () => {
      active.resolve([tokenA])
    })
    dispatch.mockClear()
    hook.rerender({ value: { ...input, japaneseSubtitleSelected: false } })
    await act(async () => {
      batch.resolve([[tokenA]])
      levels.resolve({ a: 'known' })
    })
    expect(dispatch.mock.calls.map(([action]) => action)).toEqual([{ type: 'resetTokenization' }])
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
    const batch = deferred<Token[][]>()
    setup({
      reportOpen: true,
      bridges: makeBridges({ tokenizeBatch: vi.fn().mockReturnValue(batch.promise) }),
      reportController
    })
    reportController.close()
    await act(async () => {
      batch.resolve([[tokenA]])
    })
    expect(reportController.getState()).toEqual({ kind: 'idle' })
  })

  it('drops a whole-track snapshot invalidated before it resolves', async () => {
    const batch = deferred<Token[][]>()
    const { input, hook } = setup({
      bridges: makeBridges({ tokenizeBatch: vi.fn().mockReturnValue(batch.promise) })
    })
    const pending = hook.result.current.prepareWholeTrackVocabulary()
    hook.rerender({ value: { ...input, filePath: '/other.mkv' } })
    await act(async () => {
      batch.resolve([[tokenA]])
    })
    await expect(pending).resolves.toEqual({ kind: 'stale' })
    expect(hook.result.current.spansForCue(cueAKey)).toBeUndefined()
  })

  it('keeps an in-flight active-cue tokenization when the sidebar opens', async () => {
    const active = deferred<Token[]>()
    const ctx = setup({
      bridges: makeBridges({
        tokenize: vi.fn().mockReturnValueOnce(active.promise),
        tokenizeBatch: vi.fn().mockResolvedValue([[tokenA]])
      })
    })
    ctx.hook.rerender({ value: { ...ctx.input, sidebarOpen: true } })
    await waitFor(() => expect(ctx.bridges.mecab.tokenizeBatch).toHaveBeenCalledTimes(1))

    await act(async () => {
      active.resolve([tokenA])
      await active.promise
    })
    expect(activeTokensDispatched(ctx.dispatch)).toContainEqual([tokenA])
  })

  it('discards an in-flight active-cue tokenization when the dictionary switches', async () => {
    const stale = deferred<Token[]>()
    const ctx = setup({
      bridges: makeBridges({
        tokenize: vi.fn().mockReturnValueOnce(stale.promise).mockResolvedValue([tokenB])
      })
    })
    expect(ctx.bridges.mecab.tokenize).toHaveBeenCalledTimes(1)
    ctx.dispatch.mockClear()

    await act(() => switchDictionary(ctx, false))
    await act(async () => {
      stale.resolve([tokenA])
      await stale.promise
    })

    expect(activeTokensDispatched(ctx.dispatch)).toEqual([[tokenB]])
    expect(ctx.hook.result.current.refs.current.tokenCache.get(cueAKey)).toEqual([tokenB])
    expect(ctx.bridges.mecab.tokenizeBatch).not.toHaveBeenCalled()
  })

  it("discards the sidebar's in-flight batch when the dictionary switches", async () => {
    const staleBatch = deferred<Token[][]>()
    const ctx = setup({
      bridges: makeBridges({
        tokenize: vi.fn().mockReturnValue(new Promise(() => undefined)),
        tokenizeBatch: vi.fn().mockReturnValueOnce(staleBatch.promise)
      })
    })
    ctx.hook.rerender({ value: { ...ctx.input, sidebarOpen: true } })
    await waitFor(() => expect(ctx.bridges.mecab.tokenizeBatch).toHaveBeenCalledTimes(1))
    vi.mocked(ctx.bridges.mecab.tokenize).mockResolvedValue([tokenB])
    ctx.dispatch.mockClear()

    await act(() => switchDictionary(ctx, true))
    await act(async () => {
      staleBatch.resolve([[tokenA]])
      await staleBatch.promise
    })

    const batches = ctx.dispatch.mock.calls
      .map(([action]) => action)
      .filter((action) => action.type === 'allCueTokensLoaded')
    expect(batches).toEqual([{ type: 'allCueTokensLoaded', tokens: { [cueAKey]: [tokenB] } }])
  })
})
