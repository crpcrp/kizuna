import { isRecord, isString } from '../shared/guards'
import { TRANSLATE_CHANNELS } from '../shared/ipcChannels'
import type { PublicTranslationSettings, TranslationSettingsPatch } from '../shared/translation'
import type { IpcMainHandleLike } from './ipc'
import { expect, optional } from './ipcValidation'

export interface TranslationSettingsServiceLike {
  getSettings(): PublicTranslationSettings
  setSettings(patch: TranslationSettingsPatch): PublicTranslationSettings
}

const PATCH_KEYS = ['azureSubscriptionKey', 'azureRegion']

function isSettingsPatch(value: unknown): value is TranslationSettingsPatch {
  return (
    isRecord(value) &&
    Object.keys(value).every((key) => PATCH_KEYS.includes(key)) &&
    optional(isString)(value.azureSubscriptionKey) &&
    optional(isString)(value.azureRegion)
  )
}

export function registerTranslationSettingsBridge<E>(
  ipc: IpcMainHandleLike<E>,
  service: TranslationSettingsServiceLike
): void {
  const parsePatch = expect(isSettingsPatch, TRANSLATE_CHANNELS.setSettings)
  ipc.handle(TRANSLATE_CHANNELS.getSettings, () => service.getSettings())
  ipc.handle(TRANSLATE_CHANNELS.setSettings, (_event, value) =>
    service.setSettings(parsePatch(value))
  )
}
