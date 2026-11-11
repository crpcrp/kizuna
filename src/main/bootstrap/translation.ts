import { httpFetch } from '../services/http'
import { createAzureTranslator } from '../services/translate/azureTranslate'
import { createTranslationSettingsService } from '../services/translate/translationSettings'
import { registerTranslateBridge } from '../translateBridge'
import { registerTranslationSettingsBridge } from '../translationSettingsBridge'
import type { BootstrapDeps } from './deps'

/** Registers the translation-settings and Azure translate IPC bridges. */
export function startTranslation(
  deps: Pick<BootstrapDeps, 'ipcMain' | 'settings' | 'secrets'>
): void {
  const translationSettings = createTranslationSettingsService({
    settings: deps.settings,
    secrets: deps.secrets
  })
  registerTranslationSettingsBridge(deps.ipcMain, translationSettings)
  registerTranslateBridge(
    deps.ipcMain,
    createAzureTranslator({
      fetch: httpFetch,
      getSubscriptionKey: () => translationSettings.getAzureSubscriptionKey(),
      getSubscriptionRegion: () => translationSettings.getAzureRegion()
    })
  )
}
