import { TRANSLATE_CHANNELS } from '../shared/ipcChannels'
import type { PublicTranslationSettings, TranslationSettingsPatch } from '../shared/translation'
import type { IpcMainHandleLike } from './ipc'

export interface TranslationSettingsServiceLike {
  getSettings(): PublicTranslationSettings
  setSettings(patch: TranslationSettingsPatch): PublicTranslationSettings
}

const INVALID_SETTINGS = 'Invalid translation settings.'

function invalidSettings(): Error {
  return new Error(INVALID_SETTINGS)
}

function parseSettingsPatch(value: unknown): TranslationSettingsPatch {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalidSettings()
  }

  const object = value as Record<string, unknown>
  if (Object.keys(object).some((key) => !['azureSubscriptionKey', 'azureRegion'].includes(key))) {
    throw invalidSettings()
  }

  const patch: TranslationSettingsPatch = {}
  if (Object.prototype.hasOwnProperty.call(object, 'azureSubscriptionKey')) {
    if (typeof object.azureSubscriptionKey !== 'string') throw invalidSettings()
    patch.azureSubscriptionKey = object.azureSubscriptionKey
  }
  if (Object.prototype.hasOwnProperty.call(object, 'azureRegion')) {
    if (typeof object.azureRegion !== 'string') throw invalidSettings()
    patch.azureRegion = object.azureRegion
  }
  return patch
}

export function registerTranslationSettingsBridge<E>(
  ipc: IpcMainHandleLike<E>,
  service: TranslationSettingsServiceLike
): void {
  ipc.handle(TRANSLATE_CHANNELS.getSettings, () => service.getSettings())
  ipc.handle(TRANSLATE_CHANNELS.setSettings, (_event, value) =>
    service.setSettings(parseSettingsPatch(value))
  )
}
