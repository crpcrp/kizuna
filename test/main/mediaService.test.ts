// Unit test for mediaService.ts's pure helper.
//
// Only `subtitleTempPath` is unit-tested here (pure, deterministic). The
// Electron-bound factory (`createMediaService`, real dialog/ffprobe/ffmpeg
// exec) is glue verified structurally, not with a fabricated test — mirrors
// how the `startPlayer` wiring in index.ts is untested.

import { describe, it, expect, vi } from 'vitest'
import { dirname, join } from 'node:path'
import {
  createMediaService,
  subtitleTempPath,
  type ReadBinaryFile,
  type ReadPlaylistText,
  type RemoveFile,
  type ShowOpenDialog,
  type ShowSaveDialog,
  type WritePlaylistText
} from '@src/main/mediaService'
import type { FfmpegExec } from '@src/main/media/ffmpeg'
import type { ReadTextFile } from '@src/main/media/subtitleLoader'

// Expected paths are built with node:path's `join` (not hardcoded literals)
// since `subtitleTempPath` uses the platform-native separator internally
// (backslash on Windows, forward slash elsewhere).

describe('subtitleTempPath', () => {
  // A pinned token keeps these assertions deterministic; production omits it so
  // the suffix is crypto-random (see the non-guessable-component test below).
  it('builds a .ass path including the stream index and token', () => {
    const result = subtitleTempPath('/tmp', '/videos/episode01.mkv', 2, 'ass', 'deadbeef')
    expect(result).toBe(join('/tmp', 'kizuna-sub-episode01.mkv-2-deadbeef.ass'))
  })

  it('builds a .srt path including the stream index and token', () => {
    const result = subtitleTempPath('/tmp', '/videos/episode01.mkv', 5, 'srt', 'deadbeef')
    expect(result).toBe(join('/tmp', 'kizuna-sub-episode01.mkv-5-deadbeef.srt'))
  })

  it('is deterministic when the token is pinned', () => {
    const a = subtitleTempPath('/tmp', '/videos/episode01.mkv', 3, 'ass', 'deadbeef')
    const b = subtitleTempPath('/tmp', '/videos/episode01.mkv', 3, 'ass', 'deadbeef')
    expect(a).toBe(b)
  })

  it('differs by stream index for the same input file', () => {
    const a = subtitleTempPath('/tmp', '/videos/episode01.mkv', 1, 'ass', 'deadbeef')
    const b = subtitleTempPath('/tmp', '/videos/episode01.mkv', 2, 'ass', 'deadbeef')
    expect(a).not.toBe(b)
  })

  it('uses the basename of the input path, not the full path', () => {
    const result = subtitleTempPath('/tmp', '/some/deep/path/episode01.mkv', 0, 'srt', 'deadbeef')
    expect(result).toBe(join('/tmp', 'kizuna-sub-episode01.mkv-0-deadbeef.srt'))
  })

  it('appends an unguessable random component when no token is given', () => {
    const a = subtitleTempPath('/tmp', '/videos/episode01.mkv', 2, 'ass')
    const b = subtitleTempPath('/tmp', '/videos/episode01.mkv', 2, 'ass')
    // Same inputs, different paths: the suffix is random, not derived from the
    // media filename, so it cannot be predicted for a pre-created symlink.
    expect(a).not.toBe(b)
    expect(a).toMatch(/kizuna-sub-episode01\.mkv-2-[0-9a-f]{16,}\.ass$/)
    expect(b).toMatch(/kizuna-sub-episode01\.mkv-2-[0-9a-f]{16,}\.ass$/)
  })
})

const videoDialogOptions = {
  properties: ['openFile'],
  filters: [{ name: 'Media', extensions: ['mkv', 'mp4', 'webm', 'avi', 'mov', 'm3u', 'm3u8'] }]
}

function createOpenFileService(showOpenDialog: ShowOpenDialog, lastOpenFolder?: string) {
  const history = {
    getLastOpenFolder: vi.fn(() => lastOpenFolder),
    setLastOpenFolder: vi.fn()
  }
  return {
    service: createMediaService({
      ffprobePath: 'ffprobe',
      ffmpegPath: 'ffmpeg',
      tmpDir: '/tmp',
      showOpenDialog,
      mediaHistory: history
    }),
    history
  }
}

