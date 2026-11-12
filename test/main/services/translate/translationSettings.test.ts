import { describe, expect, it } from 'vitest'
import { createTranslationSettingsService } from '@src/main/services/translate/translationSettings'
import { identityCodec } from '@src/main/services/secrets'
import { createSettingsStore } from '@src/main/services/settings'
import { fakeIo } from '@test/harness/fakeSettingsIo'
import { reversingCodec } from '@test/harness/fakeSecrets'

describe('createTranslationSettingsService', () => {
  it('reports the identity fallback honestly while still reading the key', () => {
    const settings = createSettingsStore(fakeIo(undefined))
    const service = createTranslationSettingsService({ settings, secrets: identityCodec })

    service.setSettings({ azureSubscriptionKey: 'test-azure-key' })

    expect(service.getSettings()).toEqual({
      hasAzureKey: true,
      azureRegion: '',
      encryptionAvailable: false
    })
    expect(service.getAzureSubscriptionKey()).toBe('test-azure-key')
  })

  it('reads changes made through the settings store without restarting', () => {
    const settings = createSettingsStore(fakeIo(undefined))
    const service = createTranslationSettingsService({ settings, secrets: reversingCodec })

    settings.set({
      translation: { azureSubscriptionKeyEnc: reversingCodec.encrypt('first-key'), azureRegion: '' }
    })
    expect(service.getAzureSubscriptionKey()).toBe('first-key')

    settings.set({
      translation: {
        azureSubscriptionKeyEnc: reversingCodec.encrypt('second-key'),
        azureRegion: ''
      }
    })
    expect(service.getAzureSubscriptionKey()).toBe('second-key')

    settings.set({ translation: { azureSubscriptionKeyEnc: '', azureRegion: '' } })
    expect(service.getSettings().hasAzureKey).toBe(false)
  })

  it('stores a trimmed region without replacing the encrypted key', () => {
    const settings = createSettingsStore(fakeIo(undefined))
    const service = createTranslationSettingsService({ settings, secrets: reversingCodec })
    service.setSettings({ azureSubscriptionKey: 'test-azure-key' })

    expect(service.setSettings({ azureRegion: '  westeurope  ' })).toEqual({
      hasAzureKey: true,
      azureRegion: 'westeurope',
      encryptionAvailable: true
    })
    expect(service.getAzureSubscriptionKey()).toBe('test-azure-key')
    expect(service.getAzureRegion()).toBe('westeurope')
  })
})
