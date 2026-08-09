// `createMediaService` is a composition root: each owner's behavior is covered
// beside it (test/main/media/*.test.ts, test/main/services/thumbnails/*).
// What is left to prove here is the wiring — that every `MediaServiceLike`
// method reaches the owner that implements it, carrying the configured
// dependency and its arguments.

import { describe, it, expect, vi } from 'vitest'
import { posix } from 'node:path'
import { createMediaService, type MediaServiceConfig } from '@src/main/mediaService'
import type { FfmpegExec } from '@src/main/media/ffmpeg'
import type { FfprobeExec } from '@src/main/media/ffprobe'

const ASS =
  '[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n' +
  'Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,こんばんは\n'

const SRT = '1\n00:00:01,000 --> 00:00:02,000\nこんにちは\n'

function service(overrides: Partial<MediaServiceConfig> = {}) {
  return createMediaService({
    ffprobePath: 'ffprobe-bin',
    ffmpegPath: 'ffmpeg-bin',
    tmpDir: '/tmp',
    // Wiring, not path shape, is what this composition root proves; each owner
    // asserts both platform variants in its own test. Pinning the platform
    // keeps these fixtures literal instead of host-derived.
    platform: 'linux',
    ...overrides
  })
}

describe('createMediaService picker delegation', () => {
  const selected = '/media/series/episode.mkv'
  const showOpenDialog = vi.fn(async () => ({ canceled: false, filePaths: [selected] }))

  it('routes openFile through the picker, including the history store', async () => {
    const mediaHistory = {
      getLastOpenFolder: vi.fn(() => '/media/series'),
      setLastOpenFolder: vi.fn()
    }
    await expect(service({ showOpenDialog, mediaHistory }).openFile()).resolves.toBe(selected)
    expect(mediaHistory.setLastOpenFolder).toHaveBeenCalledWith(posix.dirname(selected))
  })

  it('routes openFiles and openSubtitleFile through the picker', async () => {
    const svc = service({ showOpenDialog })
    await expect(svc.openFiles()).resolves.toEqual([selected])
    await expect(svc.openSubtitleFile()).resolves.toBe(selected)
  })

  it('routes openFolder through the picker and lists videos via the injected readdir', async () => {
    const svc = service({
      showOpenDialog: vi.fn(async () => ({ canceled: false, filePaths: ['/media/season1'] })),
      readDirImpl: vi.fn(async () => ['ep10.mkv', 'ep2.mkv', 'cover.jpg'])
    })
    await expect(svc.openFolder()).resolves.toEqual([
      '/media/season1/ep2.mkv',
      '/media/season1/ep10.mkv'
    ])
  })

  it('routes readPlaylist and savePlaylist through the configured file adapters', async () => {
    const writePlaylistTextImpl = vi.fn(async () => {})
    const svc = service({
      readPlaylistTextImpl: vi.fn(async () => '#EXTM3U\n/media/a.mkv\n'),
      writePlaylistTextImpl,
      showSaveDialog: vi.fn(async () => ({ canceled: false, filePath: '/out/list.m3u' }))
    })

    await expect(svc.readPlaylist('/media/list.m3u')).resolves.toEqual(['/media/a.mkv'])
    await expect(svc.savePlaylist(['/media/a.mkv'])).resolves.toBe('/out/list.m3u')
    expect(writePlaylistTextImpl).toHaveBeenCalledWith('/out/list.m3u', '#EXTM3U\n/media/a.mkv\n')
  })
})

describe('createMediaService metadata delegation', () => {
  it('passes the configured ffprobe binary and exec to every metadata call', async () => {
    const execFfprobeImpl = vi.fn<FfprobeExec>().mockResolvedValue(
      JSON.stringify({
        streams: [],
        chapters: [{ start_time: '1.5', end_time: '9.25', tags: { title: 'Opening' } }]
      })
    )
    const svc = service({ execFfprobeImpl })

    await expect(svc.getChapters('/video/ep.mkv')).resolves.toEqual([
      { start: 1.5, end: 9.25, title: 'Opening' }
    ])
    await expect(svc.enumerateTracks('/video/ep.mkv')).resolves.toEqual([])
    await expect(svc.getVideoDimensions('/video/ep.mkv')).resolves.toBeUndefined()
    for (const call of execFfprobeImpl.mock.calls) expect(call[0]).toBe('ffprobe-bin')
  })

  it('routes folderNeighbors through the injected directory reader', async () => {
    const svc = service({ readDirImpl: vi.fn(async () => ['ep1.mkv', 'ep2.mkv']) })
    await expect(svc.folderNeighbors('/media/ep1.mkv')).resolves.toEqual({
      next: '/media/ep2.mkv'
    })
  })
})

describe('createMediaService subtitle delegation', () => {
  it('routes loadSubtitle through ffmpeg extraction and temp-file cleanup', async () => {
    const removeFileImpl = vi.fn(async () => {})
    const execFfmpegImpl = vi.fn<FfmpegExec>().mockResolvedValue(undefined)
    const svc = service({
      execFfmpegImpl,
      readFileImpl: vi.fn(async () => ASS),
      removeFileImpl
    })

    await expect(svc.loadSubtitle('/videos/ep.mkv', 2)).resolves.toEqual([
      { start: 1, end: 2, text: 'こんばんは' }
    ])
    expect(execFfmpegImpl.mock.calls[0][0]).toBe('ffmpeg-bin')
    expect(removeFileImpl).toHaveBeenCalledTimes(1)
  })

  it('routes loadExternalSubtitle through the external-file reader', async () => {
    const readExternalFileImpl = vi.fn(async () => new TextEncoder().encode(SRT))
    const svc = service({ readExternalFileImpl })

    await expect(svc.loadExternalSubtitle('/subs/ep.srt', 'auto')).resolves.toEqual([
      { start: 1, end: 2, text: 'こんにちは' }
    ])
    expect(readExternalFileImpl).toHaveBeenCalledWith('/subs/ep.srt')
  })
})

describe('createMediaService thumbnail delegation', () => {
  it('routes getThumbnail through the injected thumbnail service and base64 reader', async () => {
    const thumbnailServiceImpl = {
      getThumbnail: vi.fn(async (_p: string, _t: number, _d: number) => '/cache/ab/12.jpg')
    }
    const readThumbnailBase64Impl = vi.fn(async (_p: string) => 'QUJD')
    const svc = service({ thumbnailServiceImpl, readThumbnailBase64Impl })

    await expect(svc.getThumbnail('/video/ep.mkv', 42, 1200)).resolves.toEqual({
      dataUrl: 'data:image/jpeg;base64,QUJD'
    })
    expect(thumbnailServiceImpl.getThumbnail).toHaveBeenCalledWith('/video/ep.mkv', 42, 1200)
    expect(readThumbnailBase64Impl).toHaveBeenCalledWith('/cache/ab/12.jpg')
  })

  it('resolves null when no thumbnail cache dir is configured', async () => {
    await expect(service().getThumbnail('/video/ep.mkv', 42, 1200)).resolves.toBeNull()
  })
})
