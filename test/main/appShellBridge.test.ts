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
    quit: vi.fn()
  }
}

describe('registerAppShellBridge', () => {
  it('registers commands, forwards calls, and validates the sender', async () => {
    const allowedSender = { id: 1 }
    const { ipc, handlers, listeners } = fakeIpc<{ sender: unknown }>({
      sender: allowedSender
    })
    const coordinator = fakeCoordinator()

    registerAppShellBridge(ipc, coordinator, (sender) => sender === allowedSender)

    expect([...handlers.keys()].sort()).toEqual(
      [
        APP_SHELL_CHANNELS.getSurface,
        APP_SHELL_CHANNELS.showSplash,
        APP_SHELL_CHANNELS.showPlayer,
        APP_SHELL_CHANNELS.showOptions
      ].sort()
    )
    expect([...listeners.keys()]).toEqual([APP_SHELL_CHANNELS.quit])
    expect(handlers.get(APP_SHELL_CHANNELS.getSurface)!({ sender: allowedSender })).toBe('splash')
    await handlers.get(APP_SHELL_CHANNELS.showSplash)!({ sender: allowedSender })
    await handlers.get(APP_SHELL_CHANNELS.showPlayer)!({ sender: allowedSender })
    await handlers.get(APP_SHELL_CHANNELS.showOptions)!({ sender: allowedSender })
    listeners.get(APP_SHELL_CHANNELS.quit)!({ sender: allowedSender })

    expect(coordinator.showPlayer).toHaveBeenCalledOnce()
    expect(coordinator.showSplash).toHaveBeenCalledOnce()
    expect(coordinator.showOptions).toHaveBeenCalledOnce()
    expect(coordinator.quit).toHaveBeenCalledOnce()
    expect(() => handlers.get(APP_SHELL_CHANNELS.getSurface)!({ sender: { id: 2 } })).toThrow(
      'unknown window'
    )
    expect(() => listeners.get(APP_SHELL_CHANNELS.quit)!({ sender: { id: 2 } })).toThrow(
      'unknown window'
    )
  })
})
