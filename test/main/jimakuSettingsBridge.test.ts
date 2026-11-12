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
