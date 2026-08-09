import { describe, expect, it, vi } from 'vitest'
import { registerUpdateBridge } from '@src/main/updateBridge'
import type { UpdateService } from '@src/main/updateService'
import { UPDATE_CHANNELS } from '@src/shared/ipcChannels'
import { fakeIpc } from '@test/harness/fakeIpcMain'

function fakeService(): UpdateService {
  return {
    getState: vi.fn(() => ({ status: 'idle' as const })),
    check: vi.fn(async () => ({ status: 'idle' as const })),
    download: vi.fn(async () => ({ status: 'idle' as const })),
    install: vi.fn(async () => undefined),
    subscribe: vi.fn(() => () => undefined),
    beginShutdown: vi.fn(),
    dispose: vi.fn()
  }
}

describe('registerUpdateBridge', () => {
  it('registers the narrow commands and validates origin and sender', async () => {
    const allowedSender = { id: 1 }
    const { ipc, handlers } = fakeIpc({ sender: allowedSender })
    const service = fakeService()
    registerUpdateBridge(ipc, service, (sender) => sender === allowedSender)

    expect([...handlers.keys()].sort()).toEqual(
      [
        UPDATE_CHANNELS.getState,
        UPDATE_CHANNELS.check,
        UPDATE_CHANNELS.download,
        UPDATE_CHANNELS.install
      ].sort()
    )
    await handlers.get(UPDATE_CHANNELS.check)!({ sender: allowedSender }, 'manual')
    expect(service.check).toHaveBeenCalledWith('manual')
    expect(() => handlers.get(UPDATE_CHANNELS.check)!({ sender: allowedSender }, 'later')).toThrow(
      'Invalid update check origin.'
    )
    expect(() => handlers.get(UPDATE_CHANNELS.getState)!({ sender: { id: 2 } })).toThrow(
      'unknown window'
    )
  })
})
