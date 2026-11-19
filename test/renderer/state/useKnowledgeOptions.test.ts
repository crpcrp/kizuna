// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createOptionsDataController } from '@src/renderer/src/state/optionsData'
import { createVocabularyCaches } from '@src/renderer/src/state/tokenization'
import { useKnowledgeOptions } from '@src/renderer/src/state/useKnowledgeOptions'
import { deferred } from '@test/harness/deferred'
import { createFakeKizunaApi } from '@test/harness/fakeKizunaApi'

import { makeToken } from '@test/harness/tokenFixtures'
import type { SyncStatus } from '@src/shared/knowledge'

afterEach(cleanup)

it('rebuilds the currently displayed cue when the dictionary switch completes', async () => {
  const bridge = createFakeKizunaApi()
  const selected = deferred<'unidic'>()
  bridge.mecab.selectDict.mockReturnValue(selected.promise)
  const optionsData = createOptionsDataController(bridge)
  const load = vi.spyOn(optionsData, 'load')
  const input = {
    bridge,
    optionsData,
    dispatch: vi.fn(),
    sidebarOpen: false,
    activeTokens: [],
    allCueTokens: {},
    caches: { refs: { current: createVocabularyCaches() }, invalidateVocabularySpans: vi.fn() }
  }
  const hook = renderHook(
    ({ text }) => {
      const cue = { start: 0, end: 1, text }
      return useKnowledgeOptions({ ...input, activeCue: cue, cues: [cue] }).options
    },
    { initialProps: { text: '猫' } }
  )

  const work = hook.result.current.onSelectMecabDict('unidic')
  hook.rerender({ text: '犬' })
  await act(async () => {
    selected.resolve('unidic')
    await work
  })
  expect(bridge.mecab.tokenize.mock.calls).toEqual([['犬']])
  expect(load).toHaveBeenCalledWith('dictionaries', { force: true })
  expect(input.dispatch).toHaveBeenCalledWith({ type: 'resetTokenization' })
})

it('refreshes the visible words when a knowledge sync completes after playback advances', async () => {
  const bridge = createFakeKizunaApi()
  const pending = deferred<SyncStatus>()
  bridge.knowledge.sync.mockReturnValueOnce(pending.promise)
  const input = {
    bridge,
    optionsData: createOptionsDataController(bridge),
    dispatch: vi.fn(),
    sidebarOpen: false,
    activeCue: undefined,
    cues: [],
    allCueTokens: {},
    caches: { refs: { current: createVocabularyCaches() }, invalidateVocabularySpans: vi.fn() }
  }
  const hook = renderHook(
    ({ surface }) =>
      useKnowledgeOptions({
        ...input,
        activeTokens: [makeToken({ surface, pos: 'noun' })]
      }),
    { initialProps: { surface: '猫' } }
  )
  const work = hook.result.current.syncNow('anki')
  hook.rerender({ surface: '犬' })
  await act(async () => {
    pending.resolve({
      anki: { lastSyncAt: null, count: 1, configured: true, outcome: 'synced' },
      wanikani: { lastSyncAt: null, count: 0, configured: false }
    })
    await work
  })
  expect(bridge.knowledge.levelsFor.mock.calls).toEqual([[['犬']]])
})
