export interface PublicTranslationSettings {
  hasAzureKey: boolean
  azureRegion: string
  encryptionAvailable?: boolean
}

export interface TranslationSettingsPatch {
  azureSubscriptionKey?: string
  azureRegion?: string
}
