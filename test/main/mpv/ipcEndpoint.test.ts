import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createMpvIpcEndpoint, removeMpvIpcEndpoint } from '@src/main/mpv/ipcEndpoint'

let tempDir: string

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), 'kizuna-mpv-endpoint-'))
})

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

describe('createMpvIpcEndpoint', () => {
  it('creates a Windows named pipe without a Unix socket suffix', () => {
    const endpoint = createMpvIpcEndpoint('win32')

    expect(endpoint).toMatch(/^\\\\\.\\pipe\\kizuna-mpv-/)
    expect(endpoint).not.toMatch(/\.sock$/)
  })

  it('creates a Linux socket under the injected temp directory', () => {
    const endpoint = createMpvIpcEndpoint('linux', tempDir)

    expect(endpoint.startsWith(join(tempDir, 'kizuna-mpv-'))).toBe(true)
    expect(endpoint.endsWith('.sock')).toBe(true)
  })

  it('generates unique endpoints consecutively', () => {
    const first = createMpvIpcEndpoint('linux', tempDir)
    const second = createMpvIpcEndpoint('linux', tempDir)

    expect(second).not.toBe(first)
  })

  it('rejects unsupported platforms', () => {
    expect(() => createMpvIpcEndpoint('darwin', tempDir)).toThrow(
      'Unsupported platform for mpv IPC endpoint'
    )
  })
})

describe('removeMpvIpcEndpoint', () => {
  it('ignores a missing Linux socket', () => {
    const missing = Object.assign(new Error('missing'), { code: 'ENOENT' })

    expect(() =>
      removeMpvIpcEndpoint('/test/kizuna-mpv.sock', 'linux', () => {
        throw missing
      })
    ).not.toThrow()
  })

  it('surfaces non-ENOENT Linux cleanup errors', () => {
    const permissionError = Object.assign(new Error('permission denied'), { code: 'EACCES' })

    expect(() =>
      removeMpvIpcEndpoint('/test/kizuna-mpv.sock', 'linux', () => {
        throw permissionError
      })
    ).toThrow(permissionError)
  })

  it('does not unlink Windows named pipes', () => {
    let calls = 0

    removeMpvIpcEndpoint('\\\\.\\pipe\\kizuna-mpv-test', 'win32', () => {
      calls += 1
    })

    expect(calls).toBe(0)
  })
})
