import { describe, expect, it, vi } from 'vitest'
import { registerClipboardBridge, type ClipboardWriter } from '@src/main/clipboardBridge'
import { CLIPBOARD_CHANNELS } from '@src/shared/ipcChannels'
import { fakeIpc, invokeRejection } from '@test/harness/fakeIpcMain'

describe('registerClipboardBridge malformed requests', () => {
  it.each([[undefined], [42], [{ text: 'x' }]])('rejects %j', async (text) => {
    const fake = fakeIpc()
    const clipboard: ClipboardWriter = { writeText: vi.fn() }
    registerClipboardBridge(fake.ipc, clipboard)

    const err = await invokeRejection(fake, CLIPBOARD_CHANNELS.writeText, text)

    expect(err).toEqual(new Error(`Invalid ${CLIPBOARD_CHANNELS.writeText} request.`))
    expect(clipboard.writeText).not.toHaveBeenCalled()
  })
})
