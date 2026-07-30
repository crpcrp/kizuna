// WaniKani API v2 client. Thin paginated reader over the injected HttpFetch
// boundary — no live WaniKani in a test, see test/harness/fakeHttp.ts.

import type { HttpFetch } from '../http'

export const WANIKANI_BASE = 'https://api.wanikani.com/v2/'
export const WANIKANI_REVISION = '20170710'
export const WANIKANI_REQUEST_TIMEOUT_MS = 15_000

export class WaniKaniAuthError extends Error {}

export interface WaniKaniClient {
  collection(path: string, params?: Record<string, string>): AsyncIterable<unknown[]>
}

interface WaniKaniPage {
  pages: { next_url: string | null; per_page: number }
  total_count: number
  data: unknown[]
}

type TimeoutHandle = ReturnType<typeof setTimeout>
type SetTimeoutFn = (callback: () => void, delayMs: number) => TimeoutHandle
type ClearTimeoutFn = (handle: TimeoutHandle) => void

function buildUrl(path: string, params?: Record<string, string>): string {
  const base = `${WANIKANI_BASE}${path}`
  if (!params) return base
  return `${base}?${new URLSearchParams(params).toString()}`
}

/**
 * Creates a `WaniKaniClient` that authenticates every request with
 * `deps.token` and follows `pages.next_url` until it is `null`. A `401`
 * throws `WaniKaniAuthError` rather than a generic HTTP error, so callers can
 * show "invalid WaniKani token" instead of a network failure. A `429` sleeps
 * until the `RateLimit-Reset` epoch-seconds header and retries once — `sleep`
 * is injected so tests never actually wait. Any other non-success status
 * rejects with an actionable HTTP error rather than letting a JSON parse or a
 * missing-`pages` access fail downstream.
 */
export function createWaniKaniClient(deps: {
  token: string
  fetch: HttpFetch
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  requestTimeoutMs?: number
  setTimeoutFn?: SetTimeoutFn
  clearTimeoutFn?: ClearTimeoutFn
}): WaniKaniClient {
  const {
    token,
    fetch,
    sleep = defaultSleep,
    now = Date.now,
    requestTimeoutMs = WANIKANI_REQUEST_TIMEOUT_MS,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout
  } = deps

  async function fetchWithAuth(url: string) {
    const controller = new AbortController()
    let timedOut = false
    const timer = setTimeoutFn(() => {
      timedOut = true
      controller.abort()
    }, requestTimeoutMs)
    try {
      return await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, 'Wanikani-Revision': WANIKANI_REVISION },
        signal: controller.signal
      })
    } catch (error) {
      if (timedOut) {
        throw new Error(`WaniKani request timed out after ${requestTimeoutMs}ms`)
      }
      throw error
    } finally {
      clearTimeoutFn(timer)
    }
  }

  async function fetchPage(url: string): Promise<WaniKaniPage> {
    let res = await fetchWithAuth(url)
    if (res.status === 429) {
      const resetHeader = res.headers.get('RateLimit-Reset')
      const resetEpochSec = resetHeader === null ? undefined : Number(resetHeader)
      const delayMs = resetEpochSec === undefined ? 0 : Math.max(0, resetEpochSec * 1000 - now())
      await sleep(delayMs)
      res = await fetchWithAuth(url)
    }
    if (res.status === 401) {
      throw new WaniKaniAuthError('invalid WaniKani token')
    }
    if (!res.ok) {
      throw new Error(`WaniKani request failed: HTTP ${res.status}`)
    }
    return (await res.json()) as WaniKaniPage
  }

  async function* collection(
    path: string,
    params?: Record<string, string>
  ): AsyncIterable<unknown[]> {
    let url: string | null = buildUrl(path, params)
    while (url !== null) {
      const page = await fetchPage(url)
      yield page.data
      url = page.pages.next_url === null ? null : apiPageUrl(page.pages.next_url)
    }
  }

  return { collection }
}

function apiPageUrl(nextUrl: string): string {
  const url = new URL(nextUrl, WANIKANI_BASE)
  if (url.origin !== new URL(WANIKANI_BASE).origin) {
    throw new Error('WaniKani pagination URL must use the WaniKani API origin')
  }
  return url.href
}

async function defaultSleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms))
}
