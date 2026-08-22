import type {
  PublicTranslationSettings,
  TranslationSettingsPatch
} from '../../../shared/translation'
import { readSecret, type SecretCodec } from '../secrets'
import type { SettingsStore } from '../settings'

export interface TranslationSettingsService {
  getSettings(): PublicTranslationSettings
  setSettings(patch: TranslationSettingsPatch): PublicTranslationSettings
  getAzureSubscriptionKey(): string
}

export interface CreateTranslationSettingsServiceDeps {
  settings: SettingsStore
  secrets: SecretCodec
}

const SAVE_FAILURE = 'Could not save translation settings.'

export function createTranslationSettingsService(
  deps: CreateTranslationSettingsServiceDeps
): TranslationSettingsService {
  const readAzureSubscriptionKey = (): string => {
    try {
      return readSecret(deps.secrets, deps.settings.get().translation.azureSubscriptionKeyEnc)
    } catch {
      return ''
    }
  }

  const getSettings = (): PublicTranslationSettings => ({
    hasAzureKey: readAzureSubscriptionKey() !== '',
    encryptionAvailable: deps.secrets.isAvailable()
  })

  return {
    getSettings,

    setSettings(patch: TranslationSettingsPatch): PublicTranslationSettings {
      if (patch.azureSubscriptionKey === undefined) return getSettings()

      const key = patch.azureSubscriptionKey.trim()
      try {
        deps.settings.set({
          translation: {
            ...deps.settings.get().translation,
            azureSubscriptionKeyEnc: key === '' ? '' : deps.secrets.encrypt(key)
          }
        })
      } catch {
        throw new Error(SAVE_FAILURE)
      }
      return getSettings()
    },

    getAzureSubscriptionKey(): string {
      return readAzureSubscriptionKey()
    }
  }
}
