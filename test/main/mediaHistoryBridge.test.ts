import { describe, expect, it, vi } from 'vitest'
import {
  registerMediaHistoryBridge,
  type MediaHistoryBridgeService
} from '@src/main/mediaHistoryBridge'
import { MEDIA_HISTORY_CHANNELS } from '@src/shared/ipcChannels'
import { expectUntouched, fakeIpc, invokeRejection } from '@test/harness/fakeIpcMain'

function fakeService() {
  const service: MediaHistoryBridgeService = {
    getRecentFiles: vi.fn(() => []),
    getPlaybackHistory: vi.fn(() => ({ positionSeconds: 42, updatedAt: 2 })),
    removeRecentFile: vi.fn(() => []),
    clearRecentFiles: vi.fn(),
    checkFileAvailability: vi.fn(async () => ({ status: 'available' as const })),
    setAudioTrack: vi.fn(),
    setSubtitleTrack: vi.fn(),
    setSubtitleVersionOffset: vi.fn()
  }
  return { service }
}

describe('registerMediaHistoryBridge malformed requests', () => {
  it.each([
    [MEDIA_HISTORY_CHANNELS.getPlaybackHistory, [undefined]],
    [MEDIA_HISTORY_CHANNELS.removeRecentFile, [42]],
    [MEDIA_HISTORY_CHANNELS.checkFileAvailability, ['']],
    [MEDIA_HISTORY_CHANNELS.setAudioTrack, ['/v.mkv', { id: -1 }]],
    [MEDIA_HISTORY_CHANNELS.setSubtitleTrack, ['/v.mkv', { mode: 'bogus' }]],
    [MEDIA_HISTORY_CHANNELS.setSubtitleVersionOffset, ['/v.mkv', 'not-a-hash', 100]],
    [MEDIA_HISTORY_CHANNELS.setSubtitleVersionOffset, ['/v.mkv', 'a'.repeat(64), Number.NaN]]
  ])('rejects %s %j without calling the service', async (channel, args) => {
    const fake = fakeIpc()
    const { service } = fakeService()
    registerMediaHistoryBridge(fake.ipc, service)

    const err = await invokeRejection(fake, channel, ...args)

    expect(err).toEqual(new Error(`Invalid ${channel} request.`))
    expectUntouched(service)
  })
})
