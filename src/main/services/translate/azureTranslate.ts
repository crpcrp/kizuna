import type { HttpFetch, HttpRequest } from '../http'
import type { Translator } from './translator'

export const MAX_AZURE_TRANSLATE_CHARS = 50_000

const AZURE_TRANSLATE_ENDPOINT = 'https://api.cognitive.microsofttranslator.com/translate'
const UNEXPECTED_RESPONSE_MESSAGE = 'Translation returned an unexpected response.'
const TRANSLATION_FAILURE_MESSAGE = 'Translation failed.'
const NOT_CONFIGURED_MESSAGE = 'Translation is not configured.'
const TEXT_TOO_LONG_MESSAGE = "Translation text exceeds Azure's 50,000-character limit."

export interface CreateAzureTranslatorOptions {
  fetch: HttpFetch
  getSubscriptionKey: () => string
  getSubscriptionRegion?: () => string
}

export function azureTranslateUrl(sourceLang: string, targetLang: string): string {
  return `${AZURE_TRANSLATE_ENDPOINT}?api-version=3.0&from=${encodeURIComponent(sourceLang)}&to=${encodeURIComponent(targetLang)}`
}

export function parseAzureTranslateResponse(raw: unknown): string {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(UNEXPECTED_RESPONSE_MESSAGE)
  }

  const firstResult = raw[0]
  if (typeof firstResult !== 'object' || firstResult === null || Array.isArray(firstResult)) {
    throw new Error(UNEXPECTED_RESPONSE_MESSAGE)
  }

  const translations = (firstResult as { translations?: unknown }).translations
  if (!Array.isArray(translations) || translations.length === 0) {
    throw new Error(UNEXPECTED_RESPONSE_MESSAGE)
  }

  const firstTranslation = translations[0]
  if (
    typeof firstTranslation !== 'object' ||
    firstTranslation === null ||
    Array.isArray(firstTranslation)
  ) {
    throw new Error(UNEXPECTED_RESPONSE_MESSAGE)
  }

  const text = (firstTranslation as { text?: unknown }).text
  if (typeof text !== 'string' || text === '') throw new Error(UNEXPECTED_RESPONSE_MESSAGE)

  return text
}

export function createAzureTranslator({
  fetch,
  getSubscriptionKey,
  getSubscriptionRegion = () => ''
}: CreateAzureTranslatorOptions): Translator {
  return {
    async translate(text, sourceLang = 'ja', targetLang = 'en', signal): Promise<string> {
      const query = text.trim()
      if (query === '') return ''

      const subscriptionKey = getSubscriptionKey().trim()
      if (subscriptionKey === '') throw new Error(NOT_CONFIGURED_MESSAGE)
      const subscriptionRegion = getSubscriptionRegion().trim()
      if ([...query].length > MAX_AZURE_TRANSLATE_CHARS) {
        throw new Error(TEXT_TOO_LONG_MESSAGE)
      }

      const headers: Record<string, string> = {
        'Ocp-Apim-Subscription-Key': subscriptionKey,
        'Content-Type': 'application/json; charset=UTF-8'
      }
      if (subscriptionRegion !== '') {
        headers['Ocp-Apim-Subscription-Region'] = subscriptionRegion
      }

      const init: HttpRequest = {
        method: 'POST',
        headers,
        body: JSON.stringify([{ Text: query }])
      }
      if (signal !== undefined) init.signal = signal

      let response
      try {
        response = await fetch(azureTranslateUrl(sourceLang, targetLang), init)
      } catch {
        throw new Error(TRANSLATION_FAILURE_MESSAGE)
      }
      if (!response.ok) {
        throw new Error(`Translation failed (HTTP ${response.status}).`)
      }

      try {
        return parseAzureTranslateResponse(await response.json())
      } catch {
        throw new Error(UNEXPECTED_RESPONSE_MESSAGE)
      }
    }
  }
}
