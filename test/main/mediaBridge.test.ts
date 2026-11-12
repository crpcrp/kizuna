import { describe, it, expect, vi } from 'vitest'
import { registerMediaBridge, type MediaServiceLike } from '@src/main/mediaBridge'
import { MEDIA_CHANNELS } from '@src/shared/ipcChannels'
import type { Track, VideoDimensions } from '@src/shared/track'
import type { Cue } from '@src/shared/cue'
import type { SubtitleEncoding } from '@src/shared/subtitleEncoding'
import {
  expectUntouched,
  fakeIpc,
  invokeRejection,
  type FakeEvent
} from '@test/harness/fakeIpcMain'

/** Fake media service: records calls and returns canned values. */
function fakeService(tracks: Track[], cues: Cue[], dims: VideoDimensions | undefined = undefined) {
  const service: MediaServiceLike = {
    openFile: vi.fn(async () => '/tmp/video.mp4'),
    openFiles: vi.fn(async () => ['/tmp/ep1.mkv', '/tmp/ep2.mkv']),
    openFolder: vi.fn(async () => ['/tmp/folder/ep1.mkv', '/tmp/folder/ep2.mkv']),
    readPlaylist: vi.fn(async (_filePath: string) => ['/tmp/a.mkv', '/tmp/b.mkv']),
    savePlaylist: vi.fn(async (_paths: string[]) => '/out/list.m3u'),
    openSubtitleFile: vi.fn(async () => '/subs/episode.srt'),
    enumerateTracks: vi.fn(async (_filePath: string) => tracks),
    loadSubtitle: vi.fn(async (_filePath: string, _streamIndex: number) => cues),
    loadExternalSubtitle: vi.fn(async (_subtitlePath: string, _encoding: SubtitleEncoding) => cues),
    getVideoDimensions: vi.fn(async (_filePath: string) => dims),
    getChapters: vi.fn(async (_filePath: string) => []),
    folderNeighbors: vi.fn(async (_filePath: string) => ({
      prev: '/tmp/ep1.mkv',
      next: '/tmp/ep3.mkv'
    })),
    getThumbnail: vi.fn(async (_filePath: string, _timeSec: number, _durationSec: number) => ({
      dataUrl: 'data:image/jpeg;base64,QUJD'
    }))
  }
  return { service }
}

describe('registerMediaBridge', () => {
  const event: FakeEvent = { senderId: 7 }
  const tracks: Track[] = [{ id: 0, kind: 'audio', codec: 'aac', language: 'jpn' }]
  const cues: Cue[] = [{ start: 0, end: 1, text: 'こんにちは' }]

  it('rejects URL paths before any media service can probe or read them', () => {
    const { ipc, handlers } = fakeIpc()
    const { service } = fakeService(tracks, cues)
    registerMediaBridge(ipc, service)
    const url = 'https://host.example/media.mkv'

    const calls: [keyof typeof MEDIA_CHANNELS, unknown[]][] = [
      ['readPlaylist', [url]],
      ['enumerateTracks', [url]],
      ['loadSubtitle', [url, 2]],
      ['loadExternalSubtitle', [url, 'auto']],
      ['getVideoDimensions', [url]],
      ['getChapters', [url]],
      ['folderNeighbors', [url]],
      ['thumbnail', [url, 10, 100]]
    ]
    for (const [channel, args] of calls) {
      expect(() => handlers.get(MEDIA_CHANNELS[channel])!(event, ...args)).toThrow(
        'URL playback is not supported.'
      )
    }

    expect(service.readPlaylist).not.toHaveBeenCalled()
    expect(service.enumerateTracks).not.toHaveBeenCalled()
    expect(service.loadSubtitle).not.toHaveBeenCalled()
    expect(service.loadExternalSubtitle).not.toHaveBeenCalled()
    expect(service.getVideoDimensions).not.toHaveBeenCalled()
    expect(service.getChapters).not.toHaveBeenCalled()
    expect(service.folderNeighbors).not.toHaveBeenCalled()
    expect(service.getThumbnail).not.toHaveBeenCalled()
  })

  it('defaults an omitted external subtitle encoding to auto', async () => {
    const { ipc, handlers } = fakeIpc()
    const { service } = fakeService(tracks, cues)
    registerMediaBridge(ipc, service)

    await handlers.get(MEDIA_CHANNELS.loadExternalSubtitle)!(event, '/subs/episode.srt')

    expect(service.loadExternalSubtitle).toHaveBeenCalledWith('/subs/episode.srt', 'auto')
  })

  it('rejects an unknown external subtitle encoding before calling the service', async () => {
    const { ipc, handlers } = fakeIpc()
    const { service } = fakeService(tracks, cues)
    registerMediaBridge(ipc, service)

    expect(() =>
      handlers.get(MEDIA_CHANNELS.loadExternalSubtitle)!(event, '/subs/episode.srt', 'utf-32')
    ).toThrow('Unsupported subtitle encoding.')
    expect(service.loadExternalSubtitle).not.toHaveBeenCalled()
  })
})

describe('registerMediaBridge malformed requests', () => {
  it.each([
    [MEDIA_CHANNELS.readPlaylist, [undefined]],
    [MEDIA_CHANNELS.savePlaylist, [new Array(50_001).fill('x')]],
    [MEDIA_CHANNELS.enumerateTracks, [42]],
    [MEDIA_CHANNELS.loadSubtitle, ['/v.mkv', -1]],
    [MEDIA_CHANNELS.getChapters, ['']],
    [MEDIA_CHANNELS.thumbnail, ['/v.mkv', 1, 'long']]
  ])('rejects %s %j without calling the service', async (channel, args) => {
    const fake = fakeIpc()
    const { service } = fakeService([], [])
    registerMediaBridge(fake.ipc, service)

    const err = await invokeRejection(fake, channel, ...args)

    expect(err).toEqual(new Error(`Invalid ${channel} request.`))
    expectUntouched(service)
  })
})
