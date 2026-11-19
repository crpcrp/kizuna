// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createOptionsDataController } from '@src/renderer/src/state/optionsData'
import { createVocabularyCaches } from '@src/renderer/src/state/tokenization'
import { useKnowledgeOptions } from '@src/renderer/src/state/useKnowledgeOptions'
import { deferred } from '@test/harness/deferred'
import { createFakeKizunaApi } from '@test/harness/fakeKizunaApi'

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
