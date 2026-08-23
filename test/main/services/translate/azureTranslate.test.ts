import { describe, expect, it, vi } from 'vitest'
import {
  azureTranslateUrl,
  createAzureTranslator,
  MAX_AZURE_TRANSLATE_CHARS,
  parseAzureTranslateResponse
} from '@src/main/services/translate/azureTranslate'
import { fakeHttp } from '@test/harness/fakeHttp'

const AZURE_URL = azureTranslateUrl('ja', 'en')
const AZURE_KEY = 'test-azure-key'
const ASTRAL = '𝔘'

describe('azureTranslateUrl', () => {
  it('encodes source and target language parameters', () => {
    expect(azureTranslateUrl('ja&from=secret', 'en US')).toBe(
      'https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&from=ja%26from%3Dsecret&to=en%20US'
    )
  })
})

describe('parseAzureTranslateResponse', () => {
  it('returns the first translation text from the documented response shape', () => {
    expect(
      parseAzureTranslateResponse([
        {
          translations: [
            { text: 'Hello', to: 'en' },
            { text: 'ignored', to: 'de' }
          ]
        }
      ])
    ).toBe('Hello')
  })

  it.each([
    ['an empty top-level array', []],
    ['a non-object first result', ['invalid']],
    ['a result without translations', [{}]],
    ['an empty translations array', [{ translations: [] }]],
    ['a translation with non-string text', [{ translations: [{ text: 42 }] }]]
  ])('rejects %s with a sanitized error', (_description, payload) => {
    expect(() => parseAzureTranslateResponse(payload)).toThrow(
      'Translation returned an unexpected response.'
    )
  })
})

