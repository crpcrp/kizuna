import { describe, expect, it, vi } from 'vitest'
import {
  ANKI_CHANNELS,
  DICT_CHANNELS,
  GAME_OCR_CHANNELS,
  PLAYER_SETTINGS_CHANNELS,
  TRANSLATE_CHANNELS
} from '@src/shared/ipcChannels'
import { fakeGameOcrApi } from '@test/harness/fakeKizunaApi'

const electron = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(),
  send: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn()
}))

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: electron.exposeInMainWorld },
  ipcRenderer: {
    invoke: electron.invoke,
    send: electron.send,
    on: electron.on,
    removeListener: electron.removeListener
  }
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

  it('routes calls through the same channels as the player preload', () => {
    api.dict.lookup('食べる', 'たべる', null, undefined, ['食べ'], '食べ')
    api.anki.addNote({ word: '食べる' })
    api.playerSettings.getSettings()
    api.translate.translate('こんにちは', 'r1')
    api.translate.cancel('r1')
    api.gameOcr.rendererReady()

    expect(electron.invoke).toHaveBeenCalledWith(
      DICT_CHANNELS.lookup,
      '食べる',
      'たべる',
      null,
      undefined,
      ['食べ'],
      '食べ'
    )
    expect(electron.invoke).toHaveBeenCalledWith(ANKI_CHANNELS.addNote, { word: '食べる' })
    expect(electron.invoke).toHaveBeenCalledWith(PLAYER_SETTINGS_CHANNELS.getSettings)
    expect(electron.invoke).toHaveBeenCalledWith(TRANSLATE_CHANNELS.translate, {
      text: 'こんにちは',
      requestId: 'r1'
    })
    expect(electron.send).toHaveBeenCalledWith(TRANSLATE_CHANNELS.cancel, { requestId: 'r1' })
    expect(electron.send).toHaveBeenCalledWith(GAME_OCR_CHANNELS.rendererReady)
  })

  it('unsubscribes frozen-frame pushes on teardown', () => {
    const cb = vi.fn()
    const off = api.gameOcr.onRegions(cb) as () => void
    const listener = electron.on.mock.calls[0][1]
    listener({}, { regions: [] })
    off()

    expect(electron.on).toHaveBeenCalledWith(GAME_OCR_CHANNELS.regions, listener)
    expect(cb).toHaveBeenCalledWith({ regions: [] })
    expect(electron.removeListener).toHaveBeenCalledWith(GAME_OCR_CHANNELS.regions, listener)
  })
})