describe('createMediaService openFile', () => {
  it('uses the saved folder as the dialog default and persists the selected file folder', async () => {
    const selectedPath = join('/media', 'series', 'episode.mkv')
    const showOpenDialog = vi
      .fn<ShowOpenDialog>()
      .mockResolvedValue({ canceled: false, filePaths: [selectedPath] })
    const { service, history } = createOpenFileService(showOpenDialog, join('/media', 'series'))

    await expect(service.openFile()).resolves.toBe(selectedPath)
    expect(showOpenDialog).toHaveBeenCalledWith({
      ...videoDialogOptions,
      defaultPath: join('/media', 'series')
    })
    expect(history.setLastOpenFolder).toHaveBeenCalledWith(dirname(selectedPath))
  })

  it('preserves the saved folder when the dialog is cancelled', async () => {
    const showOpenDialog = vi
      .fn<ShowOpenDialog>()
      .mockResolvedValue({ canceled: true, filePaths: [] })
    const { service, history } = createOpenFileService(showOpenDialog, '/media/series')

    await expect(service.openFile()).resolves.toBeUndefined()
    expect(history.setLastOpenFolder).not.toHaveBeenCalled()
  })

  it('retries exactly once without a stale default folder after the first dialog failure', async () => {
    const selectedPath = '/new-media/episode.mkv'
    const showOpenDialog = vi
      .fn<ShowOpenDialog>()
      .mockRejectedValueOnce(new Error('stale folder'))
      .mockResolvedValueOnce({ canceled: false, filePaths: [selectedPath] })
    const { service, history } = createOpenFileService(showOpenDialog, '/stale-folder')

    await expect(service.openFile()).resolves.toBe(selectedPath)
    expect(showOpenDialog).toHaveBeenNthCalledWith(1, {
      ...videoDialogOptions,
      defaultPath: '/stale-folder'
    })
    expect(showOpenDialog).toHaveBeenNthCalledWith(2, videoDialogOptions)
    expect(showOpenDialog).toHaveBeenCalledTimes(2)
    expect(history.setLastOpenFolder).toHaveBeenCalledWith('/new-media')
  })

  it('propagates a retry failure and does not clear the saved folder', async () => {
    const showOpenDialog = vi
      .fn<ShowOpenDialog>()
      .mockRejectedValueOnce(new Error('stale folder'))
      .mockRejectedValueOnce(new Error('dialog unavailable'))
    const { service, history } = createOpenFileService(showOpenDialog, '/stale-folder')

    await expect(service.openFile()).rejects.toThrow('dialog unavailable')
    expect(showOpenDialog).toHaveBeenCalledTimes(2)
    expect(history.setLastOpenFolder).not.toHaveBeenCalled()
  })
})

const subtitleDialogOptions = {
  properties: ['openFile'],
  filters: [{ name: 'Subtitles', extensions: ['srt', 'ass', 'ssa'] }]
}

describe('createMediaService openSubtitleFile', () => {
  it('filters the dialog to subtitle files and defaults to the last open folder', async () => {
    const selectedPath = join('/media', 'series', 'episode.srt')
    const showOpenDialog = vi
      .fn<ShowOpenDialog>()
      .mockResolvedValue({ canceled: false, filePaths: [selectedPath] })
    const { service } = createOpenFileService(showOpenDialog, join('/media', 'series'))

    await expect(service.openSubtitleFile()).resolves.toBe(selectedPath)
    expect(showOpenDialog).toHaveBeenCalledWith({
      ...subtitleDialogOptions,
      defaultPath: join('/media', 'series')
    })
  })

  it('leaves the last open folder alone — it is the video picker’s memory', async () => {
    const selectedPath = join('/downloads', 'subs', 'episode.ass')
    const showOpenDialog = vi
      .fn<ShowOpenDialog>()
      .mockResolvedValue({ canceled: false, filePaths: [selectedPath] })
    const { service, history } = createOpenFileService(showOpenDialog, join('/media', 'series'))

    await expect(service.openSubtitleFile()).resolves.toBe(selectedPath)
    expect(history.setLastOpenFolder).not.toHaveBeenCalled()
  })

  it('resolves undefined when the dialog is cancelled', async () => {
    const showOpenDialog = vi
      .fn<ShowOpenDialog>()
      .mockResolvedValue({ canceled: true, filePaths: [] })
    const { service } = createOpenFileService(showOpenDialog, '/media/series')

    await expect(service.openSubtitleFile()).resolves.toBeUndefined()
  })

  it('retries once without a stale default folder after the first dialog failure', async () => {
    const selectedPath = '/subs/episode.srt'
    const showOpenDialog = vi
      .fn<ShowOpenDialog>()
      .mockRejectedValueOnce(new Error('stale folder'))
      .mockResolvedValueOnce({ canceled: false, filePaths: [selectedPath] })
    const { service } = createOpenFileService(showOpenDialog, '/stale-folder')

    await expect(service.openSubtitleFile()).resolves.toBe(selectedPath)
    expect(showOpenDialog).toHaveBeenNthCalledWith(1, {
      ...subtitleDialogOptions,
      defaultPath: '/stale-folder'
    })
    expect(showOpenDialog).toHaveBeenNthCalledWith(2, subtitleDialogOptions)
    expect(showOpenDialog).toHaveBeenCalledTimes(2)
  })
})

