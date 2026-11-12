import { describe, expect, it, vi } from 'vitest'
import { registerAppShellBridge } from '@src/main/appShellBridge'
import { APP_SHELL_CHANNELS } from '@src/shared/ipcChannels'
import { fakeIpc } from '@test/harness/fakeIpcMain'
import type { AppShellCoordinator } from '@src/main/services/appShell'

function fakeCoordinator(): AppShellCoordinator {
  return {
    getSurface: vi.fn(() => 'splash' as const),
    showSplash: vi.fn(async () => 'splash' as const),
    showPlayer: vi.fn(async () => 'player' as const),
    showOptions: vi.fn(async () => 'options' as const),
    dismissOptions: vi.fn(async () => 'splash' as const),
    quit: vi.fn()
  }
}

describe('registerAppShellBridge', () => {
  it('rejects calls from an unknown window', () => {
    const allowedSender = { id: 1 }
    const { ipc, handlers, listeners } = fakeIpc<{ sender: unknown }>({
      sender: allowedSender
    })
    const coordinator = fakeCoordinator()
    registerAppShellBridge(ipc, coordinator, (sender) => sender === allowedSender)

    expect(() => handlers.get(APP_SHELL_CHANNELS.getSurface)!({ sender: { id: 2 } })).toThrow(
      'unknown window'
    )
    expect(() => listeners.get(APP_SHELL_CHANNELS.quit)!({ sender: { id: 2 } })).toThrow(
      'unknown window'
    )
    expect(coordinator.quit).not.toHaveBeenCalled()
  })
})
