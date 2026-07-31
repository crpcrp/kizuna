import { describe, expect, it, vi } from 'vitest'
import { registerTranslateBridge } from '@src/main/translateBridge'
import { TRANSLATE_CHANNELS } from '@src/shared/ipcChannels'
import type { Translator } from '@src/main/services/translate/googleTranslate'
import { fakeIpc } from '@test/harness/fakeIpcMain'
import { deferred } from '@test/harness/deferred'

class FakeSender {
  private destroyed?: () => void

  constructor(readonly id: number) {}

  once(event: 'destroyed', listener: () => void): void {
    if (event === 'destroyed') this.destroyed = listener
  }

  destroy(): void {
    this.destroyed?.()
  }
}

type FakeEvent = { sender: FakeSender }

function event(id = 1): FakeEvent {
  return { sender: new FakeSender(id) }
}

describe('registerTranslateBridge', () => {
  it('forwards the request text and controller signal on the dedicated channel', async () => {
    const { ipc, handlers, listeners } = fakeIpc<FakeEvent>(event())
    const translator: Translator = { translate: vi.fn().mockResolvedValue('A cat.') }
    registerTranslateBridge(ipc, translator)

    await expect(
      handlers.get(TRANSLATE_CHANNELS.translate)!(event(), { requestId: 'one', text: '猫です。' })
    ).resolves.toBe('A cat.')
    expect(translator.translate).toHaveBeenCalledWith(
      '猫です。',
      undefined,
      undefined,
      expect.any(AbortSignal)
    )
    expect([...handlers.keys()]).toEqual([TRANSLATE_CHANNELS.translate])
    expect([...listeners.keys()]).toEqual([TRANSLATE_CHANNELS.cancel])
  })

  it('rejects empty IDs and ignores cancellation for unknown IDs', async () => {
    const { ipc, handlers, listeners } = fakeIpc<FakeEvent>(event())
    const translator: Translator = { translate: vi.fn().mockResolvedValue('unused') }
    registerTranslateBridge(ipc, translator)
    const sender = event()

    listeners.get(TRANSLATE_CHANNELS.cancel)!(sender, { requestId: 'unknown' })

    await expect(
      handlers.get(TRANSLATE_CHANNELS.translate)!(sender, { requestId: '  ', text: '猫です。' })
    ).rejects.toThrow('Translation failed.')
    expect(translator.translate).not.toHaveBeenCalled()
  })

  it('aborts and rejects a never-settling translation at the injected timeout', async () => {
    vi.useFakeTimers()
    const { ipc, handlers } = fakeIpc<FakeEvent>(event())
    const translator: Translator = { translate: vi.fn(() => new Promise<string>(() => {})) }
    registerTranslateBridge(ipc, translator, { timeoutMs: 10 })
    const request = handlers.get(TRANSLATE_CHANNELS.translate)!(event(), {
      requestId: 'one',
      text: '猫です。'
    }) as Promise<string>
    const rejection = expect(request).rejects.toThrow('Translation failed.')

    await vi.advanceTimersByTimeAsync(10)

    await rejection
    expect((translator.translate as ReturnType<typeof vi.fn>).mock.calls[0][3].aborted).toBe(true)
    vi.useRealTimers()
  })

  it('cancels only the identified request and rejects immediately without provider cooperation', async () => {
    const { ipc, handlers, listeners } = fakeIpc<FakeEvent>(event())
    const first = deferred<string>()
    const second = deferred<string>()
    const translator: Translator = {
      translate: vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    }
    registerTranslateBridge(ipc, translator)
    const sender = event()
    const firstRequest = handlers.get(TRANSLATE_CHANNELS.translate)!(sender, {
      requestId: 'first',
      text: '一'
    }) as Promise<string>
    const secondRequest = handlers.get(TRANSLATE_CHANNELS.translate)!(sender, {
      requestId: 'second',
      text: '二'
    }) as Promise<string>
    const firstRejection = expect(firstRequest).rejects.toThrow('Translation failed.')

    listeners.get(TRANSLATE_CHANNELS.cancel)!(sender, { requestId: 'first' })
    second.resolve('two')

    await firstRejection
    await expect(secondRequest).resolves.toBe('two')
    expect((translator.translate as ReturnType<typeof vi.fn>).mock.calls[0][3].aborted).toBe(true)
    expect((translator.translate as ReturnType<typeof vi.fn>).mock.calls[1][3].aborted).toBe(false)
  })

  it('rejects duplicate IDs, then cleans up resolved and rejected requests for reuse', async () => {
    const { ipc, handlers } = fakeIpc<FakeEvent>(event())
    const translator: Translator = {
      translate: vi
        .fn()
        .mockResolvedValueOnce('ok')
        .mockRejectedValueOnce(new Error('provider failed'))
        .mockResolvedValueOnce('again')
    }
    registerTranslateBridge(ipc, translator)
    const sender = event()
    const first = handlers.get(TRANSLATE_CHANNELS.translate)!(sender, {
      requestId: 'same',
      text: '一'
    }) as Promise<string>
    await expect(
      handlers.get(TRANSLATE_CHANNELS.translate)!(sender, { requestId: 'same', text: '二' })
    ).rejects.toThrow('Translation failed.')
    await expect(first).resolves.toBe('ok')
    await expect(
      handlers.get(TRANSLATE_CHANNELS.translate)!(sender, { requestId: 'same', text: '三' })
    ).rejects.toThrow('provider failed')
    await expect(
      handlers.get(TRANSLATE_CHANNELS.translate)!(sender, { requestId: 'same', text: '四' })
    ).resolves.toBe('again')
  })

  it('aborts and rejects every sender request when its WebContents is destroyed', async () => {
    const { ipc, handlers } = fakeIpc<FakeEvent>(event())
    const translator: Translator = { translate: vi.fn(() => new Promise<string>(() => {})) }
    registerTranslateBridge(ipc, translator)
    const sender = event(7)
    const request = handlers.get(TRANSLATE_CHANNELS.translate)!(sender, {
      requestId: 'one',
      text: '猫です。'
    }) as Promise<string>
    const rejection = expect(request).rejects.toThrow('Translation failed.')

    sender.sender.destroy()

    await rejection
    expect((translator.translate as ReturnType<typeof vi.fn>).mock.calls[0][3].aborted).toBe(true)
  })
})