const SRT = '1\n00:00:01,000 --> 00:00:02,000\nこんにちは\n'
const ASS =
  '[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n' +
  'Dialogue: 0,0:00:01.00,0:00:02.00,Default,,0,0,0,,こんばんは\n'

/** The subtitle file's contents are injected — no real disk read. */
function createSubtitleService(readExternalFileImpl: ReadBinaryFile) {
  return createMediaService({
    ffprobePath: 'ffprobe',
    ffmpegPath: 'ffmpeg',
    tmpDir: '/tmp',
    readExternalFileImpl
  })
}

describe('createMediaService loadExternalSubtitle', () => {
  it('reads and parses a .srt file into cues', async () => {
    const readFile = vi.fn<ReadBinaryFile>().mockResolvedValue(new TextEncoder().encode(SRT))
    const service = createSubtitleService(readFile)

    await expect(service.loadExternalSubtitle('/subs/episode.srt', 'auto')).resolves.toEqual([
      { start: 1, end: 2, text: 'こんにちは' }
    ])
    expect(readFile).toHaveBeenCalledWith('/subs/episode.srt')
  })

  it('routes .ass and .ssa through the ASS parser', async () => {
    const service = createSubtitleService(
      vi.fn<ReadBinaryFile>().mockResolvedValue(new TextEncoder().encode(ASS))
    )

    await expect(service.loadExternalSubtitle('/subs/episode.ass', 'auto')).resolves.toEqual([
      { start: 1, end: 2, text: 'こんばんは' }
    ])
    await expect(service.loadExternalSubtitle('/subs/episode.ssa', 'auto')).resolves.toEqual([
      { start: 1, end: 2, text: 'こんばんは' }
    ])
  })

  it('tolerates a UTF-8 BOM before the first cue index', async () => {
    const service = createSubtitleService(
      vi
        .fn<ReadBinaryFile>()
        .mockResolvedValue(new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(SRT)]))
    )

    await expect(service.loadExternalSubtitle('/subs/episode.srt', 'auto')).resolves.toEqual([
      { start: 1, end: 2, text: 'こんにちは' }
    ])
  })

  it('accepts an uppercase extension', async () => {
    const service = createSubtitleService(
      vi.fn<ReadBinaryFile>().mockResolvedValue(new TextEncoder().encode(SRT))
    )

    await expect(service.loadExternalSubtitle('/subs/EPISODE.SRT', 'auto')).resolves.toHaveLength(1)
  })

  it('rejects a non-subtitle extension without reading the file', async () => {
    const readFile = vi.fn<ReadBinaryFile>().mockResolvedValue(new TextEncoder().encode(SRT))
    const service = createSubtitleService(readFile)

    await expect(service.loadExternalSubtitle('/subs/notes.txt', 'auto')).rejects.toThrow(
      'Unsupported subtitle file type.'
    )
    expect(readFile).not.toHaveBeenCalled()
  })

  it('rejects a file that parses to no cues', async () => {
    const service = createSubtitleService(
      vi.fn<ReadBinaryFile>().mockResolvedValue(new Uint8Array())
    )

    await expect(service.loadExternalSubtitle('/subs/empty.srt', 'auto')).rejects.toThrow(
      'No subtitles found in this file.'
    )
  })
})

