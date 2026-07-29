import { describe, expect, it } from 'vitest'
import {
  createGoogleTranslator,
  googleTranslateUrl,
  MAX_TRANSLATE_CHARS,
  parseGoogleTranslateResponse,
  truncateCodePoints
} from '@src/main/services/translate/googleTranslate'
import { fakeHttp } from '@test/harness/fakeHttp'

/** An astral (non-BMP) character: one code point, two UTF-16 units. */
const ASTRAL = '𝔘'

describe('truncateCodePoints', () => {
  it('counts code points, so a surrogate pair is never split', () => {
    const truncated = truncateCodePoints(`a${ASTRAL.repeat(3)}`, 3)

    expect(truncated).toBe(`a${ASTRAL.repeat(2)}`)
    expect([...truncated]).toHaveLength(3)
    expect(() => encodeURIComponent(truncated)).not.toThrow()
  })

  it('leaves BMP text and short input untouched', () => {
    expect(truncateCodePoints('こんにちは', 3)).toBe('こんに')
    expect(truncateCodePoints('こんにちは', 5)).toBe('こんにちは')
    expect(truncateCodePoints('こんにちは', 99)).toBe('こんにちは')
    expect(truncateCodePoints('', 3)).toBe('')
  })

  it('normalizes a zero, negative, fractional, or non-finite limit', () => {
    expect(truncateCodePoints('こんにちは', 0)).toBe('')
    expect(truncateCodePoints('こんにちは', -1)).toBe('')
    expect(truncateCodePoints('こんにちは', Number.NaN)).toBe('')
    expect(truncateCodePoints('こんにちは', Number.POSITIVE_INFINITY)).toBe('')
    expect(truncateCodePoints('こんにちは', 2.9)).toBe('こん')
  })
})

describe('googleTranslateUrl', () => {
  it('encodes Japanese text, ampersands, and newlines for the gtx endpoint', () => {
    expect(googleTranslateUrl('こんにちは&\n世界', 'ja', 'en')).toBe(
      'https://translate.googleapis.com/translate_a/single?client=gtx&sl=ja&tl=en&dt=t&q=%E3%81%93%E3%82%93%E3%81%AB%E3%81%A1%E3%81%AF%26%0A%E4%B8%96%E7%95%8C'
    )
  })

  it('truncates text before encoding it', () => {
    const url = googleTranslateUrl(`${'あ'.repeat(MAX_TRANSLATE_CHARS)}終`, 'ja', 'en')

    expect(new URL(url).searchParams.get('q')).toBe('あ'.repeat(MAX_TRANSLATE_CHARS))
  })

  it('caps astral text at the code-point limit without splitting a surrogate pair', () => {
    // The leading ASCII unit puts UTF-16 index MAX_TRANSLATE_CHARS inside a pair,
    // which a String.slice cut would have turned into a lone surrogate.
    const text = `a${ASTRAL.repeat(MAX_TRANSLATE_CHARS)}`

    expect(() => googleTranslateUrl(text, 'ja', 'en')).not.toThrow()

    const query = new URL(googleTranslateUrl(text, 'ja', 'en')).searchParams.get('q')
    expect(query).toBe(`a${ASTRAL.repeat(MAX_TRANSLATE_CHARS - 1)}`)
    expect([...(query ?? '')]).toHaveLength(MAX_TRANSLATE_CHARS)
    expect(query).not.toMatch(/\p{Surrogate}/u)
  })
})

describe('parseGoogleTranslateResponse', () => {
  it('concatenates translated segments', () => {
    expect(
      parseGoogleTranslateResponse([
        [
          ['Good ', 'ignored'],
          ['morning', 'ignored']
        ]
      ])
    ).toBe('Good morning')
  })

  it('rejects malformed payloads with a sanitized error', () => {
    expect(() => parseGoogleTranslateResponse({ translation: 'hello' })).toThrow(
      'Translation returned an unexpected response.'
    )
  })
})

describe('createGoogleTranslator', () => {
  it('uses the fake HTTP boundary and translates the response', async () => {
    const url = googleTranslateUrl('こんにちは', 'ja', 'en')
    const http = fakeHttp({ [url]: { json: [[['Hello', 'こんにちは']]] } })
    const translator = createGoogleTranslator(http.fetch)

    await expect(translator.translate('  こんにちは  ')).resolves.toBe('Hello')
    expect(http.calls).toEqual([{ url, init: undefined }])
  })

  it('does not call the network for blank input', async () => {
    const http = fakeHttp({})

    await expect(createGoogleTranslator(http.fetch).translate(' \n ')).resolves.toBe('')
    expect(http.calls).toEqual([])
  })

  it('forwards the caller signal and translates a response that settles before abort', async () => {
    const url = googleTranslateUrl('こんにちは', 'ja', 'en')
    const http = fakeHttp({ [url]: { json: [[['Hello']]] } })
    const controller = new AbortController()

    await expect(
      createGoogleTranslator(http.fetch).translate('こんにちは', 'ja', 'en', controller.signal)
    ).resolves.toBe('Hello')
    controller.abort()

    expect(http.calls).toEqual([{ url, init: { signal: controller.signal } }])
  })

  it('maps a caller-aborted deferred request to the sanitized failure', async () => {
    const url = googleTranslateUrl('こんにちは', 'ja', 'en')
    const http = fakeHttp({ [url]: { deferred: true } })
    const controller = new AbortController()
    const translation = createGoogleTranslator(http.fetch).translate(
      'こんにちは',
      'ja',
      'en',
      controller.signal
    )

    controller.abort()

    await expect(translation).rejects.toThrow('Translation failed.')
    expect(http.calls).toEqual([{ url, init: { signal: controller.signal } }])
  })

  it('reports HTTP failures without exposing the subtitle text', async () => {
    const url = googleTranslateUrl('secret subtitle', 'ja', 'en')
    const http = fakeHttp({ [url]: { status: 429 } })

    await expect(createGoogleTranslator(http.fetch).translate('secret subtitle')).rejects.toThrow(
      'Translation failed (HTTP 429).'
    )
  })

  it('reports malformed response shapes with a sanitized error', async () => {
    const url = googleTranslateUrl('壊れた', 'ja', 'en')
    const http = fakeHttp({ [url]: { json: { unexpected: true } } })

    await expect(createGoogleTranslator(http.fetch).translate('壊れた')).rejects.toThrow(
      'Translation returned an unexpected response.'
    )
  })
})
