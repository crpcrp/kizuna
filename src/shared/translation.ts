export interface PublicTranslationSettings {
  hasAzureKey: boolean
  encryptionAvailable?: boolean
}

export interface TranslationSettingsPatch {
  azureSubscriptionKey?: string
}
