import { describe, it, expect, vi } from 'vitest'
import {
  registerUrlSubtitleBridge,
  type IpcMainOnLike,
  type UrlSubtitleServiceLike
} from '@src/main/urlSubtitleBridge'
import type { IpcMainHandleLike } from '@src/main/playerBridge'
import { URL_SUBTITLE_CHANNELS } from '@src/shared/ipcChannels'

const URL = 'https://www.youtube.com/watch?v=abc123'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HandleFn = (event: unknown, ...args: any[]) => unknown
type OnFn = (event: unknown, ...args: unknown[]) => void

/** Fake ipcMain: records enumerate/acquire handles and the cancel listener. */
function fakeIpc(): {
  ipc: IpcMainHandleLike<unknown> & IpcMainOnLike<unknown>
  handlers: Map<string, HandleFn>
  listeners: Map<string, OnFn>
  invoke(channel: string, ...args: unknown[]): unknown
  send(channel: string, ...args: unknown[]): void
} {
  const handlers = new Map<string, HandleFn>()
  const listeners = new Map<string, OnFn>()
  const ipc: IpcMainHandleLike<unknown> & IpcMainOnLike<unknown> = {
    handle: (channel, listener) => handlers.set(channel, listener),
    on: (channel, listener) => listeners.set(channel, listener)
  }
  return {
    ipc,
    handlers,
    listeners,
    invoke: (channel, ...args) => handlers.get(channel)!({}, ...args),
    send: (channel, ...args) => listeners.get(channel)?.({}, ...args)
  }
}

function fakeService(): UrlSubtitleServiceLike {
  return {
    enumerate: vi.fn(async (url: string) => ({ url, available: false, tracks: [] })),
    acquire: vi.fn(async () => ({ selectionId: 'provided:en', format: 'srt' as const, cues: [] })),
    cancel: vi.fn()
  }
}

describe('registerUrlSubtitleBridge', () => {
  it('registers enumerate/acquire handles and a cancel listener', () => {
    const t = fakeIpc()
    registerUrlSubtitleBridge(t.ipc, fakeService())
    expect([...t.handlers.keys()].sort()).toEqual(
      [URL_SUBTITLE_CHANNELS.acquire, URL_SUBTITLE_CHANNELS.enumerate].sort()
    )
    expect([...t.listeners.keys()]).toEqual([URL_SUBTITLE_CHANNELS.cancel])
  })

  it('forwards a valid enumerate URL to the service', async () => {
    const t = fakeIpc()
    const service = fakeService()
    registerUrlSubtitleBridge(t.ipc, service)
    await t.invoke(URL_SUBTITLE_CHANNELS.enumerate, URL)
    expect(service.enumerate).toHaveBeenCalledWith(URL)
  })

  it('rejects a non-string enumerate URL before touching the service', () => {
    const t = fakeIpc()
    const service = fakeService()
    registerUrlSubtitleBridge(t.ipc, service)
    expect(() => t.invoke(URL_SUBTITLE_CHANNELS.enumerate, 42)).toThrow(/Invalid URL/)
    expect(() => t.invoke(URL_SUBTITLE_CHANNELS.enumerate, '')).toThrow(/Invalid URL/)
    expect(service.enumerate).not.toHaveBeenCalled()
  })

  it('forwards a valid descriptor to acquire', async () => {
    const t = fakeIpc()
    const service = fakeService()
    registerUrlSubtitleBridge(t.ipc, service)
    await t.invoke(URL_SUBTITLE_CHANNELS.acquire, { url: URL, selectionId: 'provided:en' })
    expect(service.acquire).toHaveBeenCalledWith({ url: URL, selectionId: 'provided:en' })
  })

  it('rejects a malformed acquire descriptor before touching the service', () => {
    const t = fakeIpc()
    const service = fakeService()
    registerUrlSubtitleBridge(t.ipc, service)
    expect(() => t.invoke(URL_SUBTITLE_CHANNELS.acquire, { url: URL })).toThrow(
      /Invalid subtitle selection/
    )
    expect(() => t.invoke(URL_SUBTITLE_CHANNELS.acquire, 'nope')).toThrow(
      /Invalid subtitle selection/
    )
    expect(service.acquire).not.toHaveBeenCalled()
  })

  it('routes the cancel listener to the service', () => {
    const t = fakeIpc()
    const service = fakeService()
    registerUrlSubtitleBridge(t.ipc, service)
    t.send(URL_SUBTITLE_CHANNELS.cancel)
    expect(service.cancel).toHaveBeenCalledOnce()
  })
})
