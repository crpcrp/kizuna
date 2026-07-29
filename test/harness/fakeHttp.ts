// Test harness — fake HTTP boundary (AGENTS.md law 3: no live network calls).
//
// Mirrors fakeFfmpeg.ts/fakeMecab.ts: matches on URL against a route table,
// records every request (method, headers, body), and returns canned
// status/headers/JSON. A route may be a single response (returned for every
// call) or an array of responses consumed in order — the last entry repeats
// once exhausted — so a route can be scripted to return e.g. 429 then 200.

import type { HttpFetch, HttpRequest, HttpResponse } from '../../src/main/services/http'

export interface FakeHttpRoute {
  status?: number
  headers?: Record<string, string>
  json?: unknown
  text?: string
  /** Keep this response pending until the caller aborts its request. */
  deferred?: boolean
}

export interface FakeHttpCall {
  url: string
  init?: HttpRequest
}

export interface FakeHttp {
  fetch: HttpFetch
  calls: FakeHttpCall[]
}

/**
 * `routes` maps an exact URL to either one `FakeHttpRoute` (returned for
 * every call to that URL) or a list of them (consumed in order; the last
 * entry repeats once the list is exhausted).
 */
export function fakeHttp(routes: Record<string, FakeHttpRoute | FakeHttpRoute[]>): FakeHttp {
  const calls: FakeHttpCall[] = []
  const cursors = new Map<string, number>()

  const fetch: HttpFetch = async (url, init) => {
    calls.push({ url, init })

    const route = routes[url]
    if (route === undefined) {
      throw new Error(`fakeHttp: no route registered for ${url}`)
    }

    const entry = Array.isArray(route) ? nextScripted(route, url, cursors) : route
    if (entry.deferred) {
      await waitForAbort(init?.signal)
    }
    return toResponse(entry)
  }

  return { fetch, calls }
}

function waitForAbort(signal: AbortSignal | undefined): Promise<never> {
  return new Promise((_, reject) => {
    const abort = () => reject(new DOMException('The operation was aborted.', 'AbortError'))
    if (signal?.aborted) {
      abort()
      return
    }
    signal?.addEventListener('abort', abort, { once: true })
  })
}

function nextScripted(
  scripted: FakeHttpRoute[],
  url: string,
  cursors: Map<string, number>
): FakeHttpRoute {
  const index = cursors.get(url) ?? 0
  cursors.set(url, Math.min(index + 1, scripted.length - 1))
  return scripted[Math.min(index, scripted.length - 1)]
}

function toResponse(route: FakeHttpRoute): HttpResponse {
  const status = route.status ?? 200
  const headers = route.headers ?? {}
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (name: string) => headers[name] ?? null },
    json: async () => route.json,
    text: async () => route.text ?? (route.json === undefined ? '' : JSON.stringify(route.json))
  }
}
