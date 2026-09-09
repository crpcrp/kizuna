import { describe, expect, it, vi } from 'vitest'
import { JIMAKU_CHANNELS } from '@src/shared/ipcChannels'
import type { JimakuSettingsStatus } from '@src/shared/jimaku'
import { registerJimakuSettingsBridge } from '@src/main/jimakuSettingsBridge'
import { fakeIpc, type FakeEvent } from '@test/harness/fakeIpcMain'

const STATUS: JimakuSettingsStatus = {
  configured: true,
  secretStorageAvailable: true,
  testOutcome: { status: 'connected' }
}

describe('registerJimakuSettingsBridge', () => {
  it('registers and delegates every renderer-facing operation', async () => {
    const { ipc, handlers } = fakeIpc()
    const event: FakeEvent = { senderId: 1 }
    const service = {
      getStatus: vi.fn(() => STATUS),
      setApiKey: vi.fn(() => STATUS),
      clearApiKey: vi.fn(() => STATUS),
      testConnection: vi.fn(async () => STATUS)
    }
    registerJimakuSettingsBridge(ipc, service)

    expect([...handlers.keys()].sort()).toEqual(Object.values(JIMAKU_CHANNELS).sort())
    expect(handlers.get(JIMAKU_CHANNELS.getStatus)!(event)).toEqual(STATUS)
    expect(handlers.get(JIMAKU_CHANNELS.setApiKey)!(event, 'api-key')).toEqual(STATUS)
    expect(handlers.get(JIMAKU_CHANNELS.clearApiKey)!(event)).toEqual(STATUS)
    await expect(handlers.get(JIMAKU_CHANNELS.testConnection)!(event)).resolves.toEqual(STATUS)

    expect(service.getStatus).toHaveBeenCalledOnce()
    expect(service.setApiKey).toHaveBeenCalledWith('api-key')
    expect(service.clearApiKey).toHaveBeenCalledOnce()
    expect(service.testConnection).toHaveBeenCalledOnce()
  })

  it.each([null, 42, [], {}, { value: 'api-key' }])(
    'rejects a non-string key payload %j before delegation',
    (payload) => {
      const { ipc, handlers } = fakeIpc()
      const service = {
        getStatus: vi.fn(() => STATUS),
        setApiKey: vi.fn(() => STATUS),
        clearApiKey: vi.fn(() => STATUS),
        testConnection: vi.fn(async () => STATUS)
      }
      registerJimakuSettingsBridge(ipc, service)

      const event: FakeEvent = { senderId: 1 }
      expect(() => handlers.get(JIMAKU_CHANNELS.setApiKey)!(event, payload)).toThrow(
        'Invalid Jimaku API key.'
      )
      expect(service.setApiKey).not.toHaveBeenCalled()
    }
  )
})
