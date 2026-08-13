import { describe, expect, it, vi } from 'vitest'
import { registerGameOcrIpc } from '@src/main/services/gameOcr/frozenFrameIpc'
import { GAME_OCR_CHANNELS } from '@src/shared/ipcChannels'
import { fakeNativeWindow } from '@test/harness/fakeFrozenFrame'

function setup() {
  const fake = fakeNativeWindow()
  const listeners = new Map<string, (event: { sender: unknown }, value?: unknown) => void>()
  const ipc = {
    on: vi.fn((channel: string, listener: (event: { sender: unknown }) => void) => {
      listeners.set(channel, listener)
    }),
    removeListener: vi.fn()
  }
  const controller = {
    rendererReady: vi.fn(),
    // The renderer's close request dismisses the frame; it never destroys the
    // window the next capture is going to reuse.
    dismiss: vi.fn(async () => {}),
    reportFrozen: vi.fn(),
    reportCaptureBytes: vi.fn(),
    reportRegionsRendered: vi.fn()
  }
  const remove = registerGameOcrIpc(ipc, fake.window, controller)
  const emit = (channel: string, sender: unknown, value?: unknown): void => {
    listeners.get(channel)!({ sender }, value)
  }
  return { fake, ipc, controller, remove, emit }
}

describe('registerGameOcrIpc', () => {
  it('routes every report from this window renderer to the controller', () => {
    const { fake, controller, emit } = setup()
    const sender = fake.window.webContents
    const frozen = { sessionId: 1, captureId: 1, imageSize: { width: 640, height: 480 } }
    const bytes = {
      sessionId: 1,
      captureId: 1,
      imageBytes: Uint8Array.from([1]),
      imageMediaType: 'image/png' as const,
      imageSize: { width: 640, height: 480 }
    }

    emit(GAME_OCR_CHANNELS.rendererReady, sender)
    emit(GAME_OCR_CHANNELS.frozen, sender, frozen)
    emit(GAME_OCR_CHANNELS.captureBytes, sender, bytes)
    emit(GAME_OCR_CHANNELS.regionsRendered, sender, { sessionId: 1, captureId: 1 })
    emit(GAME_OCR_CHANNELS.close, sender)

    expect(controller.rendererReady).toHaveBeenCalledOnce()
    expect(controller.reportFrozen).toHaveBeenCalledWith(frozen)
    expect(controller.reportCaptureBytes).toHaveBeenCalledWith(bytes)
    expect(controller.reportRegionsRendered).toHaveBeenCalledWith({ sessionId: 1, captureId: 1 })
    expect(controller.dismiss).toHaveBeenCalledOnce()
  })

  it('ignores the same messages from any other renderer', () => {
    const { controller, emit } = setup()
    const other = { id: 'the player window' }

    emit(GAME_OCR_CHANNELS.rendererReady, other)
    emit(GAME_OCR_CHANNELS.frozen, other, { sessionId: 1, captureId: 1 })
    emit(GAME_OCR_CHANNELS.captureBytes, other, { sessionId: 1, captureId: 1 })
    emit(GAME_OCR_CHANNELS.regionsRendered, other, { sessionId: 1, captureId: 1 })
    emit(GAME_OCR_CHANNELS.close, other)

    expect(controller.rendererReady).not.toHaveBeenCalled()
    expect(controller.reportFrozen).not.toHaveBeenCalled()
    expect(controller.reportCaptureBytes).not.toHaveBeenCalled()
    expect(controller.reportRegionsRendered).not.toHaveBeenCalled()
    expect(controller.dismiss).not.toHaveBeenCalled()
  })

  it('removes every listener it registered', () => {
    const { ipc, remove } = setup()

    remove()

    // Ready and close, plus the frozen, encoded, and painted reports.
    expect(ipc.removeListener).toHaveBeenCalledTimes(5)
    for (const [channel, listener] of ipc.on.mock.calls) {
      expect(ipc.removeListener).toHaveBeenCalledWith(channel, listener)
    }
  })
})