describe('createAzureTranslator', () => {
  it('sends the documented Global Translator request and parses the response', async () => {
    const http = fakeHttp({
      [AZURE_URL]: { json: [{ translations: [{ text: 'Hello', to: 'en' }] }] }
    })
    const translator = createAzureTranslator({
      fetch: http.fetch,
      getSubscriptionKey: () => AZURE_KEY
    })

    await expect(translator.translate('  こんにちは  ')).resolves.toBe('Hello')
    expect(http.calls).toEqual([
      {
        url: AZURE_URL,
        init: {
          method: 'POST',
          headers: {
            'Ocp-Apim-Subscription-Key': AZURE_KEY,
            'Content-Type': 'application/json; charset=UTF-8'
          },
          body: '[{"Text":"こんにちは"}]'
        }
      }
    ])
  })

  it('adds the required authentication header for a regional resource', async () => {
    const http = fakeHttp({
      [AZURE_URL]: { json: [{ translations: [{ text: 'Hello', to: 'en' }] }] }
    })
    const translator = createAzureTranslator({
      fetch: http.fetch,
      getSubscriptionKey: () => AZURE_KEY,
      getSubscriptionRegion: () => '  westeurope  '
    })

    await expect(translator.translate('こんにちは')).resolves.toBe('Hello')
    expect(http.calls[0].init?.headers).toEqual({
      'Ocp-Apim-Subscription-Key': AZURE_KEY,
      'Ocp-Apim-Subscription-Region': 'westeurope',
      'Content-Type': 'application/json; charset=UTF-8'
    })
  })

  it('honors explicit source and target languages', async () => {
    const url = azureTranslateUrl('ja-JP', 'en-US')
    const http = fakeHttp({ [url]: { json: [{ translations: [{ text: 'Hello' }] }] } })
    const translator = createAzureTranslator({
      fetch: http.fetch,
      getSubscriptionKey: () => AZURE_KEY
    })

    await expect(translator.translate('こんにちは', 'ja-JP', 'en-US')).resolves.toBe('Hello')
    expect(http.calls[0].url).toBe(url)
  })

  it('does not read the key or call HTTP for blank input', async () => {
    const http = fakeHttp({})
    const getSubscriptionKey = vi.fn(() => AZURE_KEY)

    await expect(
      createAzureTranslator({ fetch: http.fetch, getSubscriptionKey }).translate(' \n ')
    ).resolves.toBe('')

    expect(getSubscriptionKey).not.toHaveBeenCalled()
    expect(http.calls).toEqual([])
  })

  it('reads the key for every non-blank request', async () => {
    const http = fakeHttp({ [AZURE_URL]: { json: [{ translations: [{ text: 'ok' }] }] } })
    const keys = ['first-key', 'second-key']
    const getSubscriptionKey = vi.fn(() => keys.shift() ?? '')
    const translator = createAzureTranslator({ fetch: http.fetch, getSubscriptionKey })

    await translator.translate('one')
    await translator.translate('two')

    expect(getSubscriptionKey).toHaveBeenCalledTimes(2)
    expect(http.calls.map(({ init }) => init?.headers?.['Ocp-Apim-Subscription-Key'])).toEqual([
      'first-key',
      'second-key'
    ])
  })

  it('rejects a missing key without calling HTTP', async () => {
    const http = fakeHttp({})
    const getSubscriptionKey = vi.fn(() => '  ')

    await expect(
      createAzureTranslator({ fetch: http.fetch, getSubscriptionKey }).translate('secret subtitle')
    ).rejects.toThrow('Translation is not configured.')
    expect(http.calls).toEqual([])
  })

  it('forwards the caller signal and sanitizes abort failures', async () => {
    const http = fakeHttp({ [AZURE_URL]: { deferred: true } })
    const controller = new AbortController()
    const translation = createAzureTranslator({
      fetch: http.fetch,
      getSubscriptionKey: () => AZURE_KEY
    }).translate('こんにちは', 'ja', 'en', controller.signal)

    controller.abort()

    await expect(translation).rejects.toThrow('Translation failed.')
    expect(http.calls).toEqual([
      {
        url: AZURE_URL,
        init: expect.objectContaining({ signal: controller.signal })
      }
    ])
  })

  it.each([401, 429])(
    'maps HTTP %s without reading or exposing the response body',
    async (status) => {
      const http = fakeHttp({ [AZURE_URL]: { status, text: 'secret Azure error body' } })
      const error = await createAzureTranslator({
        fetch: http.fetch,
        getSubscriptionKey: () => AZURE_KEY
      })
        .translate('secret subtitle')
        .catch((caught: unknown) => caught)

      expect(error).toEqual(new Error(`Translation failed (HTTP ${status}).`))
      expect(String(error)).not.toContain('secret')
    }
  )

  it('accepts exactly 50,000 Unicode code points and preserves astral characters', async () => {
    const text = ASTRAL.repeat(MAX_AZURE_TRANSLATE_CHARS)
    const http = fakeHttp({ [AZURE_URL]: { json: [{ translations: [{ text: 'ok' }] }] } })

    await expect(
      createAzureTranslator({ fetch: http.fetch, getSubscriptionKey: () => AZURE_KEY }).translate(
        text
      )
    ).resolves.toBe('ok')

    const body = JSON.parse(http.calls[0].init?.body ?? '') as Array<{ Text: string }>
    expect(body).toHaveLength(1)
    expect(body[0].Text).toBe(text)
    expect([...body[0].Text]).toHaveLength(MAX_AZURE_TRANSLATE_CHARS)
    expect(body[0].Text).not.toMatch(/\p{Surrogate}/u)
  })

  it('rejects 50,001 Unicode code points without truncating or calling HTTP', async () => {
    const http = fakeHttp({})
    const text = `a${ASTRAL.repeat(MAX_AZURE_TRANSLATE_CHARS)}`

    await expect(
      createAzureTranslator({ fetch: http.fetch, getSubscriptionKey: () => AZURE_KEY }).translate(
        text
      )
    ).rejects.toThrow('50,000-character limit')
    expect(http.calls).toEqual([])
  })

  it('rejects malformed JSON payloads with a sanitized error', async () => {
    const http = fakeHttp({ [AZURE_URL]: { json: { translations: 'invalid' } } })

    await expect(
      createAzureTranslator({ fetch: http.fetch, getSubscriptionKey: () => AZURE_KEY }).translate(
        'secret subtitle'
      )
    ).rejects.toThrow('Translation returned an unexpected response.')
  })
})