describe('createMediaService loadSubtitle', () => {
  // loadSubtitle always extracts as '.ass', so the injected readFile returns ASS.
  const okExec = vi.fn<FfmpegExec>().mockResolvedValue(undefined)
  const readAss = vi.fn<ReadTextFile>().mockResolvedValue(ASS)

  it('deletes the extracted temp file after parsing its cues', async () => {
    const removeFileImpl = vi.fn<RemoveFile>().mockResolvedValue(undefined)
    const service = createMediaService({
      ffprobePath: 'ffprobe',
      ffmpegPath: 'ffmpeg',
      tmpDir: '/tmp',
      execFfmpegImpl: okExec,
      readFileImpl: readAss,
      removeFileImpl
    })

    await expect(service.loadSubtitle('/videos/ep.mkv', 2)).resolves.toEqual([
      { start: 1, end: 2, text: 'こんばんは' }
    ])
    expect(removeFileImpl).toHaveBeenCalledTimes(1)
    // The removed path is exactly the one that was extracted and read back.
    const outputPath = readAss.mock.calls[0][0]
    expect(removeFileImpl).toHaveBeenCalledWith(outputPath)
  })

  it('deletes the temp file even when extraction fails, and propagates the error', async () => {
    const removeFileImpl = vi.fn<RemoveFile>().mockResolvedValue(undefined)
    const failExec = vi.fn<FfmpegExec>().mockRejectedValue(new Error('ffmpeg exploded'))
    const service = createMediaService({
      ffprobePath: 'ffprobe',
      ffmpegPath: 'ffmpeg',
      tmpDir: '/tmp',
      execFfmpegImpl: failExec,
      readFileImpl: readAss,
      removeFileImpl
    })

    await expect(service.loadSubtitle('/videos/ep.mkv', 2)).rejects.toThrow('ffmpeg exploded')
    expect(removeFileImpl).toHaveBeenCalledTimes(1)
  })

  it('does not fail the load when the temp-file cleanup rejects', async () => {
    const removeFileImpl = vi.fn<RemoveFile>().mockRejectedValue(new Error('ENOENT'))
    const service = createMediaService({
      ffprobePath: 'ffprobe',
      ffmpegPath: 'ffmpeg',
      tmpDir: '/tmp',
      execFfmpegImpl: okExec,
      readFileImpl: readAss,
      removeFileImpl
    })

    await expect(service.loadSubtitle('/videos/ep.mkv', 2)).resolves.toHaveLength(1)
    expect(removeFileImpl).toHaveBeenCalledTimes(1)
  })
})

const multiFileDialogOptions = {
  properties: ['openFile', 'multiSelections'],
  filters: [{ name: 'Media', extensions: ['mkv', 'mp4', 'webm', 'avi', 'mov', 'm3u', 'm3u8'] }]
}

describe('createMediaService openFiles', () => {
  it('multi-selects and persists the folder of the first pick', async () => {
    const picks = [join('/media', 'series', 'ep1.mkv'), join('/media', 'series', 'ep2.mkv')]
    const showOpenDialog = vi
      .fn<ShowOpenDialog>()
      .mockResolvedValue({ canceled: false, filePaths: picks })
    const { service, history } = createOpenFileService(showOpenDialog, join('/media', 'series'))

    await expect(service.openFiles()).resolves.toEqual(picks)
    expect(showOpenDialog).toHaveBeenCalledWith({
      ...multiFileDialogOptions,
      defaultPath: join('/media', 'series')
    })
    expect(history.setLastOpenFolder).toHaveBeenCalledWith(dirname(picks[0]))
  })

  it('resolves an empty array and leaves the folder untouched when cancelled', async () => {
    const showOpenDialog = vi
      .fn<ShowOpenDialog>()
      .mockResolvedValue({ canceled: true, filePaths: [] })
    const { service, history } = createOpenFileService(showOpenDialog, '/media/series')

    await expect(service.openFiles()).resolves.toEqual([])
    expect(history.setLastOpenFolder).not.toHaveBeenCalled()
  })

  it('retries once without a stale default folder after a first dialog failure', async () => {
    const picks = ['/new-media/ep1.mkv']
    const showOpenDialog = vi
      .fn<ShowOpenDialog>()
      .mockRejectedValueOnce(new Error('stale folder'))
      .mockResolvedValueOnce({ canceled: false, filePaths: picks })
    const { service } = createOpenFileService(showOpenDialog, '/stale-folder')

    await expect(service.openFiles()).resolves.toEqual(picks)
    expect(showOpenDialog).toHaveBeenNthCalledWith(1, {
      ...multiFileDialogOptions,
      defaultPath: '/stale-folder'
    })
    expect(showOpenDialog).toHaveBeenNthCalledWith(2, multiFileDialogOptions)
  })
})

