import { describe, it, expect, vi } from 'vitest'
import {
  registerPlayerSettingsBridge,
  type PlayerSettingsServiceLike
} from '@src/main/playerSettingsBridge'
import { PLAYER_SETTINGS_CHANNELS } from '@src/shared/ipcChannels'
import type { IpcMainHandleLike } from '@src/main/ipc'
import { DEFAULT_PLAYER_SETTINGS, type PlayerSettings } from '@src/shared/playerSettings'

type FakeEvent = { senderId: number }

/** Fake ipcMain: records handlers per channel (mirrors knowledgeBridge.test.ts). */
function fakeIpc() {
  const handlers = new Map<string, (event: FakeEvent, ...args: unknown[]) => unknown>()
  const ipc: IpcMainHandleLike<FakeEvent> = {
    handle: (channel, listener) => {
      handlers.set(channel, listener)
    }
  }
  return { ipc, handlers }
}

function fakeService() {
  let settings: PlayerSettings = DEFAULT_PLAYER_SETTINGS
  const service: PlayerSettingsServiceLike = {
    getSettings: vi.fn(() => settings),
    setSettings: vi.fn((patch: Partial<PlayerSettings>) => {
      settings = { ...settings, ...patch }
      return settings
    }),
    openMpvConfigDir: vi.fn(async () => '')
  }
  return { service }
}

describe('registerPlayerSettingsBridge', () => {
  const event: FakeEvent = { senderId: 1 }

  it('registers every command channel', () => {
    const { ipc, handlers } = fakeIpc()
    const { service } = fakeService()
    registerPlayerSettingsBridge(ipc, service)

    expect([...handlers.keys()].sort()).toEqual(
      [
        PLAYER_SETTINGS_CHANNELS.getSettings,
        PLAYER_SETTINGS_CHANNELS.setSettings,
        PLAYER_SETTINGS_CHANNELS.openMpvConfigDir
      ].sort()
    )
  })

  it('forwards getSettings and returns its result', async () => {
    const { ipc, handlers } = fakeIpc()
    const { service } = fakeService()
    registerPlayerSettingsBridge(ipc, service)

    const result = await handlers.get(PLAYER_SETTINGS_CHANNELS.getSettings)!(event)

    expect(service.getSettings).toHaveBeenCalled()
    expect(result).toEqual(DEFAULT_PLAYER_SETTINGS)
  })

  it('forwards setSettings with the patch and returns its result', async () => {
    const { ipc, handlers } = fakeIpc()
    const { service } = fakeService()
    registerPlayerSettingsBridge(ipc, service)

    const patch = { skipSeconds: 10 }
    const result = await handlers.get(PLAYER_SETTINGS_CHANNELS.setSettings)!(event, patch)

    expect(service.setSettings).toHaveBeenCalledWith(patch)
    expect(result).toEqual({ ...DEFAULT_PLAYER_SETTINGS, skipSeconds: 10 })
  })

  it('forwards openMpvConfigDir and returns its result', async () => {
    const { ipc, handlers } = fakeIpc()
    const { service } = fakeService()
    registerPlayerSettingsBridge(ipc, service)

    const result = await handlers.get(PLAYER_SETTINGS_CHANNELS.openMpvConfigDir)!(event)

    expect(service.openMpvConfigDir).toHaveBeenCalled()
    expect(result).toBe('')
  })
})
