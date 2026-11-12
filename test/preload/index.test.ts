import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  MEDIA_CHANNELS,
  PLAYER_CHANNELS,
  TRANSLATE_CHANNELS,
  WINDOW_CONTROL_CHANNELS
} from '@src/shared/ipcChannels'
import type { KizunaApi } from '@src/shared/preloadApi'

const electron = vi.hoisted(() => ({
  exposeInMainWorld: vi.fn(),
  invoke: vi.fn(),
  send: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
  getPathForFile: vi.fn()
}))

vi.mock('electron', () => ({
  contextBridge: { exposeInMainWorld: electron.exposeInMainWorld },
  ipcRenderer: {
    invoke: electron.invoke,
    send: electron.send,
    on: electron.on,
    removeListener: electron.removeListener
  },
  webUtils: { getPathForFile: electron.getPathForFile }
}))

import { windowShapeApi } from '@src/preload/index'

// Captured once: the preload exposes its API at import time, and Vitest clears
// mock call history before each test.
const [exposedName, exposedApi] = electron.exposeInMainWorld.mock.calls[0] ?? []
const api = exposedApi as KizunaApi

describe('preload', () => {
  beforeEach(() => {
    electron.invoke.mockReset()
    electron.send.mockReset()
    electron.on.mockReset()
    electron.removeListener.mockReset()
  })

  it('exposes the API as window.kizuna', () => {
    expect(exposedName).toBe('kizuna')
  })

  it('unsubscribes the same listener it registered', () => {
    const cb = vi.fn()

    const off = api.player.onPause(cb)
    const listener = electron.on.mock.calls[0][1]
    listener({}, true)
    off()

    expect(electron.on).toHaveBeenCalledWith(PLAYER_CHANNELS.pause, listener)
    expect(cb).toHaveBeenCalledWith(true)
    expect(electron.removeListener).toHaveBeenCalledWith(PLAYER_CHANNELS.pause, listener)
  })

  it('wraps translation arguments into request objects', () => {
    void api.translate.translate('猫です。', 'translation-1')
    api.translate.cancel('translation-1')

    expect(electron.invoke).toHaveBeenCalledWith(TRANSLATE_CHANNELS.translate, {
      text: '猫です。',
      requestId: 'translation-1'
    })
    expect(electron.send).toHaveBeenCalledWith(TRANSLATE_CHANNELS.cancel, {
      requestId: 'translation-1'
    })
  })

  it('defaults an omitted external subtitle encoding to auto', () => {
    void api.media.loadExternalSubtitle('C:\\Media\\episode.srt')

    expect(electron.invoke).toHaveBeenCalledWith(
      MEDIA_CHANNELS.loadExternalSubtitle,
      'C:\\Media\\episode.srt',
      'auto'
    )
  })

  it('resolves a dropped File to its real path through webUtils', () => {
    const file = new File(['data'], 'episode.mkv')
    electron.getPathForFile.mockReturnValue('C:\\Media\\episode.mkv')

    expect(api.files.pathForFile(file)).toBe('C:\\Media\\episode.mkv')
    expect(electron.getPathForFile).toHaveBeenCalledWith(file)
  })
})

describe('windowShapeApi', () => {
  it('exposes setShape on Linux and omits it on Windows, on either host', () => {
    const send = vi.fn()

    const linux = windowShapeApi(send, 'linux')
    linux.setShape?.([{ x: 0, y: 0, width: 10, height: 10 }])

    expect(Object.keys(linux)).toEqual(['setShape'])
    expect(send).toHaveBeenCalledWith([{ x: 0, y: 0, width: 10, height: 10 }])
    // Windows runs a single embedded window: the renderer must see no method.
    expect(windowShapeApi(send, 'win32')).toEqual({})
  })

  it('wires the live API to the setShape channel for the host platform', () => {
    expect('setShape' in api.windowControls).toBe(process.platform === 'linux')
    api.windowControls.setShape?.([{ x: 1, y: 2, width: 3, height: 4 }])
    if (process.platform === 'linux') {
      expect(electron.send).toHaveBeenCalledWith(WINDOW_CONTROL_CHANNELS.setShape, [
        { x: 1, y: 2, width: 3, height: 4 }
      ])
    }
  })
})
