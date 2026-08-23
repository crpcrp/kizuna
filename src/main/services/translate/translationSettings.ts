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
  getAzureRegion(): string
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
    azureRegion: deps.settings.get().translation.azureRegion,
    encryptionAvailable: deps.secrets.isAvailable()
  })

  return {
    getSettings,

    setSettings(patch: TranslationSettingsPatch): PublicTranslationSettings {
      if (patch.azureSubscriptionKey === undefined && patch.azureRegion === undefined) {
        return getSettings()
      }

      const current = deps.settings.get().translation
      try {
        deps.settings.set({
          translation: {
            ...current,
            azureSubscriptionKeyEnc:
              patch.azureSubscriptionKey === undefined
                ? current.azureSubscriptionKeyEnc
                : patch.azureSubscriptionKey.trim() === ''
                  ? ''
                  : deps.secrets.encrypt(patch.azureSubscriptionKey.trim()),
            azureRegion: patch.azureRegion?.trim() ?? current.azureRegion
          }
        })
      } catch {
        throw new Error(SAVE_FAILURE)
      }
      return getSettings()
    },

    getAzureSubscriptionKey(): string {
      return readAzureSubscriptionKey()
    },

    getAzureRegion(): string {
      return deps.settings.get().translation.azureRegion
    }
  }
}
