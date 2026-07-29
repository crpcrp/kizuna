import { describe, expect, it, vi } from 'vitest'
import { registerClipboardBridge, type ClipboardWriter } from '@src/main/clipboardBridge'
import { CLIPBOARD_CHANNELS } from '@src/shared/ipcChannels'
import type { IpcMainHandleLike } from '@src/main/playerBridge'

type FakeEvent = { senderId: number }

function fakeIpc() {
  const handlers = new Map<string, (event: FakeEvent, ...args: unknown[]) => unknown>()
  const ipc: IpcMainHandleLike<FakeEvent> = {
    handle: (channel, listener) => handlers.set(channel, listener)
  }
  return { ipc, handlers }
}

describe('registerClipboardBridge', () => {
  it('forwards the exact text to the injected clipboard writer', () => {
    const { ipc, handlers } = fakeIpc()
    const clipboard: ClipboardWriter = { writeText: vi.fn() }
    registerClipboardBridge(ipc, clipboard)

    const text = 'First line.\nSecond line!'
    const result = handlers.get(CLIPBOARD_CHANNELS.writeText)!({ senderId: 1 }, text)

    expect(result).toBeUndefined()
    expect(clipboard.writeText).toHaveBeenCalledWith(text)
    expect([...handlers.keys()]).toEqual([CLIPBOARD_CHANNELS.writeText])
  })
})
