import { describe, expect, it, vi } from 'vitest'
import { registerGameOcrBridge } from '@src/main/gameOcrBridge'
import { GAME_OCR_CHANNELS } from '@src/shared/ipcChannels'
import type { GameOcrRuntimeStatus } from '@src/shared/gameOcr'
import { fakeIpc } from '@test/harness/fakeIpcMain'
import type { GameOcrRuntimeService } from '@src/main/services/gameOcr/runtime'

const status: GameOcrRuntimeStatus = {
  shortcut: 'Ctrl+Shift+O',
  ocr: { state: 'ready' },
  game: { state: 'stopped' }
}

function fakeService() {
  let listener: ((next: GameOcrRuntimeStatus) => void) | undefined
  const service: GameOcrRuntimeService = {
    getSettings: vi.fn(() => ({ captureShortcut: 'Ctrl+Shift+O' })),
    setSettings: vi.fn(async (patch) => ({
      captureShortcut: patch.captureShortcut ?? 'Ctrl+Shift+O'
    })),
    getStatus: vi.fn(() => status),
    subscribe: vi.fn((next) => {
      listener = next
      return () => undefined
    }),
    start: vi.fn(async () => status),
    stop: vi.fn(async () => status),
    retry: vi.fn(async () => status),
    updateWorkerStatus: vi.fn(),
    reportError: vi.fn()
  }
  return { service, emit: (next: GameOcrRuntimeStatus) => listener?.(next) }
}

describe('registerGameOcrBridge', () => {
  it('registers commands, forwards calls, pushes status, and checks the sender', async () => {
    const allowedSender = { id: 1 }
    const { ipc, handlers } = fakeIpc<{ sender: unknown }>({ sender: allowedSender })
    const fake = fakeService()
    const send = vi.fn()
    registerGameOcrBridge(ipc, fake.service, send, (sender) => sender === allowedSender)

    expect([...handlers.keys()].sort()).toEqual(
      [
        GAME_OCR_CHANNELS.getSettings,
        GAME_OCR_CHANNELS.setSettings,
        GAME_OCR_CHANNELS.getStatus,
        GAME_OCR_CHANNELS.start,
        GAME_OCR_CHANNELS.stop,
        GAME_OCR_CHANNELS.retry
      ].sort()
    )
    expect(await handlers.get(GAME_OCR_CHANNELS.getSettings)!({ sender: allowedSender })).toEqual({
      captureShortcut: 'Ctrl+Shift+O'
    })
    await handlers.get(GAME_OCR_CHANNELS.setSettings)!(
      { sender: allowedSender },
      { captureShortcut: 3 }
    )
    expect(fake.service.setSettings).toHaveBeenCalledWith({ captureShortcut: undefined })
    await handlers.get(GAME_OCR_CHANNELS.start)!({ sender: allowedSender })
    expect(fake.service.start).toHaveBeenCalledOnce()

    fake.emit(status)
    expect(send).toHaveBeenCalledWith(GAME_OCR_CHANNELS.statusChanged, status)
    expect(() => handlers.get(GAME_OCR_CHANNELS.getStatus)!({ sender: { id: 2 } })).toThrow(
      'unknown window'
    )
  })
})
