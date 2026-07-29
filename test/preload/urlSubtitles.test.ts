import { beforeEach, describe, expect, it, vi } from 'vitest'
import { URL_SUBTITLE_CHANNELS } from '@src/shared/ipcChannels'

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

import '@src/preload/index'

interface UrlSubtitleApi {
  urlSubtitles: {
    enumerate(url: string): Promise<unknown>
    acquire(descriptor: { url: string; selectionId: string }): Promise<unknown>
    cancel(): void
  }
}

function api(): UrlSubtitleApi {
  return electron.exposeInMainWorld.mock.calls[0]?.[1] as UrlSubtitleApi
}

describe('preload urlSubtitles surface', () => {
  beforeEach(() => {
    electron.invoke.mockReset()
    electron.send.mockReset()
  })

  it('enumerate invokes the enumerate channel with the url', () => {
    api().urlSubtitles.enumerate('https://youtu.be/x')
    expect(electron.invoke).toHaveBeenCalledWith(
      URL_SUBTITLE_CHANNELS.enumerate,
      'https://youtu.be/x'
    )
  })

  it('acquire invokes the acquire channel with the descriptor', () => {
    const descriptor = { url: 'https://youtu.be/x', selectionId: 'provided:en' }
    api().urlSubtitles.acquire(descriptor)
    expect(electron.invoke).toHaveBeenCalledWith(URL_SUBTITLE_CHANNELS.acquire, descriptor)
  })

  it('cancel sends the cancel channel with no payload', () => {
    api().urlSubtitles.cancel()
    expect(electron.send).toHaveBeenCalledWith(URL_SUBTITLE_CHANNELS.cancel)
  })
})
