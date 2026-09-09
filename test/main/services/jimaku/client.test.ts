import { describe, expect, it, vi } from 'vitest'
import type { HttpFetch, HttpResponse } from '@src/main/services/http'
import {
  createJimakuClient,
  JIMAKU_API_BASE,
  JIMAKU_MAX_RESPONSE_BYTES,
  type CreateJimakuClientDeps
} from '@src/main/services/jimaku/client'
import { fakeHttp, type FakeHttpRoute } from '@test/harness/fakeHttp'

const flags = {
  anime: true,
  movie: false,
  external: false,
  unverified: false,
  adult: false
}

function searchUrl(query: string, anime: boolean): string {
  const params = new URLSearchParams({ query, anime: String(anime) })
  return `${JIMAKU_API_BASE}/entries/search?${params.toString()}`
}

function makeClient(
  routes: Record<string, FakeHttpRoute | FakeHttpRoute[]>,
  overrides: Partial<Omit<CreateJimakuClientDeps, 'fetch' | 'getApiKey'>> & {
    apiKey?: string | null
  } = {}
) {
  const http = fakeHttp(routes)
  const client = createJimakuClient({
    getApiKey: () => overrides.apiKey ?? 'test-key',
    fetch: http.fetch,
    ...overrides
  })
  return { client, http }
}

