import { describe, expect, it, vi } from 'vitest'
import { registerGrammarExamplesBridge } from '@src/main/grammarExamplesBridge'
import type { GrammarExamplesService } from '@src/main/services/grammarExamples/service'
import { EMPTY_GRAMMAR_EXAMPLE_PAGE } from '@src/shared/grammarExamples'
import { GRAMMAR_EXAMPLES_CHANNELS as C } from '@src/shared/ipcChannels'
import { expectUntouched, fakeIpc, invokeRejection } from '@test/harness/fakeIpcMain'

function setup() {
  const fake = fakeIpc()
  let listener: ((status: unknown) => void) | undefined
  const service = {
    lookup: vi.fn(() => EMPTY_GRAMMAR_EXAMPLE_PAGE),
    subscribe: vi.fn((cb: (status: unknown) => void) => {
      listener = cb
      return () => {}
    })
  }
  const send = vi.fn()
  const openExternal = vi.fn(async () => {})
  registerGrammarExamplesBridge(fake.ipc, service as unknown as GrammarExamplesService, {
    send,
    openExternal
  })
  service.subscribe.mockClear()
  return { fake, service, send, openExternal, push: (status: unknown) => listener?.(status) }
}

describe('registerGrammarExamplesBridge', () => {
  it.each([
    ['a non-string pattern', [1, '書く', 0, 2]],
    ['a non-string lemma', ['past', null, 0, 2]],
    ['a negative offset', ['past', '書く', -1, 2]],
    ['a zero limit', ['past', '書く', 0, 0]]
  ])('rejects a lookup with %s', async (_name, args) => {
    const { fake, service } = setup()
    expect(await invokeRejection(fake, C.lookup, ...args)).toEqual(
      new Error(`Invalid ${C.lookup} request.`)
    )
    expectUntouched(service)
  })

  it('opens only Tatoeba sentence pages built from a validated id', async () => {
    const { fake, openExternal } = setup()
    await expect(invokeRejection(fake, C.openSentence, 'https://evil.example')).resolves.toEqual(
      new Error(`Invalid ${C.openSentence} request.`)
    )
    await fake.invoke(C.openSentence, 42)
    expect(openExternal).toHaveBeenCalledExactlyOnceWith('https://tatoeba.org/en/sentences/show/42')
  })

  it('pushes status changes to the renderer', () => {
    const { send, push } = setup()
    push({ state: 'ready', cached: true })
    expect(send).toHaveBeenCalledWith(C.statusChanged, { state: 'ready', cached: true })
  })
})
