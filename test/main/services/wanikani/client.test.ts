import { describe, it, expect, vi } from 'vitest'
import {
  createWaniKaniClient,
  WaniKaniAuthError,
  WANIKANI_BASE,
  WANIKANI_REVISION
} from '@src/main/services/wanikani/client'
import { fakeHttp } from '@test/harness/fakeHttp'

async function collect(iterable: AsyncIterable<unknown[]>): Promise<unknown[]> {
  const items: unknown[] = []
  for await (const page of iterable) items.push(...page)
  return items
}

describe('createWaniKaniClient', () => {
  it('follows pages.next_url across a two-page collection', async () => {
    const page2Url = `${WANIKANI_BASE}assignments?page_after_id=100`
    const http = fakeHttp({
      [`${WANIKANI_BASE}assignments`]: {
        json: { pages: { next_url: page2Url, per_page: 500 }, total_count: 2, data: ['a'] }
      },
      [page2Url]: {
        json: { pages: { next_url: null, per_page: 500 }, total_count: 2, data: ['b'] }
      }
    })
    const client = createWaniKaniClient({ token: 'tok', fetch: http.fetch })

    const items = await collect(client.collection('assignments'))

    expect(items).toEqual(['a', 'b'])
    expect(http.calls).toHaveLength(2)
  })

  it('rejects a cross-origin next_url before sending its authenticated request', async () => {
    const http = fakeHttp({
      [`${WANIKANI_BASE}assignments`]: {
        json: {
          pages: {
            next_url: 'https://attacker.example/assignments?page_after_id=100',
            per_page: 500
          },
          total_count: 2,
          data: ['a']
        }
      }
    })
    const client = createWaniKaniClient({ token: 'tok', fetch: http.fetch })

    await expect(collect(client.collection('assignments'))).rejects.toThrow(
      'pagination URL must use the WaniKani API origin'
    )
    expect(http.calls).toHaveLength(1)
  })

  it('aborts a stalled request at the configured timeout', async () => {
    const url = `${WANIKANI_BASE}assignments`
    const http = fakeHttp({ [url]: { deferred: true } })
    const timers: Array<() => void> = []
    const client = createWaniKaniClient({
      token: 'tok',
      fetch: http.fetch,
      requestTimeoutMs: 25,
      setTimeoutFn: (callback) => {
        timers.push(callback)
        return 0 as unknown as ReturnType<typeof setTimeout>
      },
      clearTimeoutFn: vi.fn()
    })
    const request = collect(client.collection('assignments'))

    await vi.waitFor(() => expect(http.calls).toHaveLength(1))
    timers[0]!()

    await expect(request).rejects.toThrow('WaniKani request timed out after 25ms')
    expect(http.calls[0]?.init?.signal?.aborted).toBe(true)
  })

  it('sends Authorization and Wanikani-Revision headers on every request', async () => {
    const http = fakeHttp({
      [`${WANIKANI_BASE}assignments`]: {
        json: { pages: { next_url: null, per_page: 500 }, total_count: 0, data: [] }
      }
    })
    const client = createWaniKaniClient({ token: 'secret-token', fetch: http.fetch })

    await collect(client.collection('assignments'))

    expect(http.calls[0].init?.headers).toEqual({
      Authorization: 'Bearer secret-token',
      'Wanikani-Revision': WANIKANI_REVISION
    })
  })

  it('retries once after a 429, sleeping until the RateLimit-Reset epoch', async () => {
    const url = `${WANIKANI_BASE}assignments`
    const http = fakeHttp({
      [url]: [
        { status: 429, headers: { 'RateLimit-Reset': '60' } },
        { json: { pages: { next_url: null, per_page: 500 }, total_count: 1, data: ['a'] } }
      ]
    })
    const sleeps: number[] = []
    const client = createWaniKaniClient({
      token: 'tok',
      fetch: http.fetch,
      sleep: async (ms) => {
        sleeps.push(ms)
      },
      now: () => 10_000
    })

    const items = await collect(client.collection('assignments'))

    expect(items).toEqual(['a'])
    expect(sleeps).toEqual([50_000])
    expect(http.calls).toHaveLength(2)
  })

  it('throws WaniKaniAuthError on a 401', async () => {
    const http = fakeHttp({ [`${WANIKANI_BASE}assignments`]: { status: 401 } })
    const client = createWaniKaniClient({ token: 'bad-token', fetch: http.fetch })

    await expect(collect(client.collection('assignments'))).rejects.toBeInstanceOf(
      WaniKaniAuthError
    )
  })

  it('rejects a 500 with an HTTP error naming the status', async () => {
    const http = fakeHttp({ [`${WANIKANI_BASE}assignments`]: { status: 500 } })
    const client = createWaniKaniClient({ token: 'tok', fetch: http.fetch })

    await expect(collect(client.collection('assignments'))).rejects.toThrow(/500/)
  })

  it('rejects when the single 429 retry is also a 429, without retrying again', async () => {
    const url = `${WANIKANI_BASE}assignments`
    const http = fakeHttp({
      [url]: [
        { status: 429, headers: { 'RateLimit-Reset': '60' } },
        { status: 429, headers: { 'RateLimit-Reset': '60' } }
      ]
    })
    const sleeps: number[] = []
    const client = createWaniKaniClient({
      token: 'tok',
      fetch: http.fetch,
      sleep: async (ms) => {
        sleeps.push(ms)
      },
      now: () => 10_000
    })

    await expect(collect(client.collection('assignments'))).rejects.toThrow(/429/)
    expect(sleeps).toHaveLength(1)
    expect(http.calls).toHaveLength(2)
  })

  it('encodes query params onto the initial request URL', async () => {
    const http = fakeHttp({
      [`${WANIKANI_BASE}assignments?started=true&subject_types=vocabulary`]: {
        json: { pages: { next_url: null, per_page: 500 }, total_count: 0, data: [] }
      }
    })
    const client = createWaniKaniClient({ token: 'tok', fetch: http.fetch })

    await collect(
      client.collection('assignments', { started: 'true', subject_types: 'vocabulary' })
    )

    expect(http.calls[0].url).toBe(
      `${WANIKANI_BASE}assignments?started=true&subject_types=vocabulary`
    )
  })
})
