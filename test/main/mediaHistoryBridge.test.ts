import { describe, expect, it, vi } from 'vitest'
import {
  registerMediaHistoryBridge,
  type MediaHistoryBridgeService
} from '@src/main/mediaHistoryBridge'
import type { IpcMainHandleLike } from '@src/main/playerBridge'
import { MEDIA_HISTORY_CHANNELS } from '@src/shared/ipcChannels'
import type { FileAvailability } from '@src/shared/preloadApi'
import type { RecentMediaFile } from '@src/shared/mediaHistory'

type FakeEvent = { senderId: number }

function fakeIpc() {
  const handlers = new Map<string, (event: FakeEvent, ...args: unknown[]) => unknown>()
  const ipc: IpcMainHandleLike<FakeEvent> = {
    handle: (channel, listener) => handlers.set(channel, listener)
  }
  return { ipc, handlers }
}

function fakeService(availability: FileAvailability = { status: 'available' }) {
  const recents: RecentMediaFile[] = [{ path: 'C:\\Media\\episode.mkv', openedAt: 1 }]
  const service: MediaHistoryBridgeService = {
    getRecentFiles: vi.fn(() => recents),
    getPlaybackHistory: vi.fn(() => ({ positionSeconds: 42, updatedAt: 2 })),
    removeRecentFile: vi.fn(() => []),
    clearRecentFiles: vi.fn(),
    checkFileAvailability: vi.fn(async () => availability),
    setAudioTrack: vi.fn(),
    setSubtitleTrack: vi.fn()
  }
  return { service, recents }
}

describe('registerMediaHistoryBridge', () => {
  const event: FakeEvent = { senderId: 7 }
  const path = 'C:\\Media\\episode.mkv'

  it('registers every media-history channel', () => {
    const { ipc, handlers } = fakeIpc()
    registerMediaHistoryBridge(ipc, fakeService().service)

    expect([...handlers.keys()].sort()).toEqual(Object.values(MEDIA_HISTORY_CHANNELS).sort())
  })

  it('forwards history reads and recent mutations with their results', async () => {
    const { ipc, handlers } = fakeIpc()
    const { service, recents } = fakeService()
    registerMediaHistoryBridge(ipc, service)

    expect(await handlers.get(MEDIA_HISTORY_CHANNELS.getRecentFiles)!(event)).toEqual(recents)
    expect(await handlers.get(MEDIA_HISTORY_CHANNELS.getPlaybackHistory)!(event, path)).toEqual({
      positionSeconds: 42,
      updatedAt: 2
    })
    expect(await handlers.get(MEDIA_HISTORY_CHANNELS.removeRecentFile)!(event, path)).toEqual([])
    expect(await handlers.get(MEDIA_HISTORY_CHANNELS.clearRecentFiles)!(event)).toBeUndefined()
    expect(service.getPlaybackHistory).toHaveBeenCalledWith(path)
    expect(service.removeRecentFile).toHaveBeenCalledWith(path)
    expect(service.clearRecentFiles).toHaveBeenCalledOnce()
  })

  it('forwards availability and track selections without altering serializable DTOs', async () => {
    const { ipc, handlers } = fakeIpc()
    const { service } = fakeService({ status: 'error', message: 'Unable to read file.' })
    registerMediaHistoryBridge(ipc, service)
    const audio = { id: 2, language: 'ja', codec: 'aac' }
    const subtitle = { mode: 'off' as const }

    expect(await handlers.get(MEDIA_HISTORY_CHANNELS.checkFileAvailability)!(event, path)).toEqual({
      status: 'error',
      message: 'Unable to read file.'
    })
    expect(
      await handlers.get(MEDIA_HISTORY_CHANNELS.setAudioTrack)!(event, path, audio)
    ).toBeUndefined()
    expect(
      await handlers.get(MEDIA_HISTORY_CHANNELS.setSubtitleTrack)!(event, path, subtitle)
    ).toBeUndefined()
    expect(service.checkFileAvailability).toHaveBeenCalledWith(path)
    expect(service.setAudioTrack).toHaveBeenCalledWith(path, audio)
    expect(service.setSubtitleTrack).toHaveBeenCalledWith(path, subtitle)
  })
})
