// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Cue } from '@src/shared/cue'
import type { Token } from '@src/shared/token'
import { createSubtitleReportController } from '@src/renderer/src/state/subtitleReportController'
import { invalidateTokenizationForDictionaryChange } from '@src/renderer/src/state/tokenizationInvalidation'
import {
  useVocabularyCaches,
  type UseVocabularyCachesInput
} from '@src/renderer/src/state/useVocabularyCaches'
import { deferred } from '@test/harness/deferred'
import { createFakeKizunaApi, type FakeKizunaApi } from '@test/harness/fakeKizunaApi'
import { makeToken } from '@test/harness/tokenFixtures'

const cue: Cue = { start: 0, end: 1, text: '猫' }
const oldToken: Token = makeToken({ surface: 'ipadic' })
const newToken: Token = makeToken({ surface: 'unidic' })
const CUE_KEY = '0|1|猫'

function setup(configure: (bridge: FakeKizunaApi) => void = () => undefined) {
  const bridge = createFakeKizunaApi()
  configure(bridge)
  const dispatch = vi.fn()
  const input: UseVocabularyCachesInput = {
    dispatch,
    bridge,
    cues: [cue],
    activeCue: cue,
    // Not the cue's own key: keeps the whole-track span pass (which shares the
    // sidebar's batch guard) out of these tests.
    activeCueKey: 'active-cue',
    allCueTokens: {},
    activeTokens: [],
    japaneseSubtitleSelected: true,
    sidebarOpen: false,
    reportOpen: false,
    filePath: '/v/a.mkv',
    selectedSubtitleId: 1,
    frequencyDictId: null,
    sortOrder: 'auto',
    dictionarySettings: null,
    knowledgeEpoch: 0,
    reportController: createSubtitleReportController()
  }
  const hook = renderHook(({ value }) => useVocabularyCaches(value), {
    initialProps: { value: input }
  })
  return { bridge, dispatch, input, hook }
}

/** What `useKnowledgeOptions` does on a MeCab dictionary switch. */
function switchDictionary(ctx: ReturnType<typeof setup>, sidebarOpen: boolean): Promise<void> {
  const { refs } = ctx.hook.result.current
  return invalidateTokenizationForDictionaryChange({
    mecab: ctx.bridge.mecab,
    knowledge: ctx.bridge.knowledge,
    dispatch: ctx.dispatch,
    activeCue: cue,
    cues: [cue],
    sidebarOpen,
    tokenCache: refs.tokenCache.current,
    knownLevelsCache: refs.knownLevelsCache.current,
    activeToken: refs.tokenizeToken.current,
    allCuesToken: refs.allCuesToken.current,
    allCuesLevelsToken: refs.allCuesLevelsToken.current
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

describe('useVocabularyCaches', () => {
  it('keeps an in-flight active-cue tokenization when the sidebar opens', async () => {
    const active = deferred<Token[]>()
    const ctx = setup((bridge) => {
      bridge.mecab.tokenize.mockReturnValueOnce(active.promise)
      bridge.mecab.tokenizeBatch.mockResolvedValue([[oldToken]])
    })
    const { tokenizeToken, allCuesToken } = ctx.hook.result.current.refs
    const activeBefore = tokenizeToken.current.current
    const allBefore = allCuesToken.current.current

    ctx.hook.rerender({ value: { ...ctx.input, sidebarOpen: true } })
    await waitFor(() => expect(ctx.bridge.mecab.tokenizeBatch).toHaveBeenCalledTimes(1))

    expect(allCuesToken.current.current).toBe(allBefore + 1)
    expect(tokenizeToken.current.current).toBe(activeBefore)
    await act(async () => {
      active.resolve([oldToken])
      await active.promise
    })
    expect(activeTokensDispatched(ctx.dispatch)).toContainEqual([oldToken])
  })

  it('discards an in-flight active-cue tokenization when the dictionary switches', async () => {
    const stale = deferred<Token[]>()
    const ctx = setup((bridge) => {
      bridge.mecab.tokenize.mockReturnValueOnce(stale.promise).mockResolvedValue([newToken])
    })
    expect(ctx.bridge.mecab.tokenize).toHaveBeenCalledTimes(1)
    ctx.dispatch.mockClear()

    await act(() => switchDictionary(ctx, false))
    await act(async () => {
      stale.resolve([oldToken])
      await stale.promise
    })

    expect(activeTokensDispatched(ctx.dispatch)).toEqual([[newToken]])
    expect(ctx.hook.result.current.refs.tokenCache.current.get(CUE_KEY)).toEqual([newToken])
    expect(ctx.bridge.mecab.tokenizeBatch).not.toHaveBeenCalled()
  })

  it("discards the sidebar's in-flight batch when the dictionary switches", async () => {
    const staleBatch = deferred<Token[][]>()
    const ctx = setup((bridge) => {
      // Keep the active cue uncached so the sidebar batch has work to do.
      bridge.mecab.tokenize.mockReturnValue(new Promise(() => undefined))
      bridge.mecab.tokenizeBatch.mockReturnValueOnce(staleBatch.promise)
    })
    ctx.hook.rerender({ value: { ...ctx.input, sidebarOpen: true } })
    await waitFor(() => expect(ctx.bridge.mecab.tokenizeBatch).toHaveBeenCalledTimes(1))
    ctx.bridge.mecab.tokenize.mockResolvedValue([newToken])
    ctx.dispatch.mockClear()

    await act(() => switchDictionary(ctx, true))
    await act(async () => {
      staleBatch.resolve([[oldToken]])
      await staleBatch.promise
    })

    const batches = ctx.dispatch.mock.calls
      .map(([action]) => action)
      .filter((action) => action.type === 'allCueTokensLoaded')
    expect(batches).toEqual([{ type: 'allCueTokensLoaded', tokens: { [CUE_KEY]: [newToken] } }])
  })
})
