import type { HttpFetch } from '../http'

/** Conservative worst-case cap for the gtx GET URL (Japanese text expands
 * heavily when URL encoded), counted in Unicode code points — not UTF-16 units
 * and not encoded bytes. */
export const MAX_TRANSLATE_CHARS = 1750

const GOOGLE_TRANSLATE_ENDPOINT = 'https://translate.googleapis.com/translate_a/single'
const UNEXPECTED_RESPONSE_MESSAGE = 'Translation returned an unexpected response.'

export interface Translator {
  /** Translates `text` (default ja→en). Rejects with a sanitized Error on
   * HTTP failure or malformed payload; resolves '' for blank input without
   * touching the network. */
  translate(
    text: string,
    sourceLang?: string,
    targetLang?: string,
    signal?: AbortSignal
  ): Promise<string>
}

/** Pure: the first `max` Unicode code points of `text`, so a surrogate pair is
 * never split (a lone surrogate makes encodeURIComponent throw). A non-finite or
 * negative `max` normalizes to 0 code points; a fractional one rounds down. */
export function truncateCodePoints(text: string, max: number): string {
  const limit = Number.isFinite(max) ? Math.floor(max) : 0
  if (limit <= 0) return ''

  let kept = 0
  let end = 0
  for (const codePoint of text) {
    if (kept === limit) break
    kept += 1
    end += codePoint.length
  }
  return end === text.length ? text : text.slice(0, end)
}

/** Pure: the gtx request URL for one text (text truncated to MAX_TRANSLATE_CHARS
 * code points). */
export function googleTranslateUrl(text: string, sourceLang: string, targetLang: string): string {
  const query = truncateCodePoints(text, MAX_TRANSLATE_CHARS)
  return `${GOOGLE_TRANSLATE_ENDPOINT}?client=gtx&sl=${encodeURIComponent(sourceLang)}&tl=${encodeURIComponent(targetLang)}&dt=t&q=${encodeURIComponent(query)}`
}

/** Pure: extracts the translated string from a parsed gtx payload; throws
 * Error('Translation returned an unexpected response.') on any shape drift. */
export function parseGoogleTranslateResponse(raw: unknown): string {
  if (!Array.isArray(raw) || !Array.isArray(raw[0])) {
    throw new Error(UNEXPECTED_RESPONSE_MESSAGE)
  }

  const segments = raw[0]
  if (
    segments.length === 0 ||
    !segments.every((segment) => Array.isArray(segment) && typeof segment[0] === 'string')
  ) {
    throw new Error(UNEXPECTED_RESPONSE_MESSAGE)
  }

  return segments.map((segment) => segment[0] as string).join('')
}

export function createGoogleTranslator(fetch: HttpFetch): Translator {
  return {
    async translate(text, sourceLang = 'ja', targetLang = 'en', signal): Promise<string> {
      const query = text.trim()
      if (query === '') return ''

      let response
      try {
        response = await fetch(
          googleTranslateUrl(query, sourceLang, targetLang),
          signal === undefined ? undefined : { signal }
        )
      } catch {
        throw new Error('Translation failed.')
      }
      if (!response.ok) {
        throw new Error(`Translation failed (HTTP ${response.status}).`)
      }

      try {
        return parseGoogleTranslateResponse(await response.json())
      } catch (error) {
        if (error instanceof Error && error.message === UNEXPECTED_RESPONSE_MESSAGE) throw error
        throw new Error(UNEXPECTED_RESPONSE_MESSAGE)
      }
    }
  }
}
