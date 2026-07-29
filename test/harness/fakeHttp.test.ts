import { describe, expect, it } from 'vitest'
import { fakeHttp } from './fakeHttp'

describe('fakeHttp', () => {
  it('rejects a deferred route with AbortError and records the exact signal', async () => {
    const http = fakeHttp({ 'https://example.test/slow': { deferred: true } })
    const controller = new AbortController()
    const request = http.fetch('https://example.test/slow', { signal: controller.signal })

    controller.abort()

    await expect(request).rejects.toMatchObject({ name: 'AbortError' })
    expect(http.calls).toEqual([
      { url: 'https://example.test/slow', init: { signal: controller.signal } }
    ])
  })

  it('rejects an already-aborted deferred request without resolving its route', async () => {
    const http = fakeHttp({ 'https://example.test/slow': { deferred: true } })
    const controller = new AbortController()
    controller.abort()

    await expect(
      http.fetch('https://example.test/slow', { signal: controller.signal })
    ).rejects.toMatchObject({
      name: 'AbortError'
    })
  })

  it('keeps immediate legacy routes unchanged', async () => {
    const http = fakeHttp({ 'https://example.test/ready': { status: 201, json: { ok: true } } })

    await expect(http.fetch('https://example.test/ready')).resolves.toMatchObject({
      status: 201,
      ok: true
    })
    await expect((await http.fetch('https://example.test/ready')).json()).resolves.toEqual({
      ok: true
    })
  })
})
