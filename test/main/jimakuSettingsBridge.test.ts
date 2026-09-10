import { describe, expect, it, vi } from 'vitest'
import { JIMAKU_CHANNELS } from '@src/shared/ipcChannels'
import type { JimakuFolderHint, JimakuSettingsStatus } from '@src/shared/jimaku'
import { registerJimakuSettingsBridge } from '@src/main/jimakuSettingsBridge'
import { fakeIpc, type FakeEvent } from '@test/harness/fakeIpcMain'

const STATUS: JimakuSettingsStatus = {
  configured: true,
  secretStorageAvailable: true,
  testOutcome: { status: 'connected' }
}

const HINT: JimakuFolderHint = {
  entryId: 42,
  name: 'Show',
  category: 'anime',
  season: 2,
  updatedAt: 10
}

describe('registerJimakuSettingsBridge', () => {
  it('registers and delegates every renderer-facing operation', async () => {
    const { ipc, handlers } = fakeIpc()
    const event: FakeEvent = { senderId: 1 }
    const service = {
      getStatus: vi.fn(() => STATUS),
      setApiKey: vi.fn(() => STATUS),
      clearApiKey: vi.fn(() => STATUS),
      testConnection: vi.fn(async () => STATUS),
      getFolderHint: vi.fn(() => HINT),
      setFolderHint: vi.fn(() => HINT),
      clearFolderHint: vi.fn()
    }
    registerJimakuSettingsBridge(ipc, service)

    expect([...handlers.keys()].sort()).toEqual(
      [
        JIMAKU_CHANNELS.getStatus,
        JIMAKU_CHANNELS.setApiKey,
        JIMAKU_CHANNELS.clearApiKey,
        JIMAKU_CHANNELS.testConnection,
        JIMAKU_CHANNELS.getFolderHint,
        JIMAKU_CHANNELS.setFolderHint,
        JIMAKU_CHANNELS.clearFolderHint
      ].sort()
    )
    expect(handlers.get(JIMAKU_CHANNELS.getStatus)!(event)).toEqual(STATUS)
    expect(handlers.get(JIMAKU_CHANNELS.setApiKey)!(event, 'api-key')).toEqual(STATUS)
    expect(handlers.get(JIMAKU_CHANNELS.clearApiKey)!(event)).toEqual(STATUS)
    await expect(handlers.get(JIMAKU_CHANNELS.testConnection)!(event)).resolves.toEqual(STATUS)
    expect(handlers.get(JIMAKU_CHANNELS.getFolderHint)!(event, '/media/Show - 01.mkv', 2)).toEqual(
      HINT
    )
    expect(
      handlers.get(JIMAKU_CHANNELS.setFolderHint)!(event, '/media/Show - 01.mkv', {
        entryId: 42,
        name: 'Show',
        category: 'anime',
        season: 2
      })
    ).toEqual(HINT)
    expect(
      handlers.get(JIMAKU_CHANNELS.clearFolderHint)!(event, '/media/Show - 01.mkv', 2)
    ).toBeUndefined()

    expect(service.getStatus).toHaveBeenCalledOnce()
    expect(service.setApiKey).toHaveBeenCalledWith('api-key')
    expect(service.clearApiKey).toHaveBeenCalledOnce()
    expect(service.testConnection).toHaveBeenCalledOnce()
    expect(service.getFolderHint).toHaveBeenCalledWith('/media/Show - 01.mkv', 2)
    expect(service.setFolderHint).toHaveBeenCalledWith('/media/Show - 01.mkv', {
      entryId: 42,
      name: 'Show',
      category: 'anime',
      season: 2
    })
    expect(service.clearFolderHint).toHaveBeenCalledWith('/media/Show - 01.mkv', 2)
  })

  it.each([null, 42, [], {}, { value: 'api-key' }])(
    'rejects a non-string key payload %j before delegation',
    (payload) => {
      const { ipc, handlers } = fakeIpc()
      const service = {
        getStatus: vi.fn(() => STATUS),
        setApiKey: vi.fn(() => STATUS),
        clearApiKey: vi.fn(() => STATUS),
        testConnection: vi.fn(async () => STATUS),
        getFolderHint: vi.fn(() => undefined),
        setFolderHint: vi.fn(() => HINT),
        clearFolderHint: vi.fn()
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
