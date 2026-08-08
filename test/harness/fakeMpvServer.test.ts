import { afterEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { MpvIpcClient } from '@src/main/mpv/ipcClient'
import { FakeMpvServer } from '@test/harness/fakeMpvServer'

const tempRoots: string[] = []

afterEach(() => {
  for (const root of tempRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function makeTempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'kizuna-fake-mpv-test-'))
  tempRoots.push(root)
  return root
}

describe('FakeMpvServer endpoint selection', () => {
  it('uses a complete Windows named-pipe endpoint without creating Unix resources', async () => {
    let makeTempDirCalls = 0
    const server = new FakeMpvServer({
      platform: 'win32',
      mkdtempFn: () => {
        makeTempDirCalls += 1
        throw new Error('Windows fake servers must not create temp directories')
      }
    })

    expect(server.endpoint).toMatch(/^\\\\\.\\pipe\\kizuna-mpv-/)
    await server.close()
    expect(makeTempDirCalls).toBe(0)
  })

  it('uses a unique Linux socket inside a server-owned directory', async () => {
    const tempRoot = makeTempRoot()
    const server = new FakeMpvServer({ platform: 'linux', tempRoot })
    const serverTempDir = dirname(server.endpoint)

    expect(server.endpoint).toMatch(/\.sock$/)
    expect(server.endpoint.startsWith(join(tempRoot, 'kizuna-fake-mpv-'))).toBe(true)
    expect(serverTempDir).not.toBe(tempRoot)
    expect(existsSync(serverTempDir)).toBe(true)

    await server.close()

    expect(existsSync(server.endpoint)).toBe(false)
    expect(existsSync(serverTempDir)).toBe(false)
    expect(existsSync(tempRoot)).toBe(true)
  })

  it('generates distinct endpoints for distinct server instances', async () => {
    const tempRoot = makeTempRoot()
    const first = new FakeMpvServer({ platform: 'linux', tempRoot })
    const second = new FakeMpvServer({ platform: 'linux', tempRoot })

    expect(second.endpoint).not.toBe(first.endpoint)

    await Promise.all([first.close(), second.close()])
  })

  it('rejects unsupported platforms clearly', () => {
    expect(() => new FakeMpvServer({ platform: 'darwin' })).toThrow(
      'Unsupported platform for fake mpv server: darwin'
    )
  })
})

describe('FakeMpvServer lifecycle', () => {
  it.skipIf(process.platform !== 'linux')(
    'removes a stale Linux socket before listening',
    async () => {
      const server = new FakeMpvServer({ platform: 'linux', tempRoot: makeTempRoot() })
      writeFileSync(server.endpoint, 'stale socket placeholder')

      try {
        await server.listen()
        expect(existsSync(server.endpoint)).toBe(true)
      } finally {
        await server.close()
      }
    }
  )

  it('cleans its resources after a listen failure', async () => {
    const tempRoot = makeTempRoot()
    const server = new FakeMpvServer({ platform: 'linux', tempRoot })
    const serverTempDir = dirname(server.endpoint)
    mkdirSync(server.endpoint)

    await expect(server.listen()).rejects.toThrow()
    expect(existsSync(serverTempDir)).toBe(false)
    expect(existsSync(tempRoot)).toBe(true)

    await server.close()
  })

  it('makes repeated close calls safe', async () => {
    const server = new FakeMpvServer()
    await server.listen()

    await server.close()
    await expect(server.close()).resolves.toBeUndefined()
  })

  it('does not invoke Unix cleanup seams for Windows endpoints', async () => {
    const calls: string[] = []
    const server = new FakeMpvServer({
      platform: 'win32',
      unlinkFn: (path) => calls.push(`unlink:${path}`),
      removeDirFn: (path) => calls.push(`remove-dir:${path}`)
    })

    await server.close()

    expect(calls).toEqual([])
  })

  it('ignores missing endpoint and temp-directory errors during cleanup', async () => {
    const missing = Object.assign(new Error('already gone'), { code: 'ENOENT' })
    const server = new FakeMpvServer({
      platform: 'linux',
      tempRoot: makeTempRoot(),
      unlinkFn: () => {
        throw missing
      },
      removeDirFn: () => {
        throw missing
      }
    })

    await expect(server.close()).resolves.toBeUndefined()
  })

  it('listens and exchanges a representative JSON IPC message on the current platform', async () => {
    const server = new FakeMpvServer()
    const client = new MpvIpcClient()
    server.onCommand((msg) => ({ error: 'success', data: msg.command[0] }))

    try {
      await server.listen()
      await client.connect(server.endpoint)
      await expect(client.sendCommand(['get_version'])).resolves.toBe('get_version')
    } finally {
      client.dispose()
      await server.close()
    }
  })
})
