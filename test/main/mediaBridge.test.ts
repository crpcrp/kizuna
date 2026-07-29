import { describe, it, expect, vi } from 'vitest'
import { registerMediaBridge, type MediaServiceLike } from '@src/main/mediaBridge'
import type { IpcMainHandleLike } from '@src/main/playerBridge'
import { MEDIA_CHANNELS } from '@src/shared/ipcChannels'
import type { Track, VideoDimensions } from '@src/shared/track'
import type { Cue } from '@src/shared/cue'
import type { SubtitleEncoding } from '@src/shared/subtitleEncoding'

type FakeEvent = { senderId: number }

/** Fake ipcMain: records handlers per channel. */
function fakeIpc() {
  const handlers = new Map<string, (event: FakeEvent, ...args: unknown[]) => unknown>()
  const ipc: IpcMainHandleLike<FakeEvent> = {
    handle: (channel, listener) => {
      handlers.set(channel, listener)
    }
  }
  return { ipc, handlers }
}

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

  it('registers every command channel', () => {
    const { ipc, handlers } = fakeIpc()
    const { service } = fakeService(tracks, cues)
    registerMediaBridge(ipc, service)

    expect([...handlers.keys()].sort()).toEqual(
      [
        MEDIA_CHANNELS.openFile,
        MEDIA_CHANNELS.openFiles,
        MEDIA_CHANNELS.openFolder,
        MEDIA_CHANNELS.readPlaylist,
        MEDIA_CHANNELS.savePlaylist,
        MEDIA_CHANNELS.openSubtitleFile,
        MEDIA_CHANNELS.enumerateTracks,
        MEDIA_CHANNELS.loadSubtitle,
        MEDIA_CHANNELS.loadExternalSubtitle,
        MEDIA_CHANNELS.getVideoDimensions,
        MEDIA_CHANNELS.getChapters,
        MEDIA_CHANNELS.folderNeighbors,
        MEDIA_CHANNELS.thumbnail
      ].sort()
    )
  })

  it('forwards folderNeighbors to service.folderNeighbors and returns its value', async () => {
    const { ipc, handlers } = fakeIpc()
    const { service } = fakeService(tracks, cues)
    registerMediaBridge(ipc, service)

    const result = await handlers.get(MEDIA_CHANNELS.folderNeighbors)!(event, '/tmp/ep2.mkv')

    expect(service.folderNeighbors).toHaveBeenCalledWith('/tmp/ep2.mkv')
    expect(result).toEqual({ prev: '/tmp/ep1.mkv', next: '/tmp/ep3.mkv' })
  })

  it('forwards openFile to service.openFile and returns its value', async () => {
    const { ipc, handlers } = fakeIpc()
    const { service } = fakeService(tracks, cues)
    registerMediaBridge(ipc, service)

    const result = await handlers.get(MEDIA_CHANNELS.openFile)!(event)

    expect(service.openFile).toHaveBeenCalledWith()
    expect(result).toBe('/tmp/video.mp4')
  })

  it('forwards openFiles to service.openFiles and returns the path array', async () => {
    const { ipc, handlers } = fakeIpc()
    const { service } = fakeService(tracks, cues)
    registerMediaBridge(ipc, service)

    const result = await handlers.get(MEDIA_CHANNELS.openFiles)!(event)

    expect(service.openFiles).toHaveBeenCalledWith()
    expect(result).toEqual(['/tmp/ep1.mkv', '/tmp/ep2.mkv'])
  })

  it('forwards openFolder to service.openFolder and returns the folder videos', async () => {
    const { ipc, handlers } = fakeIpc()
    const { service } = fakeService(tracks, cues)
    registerMediaBridge(ipc, service)

    const result = await handlers.get(MEDIA_CHANNELS.openFolder)!(event)

    expect(service.openFolder).toHaveBeenCalledWith()
    expect(result).toEqual(['/tmp/folder/ep1.mkv', '/tmp/folder/ep2.mkv'])
  })

  it('forwards readPlaylist with the file path and returns the parsed paths', async () => {
    const { ipc, handlers } = fakeIpc()
    const { service } = fakeService(tracks, cues)
    registerMediaBridge(ipc, service)

    const result = await handlers.get(MEDIA_CHANNELS.readPlaylist)!(event, '/media/list.m3u')

    expect(service.readPlaylist).toHaveBeenCalledWith('/media/list.m3u')
    expect(result).toEqual(['/tmp/a.mkv', '/tmp/b.mkv'])
  })

  it('forwards savePlaylist with the paths and returns the saved file path', async () => {
    const { ipc, handlers } = fakeIpc()
    const { service } = fakeService(tracks, cues)
    registerMediaBridge(ipc, service)

    const result = await handlers.get(MEDIA_CHANNELS.savePlaylist)!(event, [
      '/tmp/a.mkv',
      '/tmp/b.mkv'
    ])

    expect(service.savePlaylist).toHaveBeenCalledWith(['/tmp/a.mkv', '/tmp/b.mkv'])
    expect(result).toBe('/out/list.m3u')
  })

  it('forwards openSubtitleFile to service.openSubtitleFile and returns its value', async () => {
    const { ipc, handlers } = fakeIpc()
    const { service } = fakeService(tracks, cues)
    registerMediaBridge(ipc, service)

    const result = await handlers.get(MEDIA_CHANNELS.openSubtitleFile)!(event)

    expect(service.openSubtitleFile).toHaveBeenCalledWith()
    expect(result).toBe('/subs/episode.srt')
  })

  it('forwards enumerateTracks with filePath and returns the Track[]', async () => {
    const { ipc, handlers } = fakeIpc()
    const { service } = fakeService(tracks, cues)
    registerMediaBridge(ipc, service)

    const result = await handlers.get(MEDIA_CHANNELS.enumerateTracks)!(event, '/tmp/video.mp4')

    expect(service.enumerateTracks).toHaveBeenCalledWith('/tmp/video.mp4')
    expect(result).toEqual(tracks)
  })

  it('forwards loadSubtitle with filePath and streamIndex, returns the Cue[]', async () => {
    const { ipc, handlers } = fakeIpc()
    const { service } = fakeService(tracks, cues)
    registerMediaBridge(ipc, service)

    const result = await handlers.get(MEDIA_CHANNELS.loadSubtitle)!(event, '/tmp/video.mp4', 2)

    expect(service.loadSubtitle).toHaveBeenCalledWith('/tmp/video.mp4', 2)
    expect(result).toEqual(cues)
  })

  it('forwards a valid loadExternalSubtitle encoding with the subtitle path and returns the Cue[]', async () => {
    const { ipc, handlers } = fakeIpc()
    const { service } = fakeService(tracks, cues)
    registerMediaBridge(ipc, service)

    const result = await handlers.get(MEDIA_CHANNELS.loadExternalSubtitle)!(
      event,
      '/subs/episode.srt',
      'shift_jis'
    )

    expect(service.loadExternalSubtitle).toHaveBeenCalledWith('/subs/episode.srt', 'shift_jis')
    expect(result).toEqual(cues)
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

  it('forwards getThumbnail with path/time/duration and returns the data URL', async () => {
    const { ipc, handlers } = fakeIpc()
    const { service } = fakeService(tracks, cues)
    registerMediaBridge(ipc, service)

    const result = await handlers.get(MEDIA_CHANNELS.thumbnail)!(event, '/tmp/video.mp4', 42, 1200)

    expect(service.getThumbnail).toHaveBeenCalledWith('/tmp/video.mp4', 42, 1200)
    expect(result).toEqual({ dataUrl: 'data:image/jpeg;base64,QUJD' })
  })

  it('forwards getVideoDimensions with filePath and returns the dimensions', async () => {
    const { ipc, handlers } = fakeIpc()
    const { service } = fakeService(tracks, cues, { width: 1920, height: 1080 })
    registerMediaBridge(ipc, service)

    const result = await handlers.get(MEDIA_CHANNELS.getVideoDimensions)!(event, '/tmp/video.mp4')

    expect(service.getVideoDimensions).toHaveBeenCalledWith('/tmp/video.mp4')
    expect(result).toEqual({ width: 1920, height: 1080 })
  })
})