describe('createMediaService openFolder', () => {
  it('lists the chosen folder’s videos, naturally sorted, and remembers the folder', async () => {
    const showOpenDialog = vi
      .fn<ShowOpenDialog>()
      .mockResolvedValue({ canceled: false, filePaths: ['/media/season1'] })
    const history = { getLastOpenFolder: vi.fn(() => undefined), setLastOpenFolder: vi.fn() }
    const service = createMediaService({
      ffprobePath: 'ffprobe',
      ffmpegPath: 'ffmpeg',
      tmpDir: '/tmp',
      showOpenDialog,
      mediaHistory: history,
      readDirImpl: vi.fn(async () => ['ep10.mkv', 'ep2.mkv', 'cover.jpg'])
    })

    await expect(service.openFolder()).resolves.toEqual([
      join('/media/season1', 'ep2.mkv'),
      join('/media/season1', 'ep10.mkv')
    ])
    expect(showOpenDialog).toHaveBeenCalledWith({ properties: ['openDirectory'] })
    expect(history.setLastOpenFolder).toHaveBeenCalledWith('/media/season1')
  })

  it('resolves an empty array when the directory dialog is cancelled', async () => {
    const showOpenDialog = vi
      .fn<ShowOpenDialog>()
      .mockResolvedValue({ canceled: true, filePaths: [] })
    const service = createMediaService({
      ffprobePath: 'ffprobe',
      ffmpegPath: 'ffmpeg',
      tmpDir: '/tmp',
      showOpenDialog
    })

    await expect(service.openFolder()).resolves.toEqual([])
  })
})

describe('createMediaService readPlaylist', () => {
  it('reads the file text and parses it into absolute paths', async () => {
    const readPlaylistTextImpl = vi
      .fn<ReadPlaylistText>()
      .mockResolvedValue('#EXTM3U\n/media/a.mkv\nb.mkv\n')
    const service = createMediaService({
      ffprobePath: 'ffprobe',
      ffmpegPath: 'ffmpeg',
      tmpDir: '/tmp',
      readPlaylistTextImpl
    })

    await expect(service.readPlaylist('/media/list.m3u')).resolves.toEqual([
      join('/media', 'a.mkv'),
      join('/media', 'b.mkv')
    ])
    expect(readPlaylistTextImpl).toHaveBeenCalledWith('/media/list.m3u')
  })

  it('skips comment/directive and blank lines', async () => {
    const readPlaylistTextImpl = vi
      .fn<ReadPlaylistText>()
      .mockResolvedValue('#EXTM3U\n#EXTINF:120,Title\n/media/a.mkv\n\n')
    const service = createMediaService({
      ffprobePath: 'ffprobe',
      ffmpegPath: 'ffmpeg',
      tmpDir: '/tmp',
      readPlaylistTextImpl
    })

    await expect(service.readPlaylist('/media/list.m3u')).resolves.toEqual([
      join('/media', 'a.mkv')
    ])
  })
})

