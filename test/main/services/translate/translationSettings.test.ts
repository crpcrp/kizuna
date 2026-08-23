import { describe, expect, it } from 'vitest'
import { createTranslationSettingsService } from '@src/main/services/translate/translationSettings'
import { identityCodec, type SecretCodec } from '@src/main/services/secrets'
import { createSettingsStore } from '@src/main/services/settings'
import { fakeIo } from '@test/harness/fakeSettingsIo'
import { reversingCodec } from '@test/harness/fakeSecrets'

describe('createTranslationSettingsService', () => {
  it('stores trimmed keys encrypted and exposes only public status', () => {
    const io = fakeIo(undefined)
    const settings = createSettingsStore(io)
    const service = createTranslationSettingsService({ settings, secrets: reversingCodec })

    expect(service.setSettings({ azureSubscriptionKey: '  test-azure-key  ' })).toEqual({
      hasAzureKey: true,
      azureRegion: '',
      encryptionAvailable: true
    })
    expect(service.getAzureSubscriptionKey()).toBe('test-azure-key')
    expect(settings.get().translation.azureSubscriptionKeyEnc).toBe('yek-eruza-tset')
    expect(io.read()).not.toContain('test-azure-key')
    expect(service.getSettings()).not.toHaveProperty('azureSubscriptionKey')
    expect(JSON.stringify(service.getSettings())).not.toContain('test-azure-key')
  })

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

  it('clears a key supplied as empty or whitespace-only text', () => {
    const settings = createSettingsStore(fakeIo(undefined))
    const service = createTranslationSettingsService({ settings, secrets: reversingCodec })
    service.setSettings({ azureSubscriptionKey: 'test-azure-key' })

    expect(service.setSettings({ azureSubscriptionKey: '   ' })).toEqual({
      hasAzureKey: false,
      azureRegion: '',
      encryptionAvailable: true
    })
    expect(settings.get().translation.azureSubscriptionKeyEnc).toBe('')
    expect(service.getAzureSubscriptionKey()).toBe('')
  })

  it('reports a failed decrypt as not configured', () => {
    const settings = createSettingsStore(
      fakeIo(
        JSON.stringify({
          translation: { azureSubscriptionKeyEnc: 'corrupt-blob', azureRegion: '' }
        })
      )
    )
    const secrets: SecretCodec = {
      encrypt: (value) => value,
      decrypt: () => {
        throw new Error('decrypt failed')
      },
      isAvailable: () => true
    }
    const service = createTranslationSettingsService({ settings, secrets })

    expect(service.getSettings()).toEqual({
      hasAzureKey: false,
      azureRegion: '',
      encryptionAvailable: true
    })
    expect(service.getAzureSubscriptionKey()).toBe('')
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
