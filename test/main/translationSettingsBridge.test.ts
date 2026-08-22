import { describe, expect, it, vi } from 'vitest'
import { TRANSLATE_CHANNELS } from '@src/shared/ipcChannels'
import type { PublicTranslationSettings } from '@src/shared/translation'
import { registerTranslationSettingsBridge } from '@src/main/translationSettingsBridge'
import { fakeIpc, type FakeEvent } from '@test/harness/fakeIpcMain'

const PUBLIC_SETTINGS: PublicTranslationSettings = {
  hasAzureKey: true,
  encryptionAvailable: true
}

describe('registerTranslationSettingsBridge', () => {
  it('registers and delegates get/set settings', async () => {
    const { ipc, handlers } = fakeIpc()
    const event: FakeEvent = { senderId: 1 }
    const service = {
      getSettings: vi.fn(() => PUBLIC_SETTINGS),
      setSettings: vi.fn(() => PUBLIC_SETTINGS)
    }
    registerTranslationSettingsBridge(ipc, service)

    expect(handlers.get(TRANSLATE_CHANNELS.getSettings)!(event)).toEqual(PUBLIC_SETTINGS)
    expect(
      handlers.get(TRANSLATE_CHANNELS.setSettings)!(event, {
        azureSubscriptionKey: 'test-azure-key'
      })
    ).toEqual(PUBLIC_SETTINGS)

    expect(service.getSettings).toHaveBeenCalledOnce()
    expect(service.setSettings).toHaveBeenCalledWith({ azureSubscriptionKey: 'test-azure-key' })
  })

  it.each([null, [], { azureSubscriptionKey: 42 }, { unexpected: 'value' }])(
    'rejects malformed setSettings payload %j without leaking it',
    (payload) => {
      const { ipc, handlers } = fakeIpc()
      const event: FakeEvent = { senderId: 1 }
      const service = {
        getSettings: vi.fn(() => PUBLIC_SETTINGS),
        setSettings: vi.fn(() => PUBLIC_SETTINGS)
      }
      registerTranslationSettingsBridge(ipc, service)

      expect(() => handlers.get(TRANSLATE_CHANNELS.setSettings)!(event, payload)).toThrow(
        'Invalid translation settings.'
      )
      expect(service.setSettings).not.toHaveBeenCalled()
    }
  )
})
