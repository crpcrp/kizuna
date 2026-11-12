import { decodeSubtitleBytes } from '../../media/subtitleEncoding'
import { pickParser } from '../../media/subtitleLoader'
import { HttpBodyTooLargeError, isTimeoutError, readBody, type HttpFetch } from '../http'
import { JIMAKU_API_ORIGIN } from './client'
import type { JimakuDownloadResult, JimakuSubtitleFormat } from './downloadStore'
import { fail, ok } from './result'

export const JIMAKU_DOWNLOAD_ORIGIN = JIMAKU_API_ORIGIN
export const JIMAKU_DOWNLOAD_TIMEOUT_MS = 60_000
const JIMAKU_MAX_REDIRECTS = 3
export type JimakuManagedFormat = JimakuSubtitleFormat | 'zip'

export async function downloadContent(
  fetch: HttpFetch,
  initialUrl: string,
  entryId: number,
  format: JimakuManagedFormat,
  requestMaxBytes: number,
  signal?: AbortSignal
): Promise<JimakuDownloadResult<Uint8Array>> {
  if (signal?.aborted) return fail({ code: 'cancelled' })

  let bytes: Uint8Array
  try {
    let url = initialUrl
    let redirectCount = 0
    while (true) {
      const response = await fetch(url, {
        method: 'GET',
        redirect: 'manual',
        signal,
        timeoutMs: JIMAKU_DOWNLOAD_TIMEOUT_MS
      })

      if (isRedirect(response.status)) {
        if (redirectCount >= JIMAKU_MAX_REDIRECTS) return fail({ code: 'invalidResponse' })
        const location = response.headers.get('location')
        if (location === null) return fail({ code: 'invalidResponse' })
        let next: URL
        try {
          next = new URL(location, url)
        } catch {
          return fail({ code: 'unsupportedDownload', recoveryUrl: recoveryUrl(entryId) })
        }
        const allowed = allowedDownloadUrl(next.toString(), entryId)
        if (allowed === undefined)
          return fail({ code: 'unsupportedDownload', recoveryUrl: recoveryUrl(entryId) })
        url = allowed
        redirectCount += 1
        continue
      }

      if (response.status === 401 || response.status === 403) return fail({ code: 'unauthorized' })
      if (response.status === 404) return fail({ code: 'notFound' })
      if (response.status === 429) return fail({ code: 'rateLimited' })
      if (response.status >= 500 && response.status <= 599) {
        return fail({ code: 'serviceUnavailable' })
      }
      if (response.status < 200 || response.status >= 300) {
        return fail({ code: 'invalidResponse' })
      }

      const advertisedSize = parseContentLength(response.headers.get('content-length'))
      if (advertisedSize !== undefined && advertisedSize > requestMaxBytes) {
        return fail({ code: 'tooLarge' })
      }

      bytes = await readBody(response, requestMaxBytes)
      break
    }
  } catch (error) {
    if (signal?.aborted) return fail({ code: 'cancelled' })
    if (isTimeoutError(error)) return fail({ code: 'timeout' })
    if (error instanceof HttpBodyTooLargeError) return fail({ code: 'tooLarge' })
    return fail({ code: 'network' })
  }

  if (isSubtitleFormat(format)) {
    const valid = validateSubtitleBytes(bytes, format)
    if (!valid.ok) return valid
  }

  return ok(bytes)
}

export function validateSubtitleBytes(
  bytes: Uint8Array,
  format: JimakuSubtitleFormat
): JimakuDownloadResult<true> {
  try {
    const text = decodeSubtitleBytes(bytes, 'auto')
    if (looksLikeHtmlOrLogin(text)) return fail({ code: 'invalidSubtitle' })
    const cues = pickParser(`jimaku.${format}`)(text)
    if (!Array.isArray(cues) || cues.length === 0) return fail({ code: 'invalidSubtitle' })
  } catch {
    return fail({ code: 'invalidSubtitle' })
  }
  return ok(true)
}

export function subtitleFormat(name: string): JimakuManagedFormat | undefined {
  const dot = name.lastIndexOf('.')
  if (dot < 0) return undefined
  const extension = name.slice(dot + 1).toLowerCase()
  if (extension === 'srt' || extension === 'ass' || extension === 'ssa' || extension === 'zip') {
    return extension
  }
  return undefined
}

export function allowedDownloadUrl(value: string, entryId: number): string | undefined {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return undefined
  }
  if (url.origin !== JIMAKU_DOWNLOAD_ORIGIN || url.protocol !== 'https:') return undefined
  const prefix = `/entry/${entryId}/download/`
  if (!url.pathname.startsWith(prefix) || url.pathname.length <= prefix.length) return undefined
  return url.toString()
}

function recoveryUrl(entryId: number): string {
  return `${JIMAKU_DOWNLOAD_ORIGIN}/entry/${entryId}`
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308
}

function parseContentLength(value: string | null): number | undefined {
  if (value === null || value.trim() === '') return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined
}

function looksLikeHtmlOrLogin(text: string): boolean {
  const prefix = text.trimStart().slice(0, 512).toLowerCase()
  return (
    prefix.startsWith('<!doctype html') ||
    prefix.startsWith('<html') ||
    prefix.startsWith('<head') ||
    prefix.startsWith('<body') ||
    prefix.startsWith('<form') ||
    (prefix.includes('<html') && prefix.includes('login'))
  )
}

export function isSubtitleFormat(value: unknown): value is JimakuSubtitleFormat {
  return value === 'srt' || value === 'ass' || value === 'ssa'
}
