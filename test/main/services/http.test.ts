import { describe, it, expect, vi, afterEach } from 'vitest'
import { httpFetch, type HttpRequest } from '@src/main/services/http'

const realFetch = globalThis.fetch

/** Records the init `httpFetch` hands to global fetch; answers with a real minimal Response. */
function mockFetch(response: () => Response = () => new Response('ok', { status: 200 })) {
  const spy = vi.fn(async (_url: string, _init?: HttpRequest) => response())
  globalThis.fetch = spy as unknown as typeof fetch
  return spy
}

afterEach(() => {
  globalThis.fetch = realFetch
  vi.restoreAllMocks()
})

describe('httpFetch', () => {
  it('forwards the caller signal to global fetch unchanged', async () => {
    const spy = mockFetch()
    const controller = new AbortController()

    await httpFetch('https://example.test/x', { signal: controller.signal })

    expect(spy.mock.calls[0]![1]?.signal).toBe(controller.signal)
  })

  it('forwards method, headers and body alongside the signal', async () => {
    const spy = mockFetch()
    const controller = new AbortController()

    await httpFetch('https://example.test/x', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"a":1}',
      signal: controller.signal
    })

    expect(spy.mock.calls[0]![0]).toBe('https://example.test/x')
    expect(spy.mock.calls[0]![1]).toEqual({
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"a":1}',
      signal: controller.signal
    })
  })

  it('passes no signal when the caller supplies none', async () => {
    const spy = mockFetch()

    await httpFetch('https://example.test/x')

    expect(spy.mock.calls[0]![1]).toBeUndefined()
  })

  it('maps status, ok, headers and bodies from the real Response', async () => {
    mockFetch(
      () =>
        new Response('{"hello":"world"}', {
          status: 201,
          headers: { 'Content-Type': 'application/json' }
        })
    )

    const res = await httpFetch('https://example.test/x')

    expect(res.status).toBe(201)
    expect(res.ok).toBe(true)
    expect(res.headers.get('content-type')).toBe('application/json')
    expect(res.headers.get('x-missing')).toBeNull()
    await expect(res.json()).resolves.toEqual({ hello: 'world' })
  })

  it('reports a non-ok response instead of throwing', async () => {
    mockFetch(() => new Response('nope', { status: 503 }))

    const res = await httpFetch('https://example.test/x')

    expect(res.ok).toBe(false)
    expect(res.status).toBe(503)
    await expect(res.text()).resolves.toBe('nope')
  })

  it('rejects when global fetch rejects (aborted request)', async () => {
    const spy = vi.fn(async () => {
      throw new DOMException('The operation was aborted.', 'AbortError')
    })
    globalThis.fetch = spy as unknown as typeof fetch
    const controller = new AbortController()
    controller.abort()

    await expect(
      httpFetch('https://example.test/x', { signal: controller.signal })
    ).rejects.toThrow(/aborted/i)
  })
})
