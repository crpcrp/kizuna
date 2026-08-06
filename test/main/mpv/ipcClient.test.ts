import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { tmpdir } from 'node:os'
import { MpvIpcClient } from '@src/main/mpv/ipcClient'
import { createMpvIpcEndpoint } from '@src/main/mpv/ipcEndpoint'
import { FakeMpvServer } from '@test/harness/fakeMpvServer'

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/** Polls until `cond` is true (fake server I/O is async but fast). */
async function until(cond: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now()
  while (!cond()) {
    if (Date.now() - start > timeoutMs) throw new Error('until(): timed out')
    await delay(5)
  }
}

describe('MpvIpcClient (against fake mpv harness)', () => {
  let server: FakeMpvServer
  let client: MpvIpcClient

  beforeEach(async () => {
    server = new FakeMpvServer()
    await server.listen()
    client = new MpvIpcClient()
  })

  afterEach(async () => {
    client?.dispose()
    await server?.close()
  })

  it('connects and round-trips a command with request_id correlation', async () => {
    server.onCommand((msg) => {
      if (msg.command[0] === 'get_property' && msg.command[1] === 'time-pos') {
        return { error: 'success', data: 42.5 }
      }
      return { error: 'success' }
    })
    await client.connect(server.endpoint)
    await expect(client.sendCommand(['get_property', 'time-pos'])).resolves.toBe(42.5)
    expect(server.received).toEqual([
      { command: ['get_property', 'time-pos'], request_id: expect.any(Number) }
    ])
  })

  it('rejects when mpv replies with a non-success error', async () => {
    server.onCommand(() => ({ error: 'property unavailable' }))
    await client.connect(server.endpoint)
    await expect(client.sendCommand(['get_property', 'chapter'])).rejects.toThrow(
      'property unavailable'
    )
  })

  it('correlates out-of-order / interleaved responses by request_id', async () => {
    server.onCommand(() => undefined) // stay silent; test replies manually
    await client.connect(server.endpoint)

    const first = client.sendCommand(['get_property', 'duration'])
    const second = client.sendCommand(['get_property', 'volume'])
    await until(() => server.received.length === 2)

    // Reply to the second command first, then the first.
    server.reply(server.received[1].request_id, { error: 'success', data: 'vol' })
    server.reply(server.received[0].request_id, { error: 'success', data: 'dur' })

    await expect(second).resolves.toBe('vol')
    await expect(first).resolves.toBe('dur')
  })

  it('reassembles responses split across partial chunks', async () => {
    server.onCommand(() => undefined)
    await client.connect(server.endpoint)

    const pending = client.sendCommand(['get_property', 'path'])
    await until(() => server.received.length === 1)

    const line = JSON.stringify({
      request_id: server.received[0].request_id,
      error: 'success',
      data: 'video.mkv'
    })
    server.sendRaw(line.slice(0, 10)) // partial JSON, no newline
    await delay(20)
    server.sendRaw(line.slice(10) + '\n' + '{"event":"file-loaded"}\n') // rest + extra line

    await expect(pending).resolves.toBe('video.mkv')
  })

  it('dispatches mpv events to on(event) listeners', async () => {
    await client.connect(server.endpoint)
    await server.waitForConnection()
    const seen: unknown[] = []
    client.on('end-file', (msg) => seen.push(msg))

    server.pushEvent({ event: 'end-file', reason: 'eof' })
    await until(() => seen.length === 1)
    expect(seen[0]).toEqual({ event: 'end-file', reason: 'eof' })
  })

  it('routes property-change events to the right observer by observe id', async () => {
    await client.connect(server.endpoint)
    const timePos: unknown[] = []
    const paused: unknown[] = []
    const timeId = await client.observeProperty('time-pos', (v) => timePos.push(v))
    const pauseId = await client.observeProperty('pause', (v) => paused.push(v))
    expect(timeId).not.toBe(pauseId)
    expect(server.received.map((m) => m.command)).toEqual([
      ['observe_property', timeId, 'time-pos'],
      ['observe_property', pauseId, 'pause']
    ])

    server.pushEvent({ event: 'property-change', id: timeId, name: 'time-pos', data: 1.5 })
    server.pushEvent({ event: 'property-change', id: pauseId, name: 'pause', data: true })
    await until(() => timePos.length === 1 && paused.length === 1)
    expect(timePos).toEqual([1.5])
    expect(paused).toEqual([true])
  })

  it('retries connect until the endpoint exists (mpv creates it after spawn)', async () => {
    const late = new FakeMpvServer()
    const lateClient = new MpvIpcClient()
    try {
      const connecting = lateClient.connect(late.endpoint, { retries: 20, retryDelayMs: 25 })
      await delay(60) // endpoint does not exist yet — first attempts must fail
      await late.listen()
      await expect(connecting).resolves.toBeUndefined()
      await expect(lateClient.sendCommand(['get_version'])).resolves.toBeUndefined()
    } finally {
      lateClient.dispose()
      await late.close()
    }
  })

  it('rejects sendCommand when not connected', async () => {
    await expect(client.sendCommand(['get_property', 'pause'])).rejects.toThrow('not connected')
  })

  it('dispose rejects in-flight commands and tears down', async () => {
    server.onCommand(() => undefined)
    await client.connect(server.endpoint)
    const pending = client.sendCommand(['get_property', 'duration'])
    client.dispose()
    await expect(pending).rejects.toThrow(/disposed|closed/)
  })
})

describe('MpvIpcClient missing endpoints', () => {
  it.each([
    ['Windows named pipe', createMpvIpcEndpoint('win32')],
    ['Linux Unix socket', createMpvIpcEndpoint('linux', tmpdir())]
  ])('builds a valid nonexistent %s endpoint', (_label, endpoint) => {
    expect(endpoint).toMatch(/kizuna-mpv-/)
  })

  it('gives up after the retry budget with a useful error for the current platform', async () => {
    const lonely = new MpvIpcClient()
    const endpoint = createMpvIpcEndpoint(process.platform, tmpdir())
    await expect(lonely.connect(endpoint, { retries: 2, retryDelayMs: 10 })).rejects.toThrow(
      /could not connect/
    )
  })
})