describe('createJimakuClient', () => {
  it('encodes the query, sends anime explicitly, and uses a raw API key', async () => {
    const query = '葬送のフリーレン!? &'
    const url = searchUrl(query, false)
    const { client, http } = makeClient({ [url]: { json: [] } })

    await expect(client.searchEntries({ query, anime: false })).resolves.toEqual({
      ok: true,
      value: []
    })
    expect(http.calls[0]).toMatchObject({
      url,
      init: {
        method: 'GET',
        headers: { Authorization: 'test-key' }
      }
    })
  })

  it.each(['', '   ', 'x'.repeat(201)])('rejects an unusable search query: %j', async (query) => {
    const { client, http } = makeClient({})

    await expect(client.searchEntries({ query, anime: true })).resolves.toEqual({
      ok: false,
      error: { code: 'invalidRequest' }
    })
    expect(http.calls).toHaveLength(0)
  })

  it('rejects invalid IDs and does not add episode filtering to file requests', async () => {
    const { client, http } = makeClient({
      [`${JIMAKU_API_BASE}/entries/42/files`]: { json: [] }
    })

    await expect(client.getEntry(0)).resolves.toEqual({
      ok: false,
      error: { code: 'invalidRequest' }
    })
    await expect(client.getEntry(Number.MAX_SAFE_INTEGER + 1)).resolves.toEqual({
      ok: false,
      error: { code: 'invalidRequest' }
    })
    await expect(client.listFiles(42)).resolves.toEqual({ ok: true, value: [] })
    expect(http.calls[0]?.url).toBe(`${JIMAKU_API_BASE}/entries/42/files`)
  })

  it('returns notConfigured without making an HTTP request when the key is missing', async () => {
    const { client, http } = makeClient({}, { apiKey: '  ' })

    await expect(client.searchEntries({ query: 'Frieren', anime: true })).resolves.toEqual({
      ok: false,
      error: { code: 'notConfigured' }
    })
    expect(http.calls).toHaveLength(0)
  })

  it('normalizes entries, drops null optionals, and ignores notes and unknown fields', async () => {
    const url = `${JIMAKU_API_BASE}/entries/42`
    const { client } = makeClient({
      [url]: {
        json: {
          id: 42,
          name: 'Sousou no Frieren',
          flags,
          english_name: null,
          japanese_name: '葬送のフリーレン',
          anilist_id: null,
          tmdb_id: null,
          notes: '<script>ignore me</script>',
          extra: 'ignore me'
        }
      }
    })

    await expect(client.getEntry(42)).resolves.toEqual({
      ok: true,
      value: {
        id: 42,
        name: 'Sousou no Frieren',
        flags,
        japaneseName: '葬送のフリーレン'
      }
    })
  })

  it('normalizes real-shaped file records while retaining the URL only in main', async () => {
    const url = `${JIMAKU_API_BASE}/entries/42/files`
    const { client } = makeClient({
      [url]: {
        json: [
          {
            name: '[Group] Frieren - 01.ass',
            url: 'https://jimaku.cc/entry/42/download/%5BGroup%5D%20Frieren%20-%2001.ass',
            size: 1234,
            last_modified: '2026-09-08T12:00:00Z',
            extra: 'ignore me'
          }
        ]
      }
    })

    await expect(client.listFiles(42)).resolves.toEqual({
      ok: true,
      value: [
        {
          name: '[Group] Frieren - 01.ass',
          url: 'https://jimaku.cc/entry/42/download/%5BGroup%5D%20Frieren%20-%2001.ass',
          size: 1234,
          lastModified: '2026-09-08T12:00:00Z'
        }
      ]
    })
  })

  it('rejects malformed JSON and malformed required records', async () => {
    const search = searchUrl('Frieren', true)
    const { client } = makeClient({
      [search]: { json: [{ id: 42, name: 'bad', flags: { anime: 'yes' } }] },
      [`${JIMAKU_API_BASE}/entries/42`]: { text: '{not-json' },
      [`${JIMAKU_API_BASE}/entries/42/files`]: {
        json: [{ name: 'bad.srt', url: 'https://jimaku.cc/file', size: -1, last_modified: 'now' }]
      }
    })

    await expect(client.searchEntries({ query: 'Frieren', anime: true })).resolves.toEqual({
      ok: false,
      error: { code: 'invalidResponse' }
    })
    await expect(client.getEntry(42)).resolves.toEqual({
      ok: false,
      error: { code: 'invalidResponse' }
    })
    await expect(client.listFiles(42)).resolves.toEqual({
      ok: false,
      error: { code: 'invalidResponse' }
    })
  })

  it.each([
    [401, 'unauthorized'],
    [403, 'unauthorized'],
    [404, 'notFound'],
    [400, 'invalidResponse'],
    [500, 'serviceUnavailable'],
    [503, 'serviceUnavailable']
  ] as const)('maps HTTP %d to %s', async (status, code) => {
    const url = searchUrl('Frieren', true)
    const { client } = makeClient({ [url]: { status } })

    await expect(client.searchEntries({ query: 'Frieren', anime: true })).resolves.toEqual({
      ok: false,
      error: { code }
    })
  })

  it('shares a fractional 429 cooldown and retries only after the injected clock passes it', async () => {
    let currentTime = 10_000
    const url = searchUrl('Frieren', true)
    const { client, http } = makeClient(
      {
        [url]: [{ status: 429, headers: { 'x-ratelimit-reset-after': '0.98' } }, { json: [] }]
      },
      { now: () => currentTime }
    )

    await expect(client.searchEntries({ query: 'Frieren', anime: true })).resolves.toEqual({
      ok: false,
      error: { code: 'rateLimited', retryAt: '1970-01-01T00:00:10.980Z' }
    })

    currentTime = 10_500
    await expect(client.getEntry(42)).resolves.toEqual({
      ok: false,
      error: { code: 'rateLimited', retryAt: '1970-01-01T00:00:10.980Z' }
    })
    expect(http.calls).toHaveLength(1)

    currentTime = 10_980
    await expect(client.searchEntries({ query: 'Frieren', anime: true })).resolves.toEqual({
      ok: true,
      value: []
    })
    expect(http.calls).toHaveLength(2)
  })

  it.each([
    [{ 'x-ratelimit-reset': '20' }, '1970-01-01T00:00:20.000Z'],
    [{}, '1970-01-01T00:01:10.000Z']
  ] as const)('uses the reset timestamp or 60-second fallback: %j', async (headers, retryAt) => {
    const url = searchUrl('Frieren', true)
    const { client } = makeClient({ [url]: { status: 429, headers } }, { now: () => 10_000 })

    await expect(client.searchEntries({ query: 'Frieren', anime: true })).resolves.toEqual({
      ok: false,
      error: { code: 'rateLimited', retryAt }
    })
  })

  it('distinguishes caller cancellation from timeout', async () => {
    const url = searchUrl('Frieren', true)
    const { client, http } = makeClient({ [url]: { deferred: true } })
    const controller = new AbortController()
    const cancelled = client.searchEntries({ query: 'Frieren', anime: true }, controller.signal)

    await vi.waitFor(() => expect(http.calls).toHaveLength(1))
    controller.abort()
    await expect(cancelled).resolves.toEqual({ ok: false, error: { code: 'cancelled' } })

    const timers: Array<() => void> = []
    const timeoutClient = makeClient(
      { [url]: { deferred: true } },
      {
        requestTimeoutMs: 25,
        setTimeoutFn: (callback) => {
          timers.push(callback)
          return 0 as unknown as ReturnType<typeof setTimeout>
        },
        clearTimeoutFn: vi.fn()
      }
    ).client
    const timedOut = timeoutClient.searchEntries({ query: 'Frieren', anime: true })
    await vi.waitFor(() => expect(timers).toHaveLength(1))
    timers[0]!()
    await expect(timedOut).resolves.toEqual({ ok: false, error: { code: 'timeout' } })
  })

  it('rejects an oversized body even when Content-Length is absent', async () => {
    const url = searchUrl('Frieren', true)
    const { client } = makeClient({
      [url]: { text: 'x'.repeat(JIMAKU_MAX_RESPONSE_BYTES + 1) }
    })

    await expect(client.searchEntries({ query: 'Frieren', anime: true })).resolves.toEqual({
      ok: false,
      error: { code: 'invalidResponse' }
    })
  })

  it('reads the current key once at the start of each request and never serializes it in errors', async () => {
    let apiKey = 'key-a'
    const seen: string[] = []
    const response: HttpResponse = {
      status: 200,
      ok: true,
      headers: { get: () => null },
      json: async () => [],
      text: async () => '[]'
    }
    const fetch: HttpFetch = async (_url, init) => {
      seen.push(init?.headers?.Authorization ?? '')
      return response
    }
    const deps: CreateJimakuClientDeps = { getApiKey: () => apiKey, fetch }
    const client = createJimakuClient(deps)

    await client.searchEntries({ query: 'Frieren', anime: true })
    apiKey = 'key-b'
    await client.searchEntries({ query: 'Frieren', anime: true })
    expect(seen).toEqual(['key-a', 'key-b'])

    const failing = createJimakuClient({
      getApiKey: () => 'secret-token',
      fetch: async () => {
        throw new Error('secret-token leaked by transport')
      }
    })
    const result = await failing.searchEntries({ query: 'Frieren', anime: true })
    expect(result).toEqual({ ok: false, error: { code: 'network' } })
    expect(JSON.stringify(result)).not.toContain('secret-token')
  })
})