describe('createMediaService savePlaylist', () => {
  it('writes serialized M3U to the chosen path and returns it', async () => {
    const paths = ['/media/a.mkv', '/media/b.mkv']
    const showSaveDialog = vi
      .fn<ShowSaveDialog>()
      .mockResolvedValue({ canceled: false, filePath: '/out/list.m3u' })
    const writePlaylistTextImpl = vi.fn<WritePlaylistText>().mockResolvedValue()
    const service = createMediaService({
      ffprobePath: 'ffprobe',
      ffmpegPath: 'ffmpeg',
      tmpDir: '/tmp',
      showSaveDialog,
      writePlaylistTextImpl
    })

    await expect(service.savePlaylist(paths)).resolves.toBe('/out/list.m3u')
    expect(writePlaylistTextImpl).toHaveBeenCalledWith(
      '/out/list.m3u',
      '#EXTM3U\n/media/a.mkv\n/media/b.mkv\n'
    )
  })

  it('writes nothing and returns undefined when the save dialog is cancelled', async () => {
    const showSaveDialog = vi.fn<ShowSaveDialog>().mockResolvedValue({ canceled: true })
    const writePlaylistTextImpl = vi.fn<WritePlaylistText>().mockResolvedValue()
    const service = createMediaService({
      ffprobePath: 'ffprobe',
      ffmpegPath: 'ffmpeg',
      tmpDir: '/tmp',
      showSaveDialog,
      writePlaylistTextImpl
    })

    await expect(service.savePlaylist(['/media/a.mkv'])).resolves.toBeUndefined()
    expect(writePlaylistTextImpl).not.toHaveBeenCalled()
  })
})

describe('createMediaService getChapters', () => {
  it('enumerates chapters through the injected ffprobe exec', async () => {
    const execFfprobeImpl = vi.fn().mockResolvedValue(
      JSON.stringify({
        chapters: [{ start_time: '1.5', end_time: '9.25', tags: { title: 'Opening' } }]
      })
    )
    const service = createMediaService({
      ffprobePath: 'ffprobe-bin',
      ffmpegPath: 'ffmpeg',
      tmpDir: '/tmp',
      execFfprobeImpl
    })

    await expect(service.getChapters('/video/episode.mkv')).resolves.toEqual([
      { start: 1.5, end: 9.25, title: 'Opening' }
    ])
    expect(execFfprobeImpl).toHaveBeenCalledWith('ffprobe-bin', [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_chapters',
      '--',
      '/video/episode.mkv'
    ])
  })
})

describe('createMediaService getThumbnail', () => {
  const fakeThumbnailService = (path: string | null) => ({
    getThumbnail: vi.fn(async (_p: string, _t: number, _d: number) => path)
  })

  it('wraps a cached frame path as a base64 data:image/jpeg URL', async () => {
    const thumbnailServiceImpl = fakeThumbnailService('/cache/ab/12.jpg')
    const readThumbnailBase64Impl = vi.fn(async (_p: string) => 'QUJD')
    const service = createMediaService({
      ffprobePath: 'ffprobe',
      ffmpegPath: 'ffmpeg',
      tmpDir: '/tmp',
      thumbnailServiceImpl,
      readThumbnailBase64Impl
    })

    await expect(service.getThumbnail('/video/ep.mkv', 42, 1200)).resolves.toEqual({
      dataUrl: 'data:image/jpeg;base64,QUJD'
    })
    expect(thumbnailServiceImpl.getThumbnail).toHaveBeenCalledWith('/video/ep.mkv', 42, 1200)
    expect(readThumbnailBase64Impl).toHaveBeenCalledWith('/cache/ab/12.jpg')
  })

  it('returns null (and never reads a file) when the service has no thumbnail', async () => {
    const thumbnailServiceImpl = fakeThumbnailService(null)
    const readThumbnailBase64Impl = vi.fn(async (_p: string) => 'QUJD')
    const service = createMediaService({
      ffprobePath: 'ffprobe',
      ffmpegPath: 'ffmpeg',
      tmpDir: '/tmp',
      thumbnailServiceImpl,
      readThumbnailBase64Impl
    })

    await expect(service.getThumbnail('/video/ep.mkv', 3, 0.5)).resolves.toBeNull()
    expect(readThumbnailBase64Impl).not.toHaveBeenCalled()
  })

  it('resolves null when no thumbnail cache dir is configured', async () => {
    const service = createMediaService({
      ffprobePath: 'ffprobe',
      ffmpegPath: 'ffmpeg',
      tmpDir: '/tmp'
    })
    await expect(service.getThumbnail('/video/ep.mkv', 42, 1200)).resolves.toBeNull()
  })
})
