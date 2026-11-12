import { describe, expect, it, vi } from 'vitest'
import { fakeGameOcrApi } from '@test/harness/fakeKizunaApi'

const electron = vi.hoisted(() => ({ exposeInMainWorld: vi.fn() }))

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: electron.exposeInMainWorld },
  ipcRenderer: {}
}))

import '@src/preload/gameOcr'

// Captured once: the preload exposes its API at import time, and Vitest clears
// mock call history before each test.
const exposed = electron.exposeInMainWorld.mock.calls[0]
const api = exposed?.[1] as Record<string, Record<string, (...args: unknown[]) => unknown>>

function shape(value: object): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(value).map(([domain, methods]) => [domain, Object.keys(methods).sort()])
  )
}

describe('Game OCR preload', () => {
  it('exposes only the frozen-frame subset under window.kizuna', () => {
    expect(exposed?.[0]).toBe('kizuna')
    expect(shape(api)).toEqual(shape(fakeGameOcrApi()))
    expect(api).not.toHaveProperty('player')
    expect(api).not.toHaveProperty('media')
    expect(api).not.toHaveProperty('jimaku')
    expect(api.playerSettings).not.toHaveProperty('setSettings')
    expect(api.dict).not.toHaveProperty('importDict')
    expect(api.translate).not.toHaveProperty('setSettings')
  })
})
