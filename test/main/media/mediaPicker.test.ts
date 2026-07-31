import { describe, it, expect, vi } from 'vitest'
import { dirname, join } from 'node:path'
import {
  createMediaPicker,
  type MediaPickerDeps,
  type ReadPlaylistText,
  type ShowOpenDialog,
  type ShowSaveDialog,
  type WritePlaylistText
} from '@src/main/media/mediaPicker'

/** Builds a picker whose unused boundaries reject loudly, so each test's
 * assertions cover exactly the seam it exercises. */
function createPicker(overrides: Partial<MediaPickerDeps> = {}) {
  const history = {
    getLastOpenFolder: vi.fn<() => string | undefined>(() => undefined),
    setLastOpenFolder: vi.fn()
  }
  const deps: MediaPickerDeps = {
    showOpenDialog: vi.fn<ShowOpenDialog>(async () => ({ canceled: true, filePaths: [] })),
    showSaveDialog: vi.fn<ShowSaveDialog>(async () => ({ canceled: true })),
    readPlaylistText: vi.fn<ReadPlaylistText>(async () => ''),
    writePlaylistText: vi.fn<WritePlaylistText>(async () => {}),
    listVideosIn: vi.fn(async () => []),
    mediaHistory: history,
    ...overrides
  }
  return { picker: createMediaPicker(deps), history, deps }
}

/** The single-select variant used by openFile/openSubtitleFile helpers below. */
function pickerWithDialog(showOpenDialog: ShowOpenDialog, lastOpenFolder?: string) {
  const history = {
    getLastOpenFolder: vi.fn<() => string | undefined>(() => lastOpenFolder),
    setLastOpenFolder: vi.fn()
  }
  const { picker } = createPicker({ showOpenDialog, mediaHistory: history })
  return { picker, history }
}

const videoDialogOptions = {
  properties: ['openFile'],
  filters: [{ name: 'Media', extensions: ['mkv', 'mp4', 'webm', 'avi', 'mov', 'm3u', 'm3u8'] }]
}

describe('createMediaPicker openFile', () => {
  it('uses the saved folder as the dialog default and persists the selected file folder', async () => {
    const selectedPath = join('/media', 'series', 'episode.mkv')
    const showOpenDialog = vi
      .fn<ShowOpenDialog>()
      .mockResolvedValue({ canceled: false, filePaths: [selectedPath] })
    const { picker, history } = pickerWithDialog(showOpenDialog, join('/media', 'series'))

    await expect(picker.openFile()).resolves.toBe(selectedPath)
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
    const { picker, history } = pickerWithDialog(showOpenDialog, '/media/series')

    await expect(picker.openFile()).resolves.toBeUndefined()
    expect(history.setLastOpenFolder).not.toHaveBeenCalled()
  })

  it('retries exactly once without a stale default folder after the first dialog failure', async () => {
    const selectedPath = '/new-media/episode.mkv'
    const showOpenDialog = vi
      .fn<ShowOpenDialog>()
      .mockRejectedValueOnce(new Error('stale folder'))
      .mockResolvedValueOnce({ canceled: false, filePaths: [selectedPath] })
    const { picker, history } = pickerWithDialog(showOpenDialog, '/stale-folder')

    await expect(picker.openFile()).resolves.toBe(selectedPath)
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
    const { picker, history } = pickerWithDialog(showOpenDialog, '/stale-folder')

    await expect(picker.openFile()).rejects.toThrow('dialog unavailable')
    expect(showOpenDialog).toHaveBeenCalledTimes(2)
    expect(history.setLastOpenFolder).not.toHaveBeenCalled()
  })

  it('propagates the first failure when there was no default folder to drop', async () => {
    const showOpenDialog = vi
      .fn<ShowOpenDialog>()
      .mockRejectedValue(new Error('dialog unavailable'))
    const { picker } = pickerWithDialog(showOpenDialog)

    await expect(picker.openFile()).rejects.toThrow('dialog unavailable')
    expect(showOpenDialog).toHaveBeenCalledTimes(1)
  })
})

const subtitleDialogOptions = {
  properties: ['openFile'],
  filters: [{ name: 'Subtitles', extensions: ['srt', 'ass', 'ssa'] }]
}

describe('createMediaPicker openSubtitleFile', () => {
  it('filters the dialog to subtitle files and defaults to the last open folder', async () => {
    const selectedPath = join('/media', 'series', 'episode.srt')
    const showOpenDialog = vi
      .fn<ShowOpenDialog>()
      .mockResolvedValue({ canceled: false, filePaths: [selectedPath] })
    const { picker } = pickerWithDialog(showOpenDialog, join('/media', 'series'))

    await expect(picker.openSubtitleFile()).resolves.toBe(selectedPath)
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
    const { picker, history } = pickerWithDialog(showOpenDialog, join('/media', 'series'))

    await expect(picker.openSubtitleFile()).resolves.toBe(selectedPath)
    expect(history.setLastOpenFolder).not.toHaveBeenCalled()
  })

  it('resolves undefined when the dialog is cancelled', async () => {
    const showOpenDialog = vi
      .fn<ShowOpenDialog>()
      .mockResolvedValue({ canceled: true, filePaths: [] })
    const { picker } = pickerWithDialog(showOpenDialog, '/media/series')

    await expect(picker.openSubtitleFile()).resolves.toBeUndefined()
  })

  it('retries once without a stale default folder after the first dialog failure', async () => {
    const selectedPath = '/subs/episode.srt'
    const showOpenDialog = vi
      .fn<ShowOpenDialog>()
      .mockRejectedValueOnce(new Error('stale folder'))
      .mockResolvedValueOnce({ canceled: false, filePaths: [selectedPath] })
    const { picker } = pickerWithDialog(showOpenDialog, '/stale-folder')

    await expect(picker.openSubtitleFile()).resolves.toBe(selectedPath)
    expect(showOpenDialog).toHaveBeenNthCalledWith(1, {
      ...subtitleDialogOptions,
      defaultPath: '/stale-folder'
    })
    expect(showOpenDialog).toHaveBeenNthCalledWith(2, subtitleDialogOptions)
    expect(showOpenDialog).toHaveBeenCalledTimes(2)
  })
})

const multiFileDialogOptions = {
  properties: ['openFile', 'multiSelections'],
  filters: [{ name: 'Media', extensions: ['mkv', 'mp4', 'webm', 'avi', 'mov', 'm3u', 'm3u8'] }]
}

describe('createMediaPicker openFiles', () => {
  it('multi-selects and persists the folder of the first pick', async () => {
    const picks = [join('/media', 'series', 'ep1.mkv'), join('/media', 'series', 'ep2.mkv')]
    const showOpenDialog = vi
      .fn<ShowOpenDialog>()
      .mockResolvedValue({ canceled: false, filePaths: picks })
    const { picker, history } = pickerWithDialog(showOpenDialog, join('/media', 'series'))

    await expect(picker.openFiles()).resolves.toEqual(picks)
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
    const { picker, history } = pickerWithDialog(showOpenDialog, '/media/series')

    await expect(picker.openFiles()).resolves.toEqual([])
    expect(history.setLastOpenFolder).not.toHaveBeenCalled()
  })

  it('retries once without a stale default folder after a first dialog failure', async () => {
    const picks = ['/new-media/ep1.mkv']
    const showOpenDialog = vi
      .fn<ShowOpenDialog>()
      .mockRejectedValueOnce(new Error('stale folder'))
      .mockResolvedValueOnce({ canceled: false, filePaths: picks })
    const { picker } = pickerWithDialog(showOpenDialog, '/stale-folder')

    await expect(picker.openFiles()).resolves.toEqual(picks)
    expect(showOpenDialog).toHaveBeenNthCalledWith(1, {
      ...multiFileDialogOptions,
      defaultPath: '/stale-folder'
    })
    expect(showOpenDialog).toHaveBeenNthCalledWith(2, multiFileDialogOptions)
  })
})

describe('createMediaPicker openFolder', () => {
  it('lists the chosen folder’s videos through the injected lister and remembers the folder', async () => {
    const showOpenDialog = vi
      .fn<ShowOpenDialog>()
      .mockResolvedValue({ canceled: false, filePaths: ['/media/season1'] })
    const listVideosIn = vi.fn(async (folder: string) => [join(folder, 'ep2.mkv')])
    const { picker, history } = createPicker({ showOpenDialog, listVideosIn })

    await expect(picker.openFolder()).resolves.toEqual([join('/media/season1', 'ep2.mkv')])
    expect(showOpenDialog).toHaveBeenCalledWith({ properties: ['openDirectory'] })
    expect(listVideosIn).toHaveBeenCalledWith('/media/season1')
    expect(history.setLastOpenFolder).toHaveBeenCalledWith('/media/season1')
  })

  it('resolves an empty array when the directory dialog is cancelled', async () => {
    const showOpenDialog = vi
      .fn<ShowOpenDialog>()
      .mockResolvedValue({ canceled: true, filePaths: [] })
    const listVideosIn = vi.fn(async () => ['/never.mkv'])
    const { picker } = createPicker({ showOpenDialog, listVideosIn })

    await expect(picker.openFolder()).resolves.toEqual([])
    expect(listVideosIn).not.toHaveBeenCalled()
  })

  it('retries once without a stale default folder after the first dialog failure', async () => {
    const showOpenDialog = vi
      .fn<ShowOpenDialog>()
      .mockRejectedValueOnce(new Error('stale folder'))
      .mockResolvedValueOnce({ canceled: false, filePaths: ['/new-media'] })
    const history = {
      getLastOpenFolder: vi.fn<() => string | undefined>(() => '/stale-folder'),
      setLastOpenFolder: vi.fn()
    }
    const { picker } = createPicker({ showOpenDialog, mediaHistory: history })

    await expect(picker.openFolder()).resolves.toEqual([])
    expect(showOpenDialog).toHaveBeenNthCalledWith(1, {
      properties: ['openDirectory'],
      defaultPath: '/stale-folder'
    })
    expect(showOpenDialog).toHaveBeenNthCalledWith(2, { properties: ['openDirectory'] })
  })
})

describe('createMediaPicker readPlaylist', () => {
  it('reads the file text and parses it into absolute paths', async () => {
    const readPlaylistText = vi
      .fn<ReadPlaylistText>()
      .mockResolvedValue('#EXTM3U\n/media/a.mkv\nb.mkv\n')
    const { picker } = createPicker({ readPlaylistText })

    await expect(picker.readPlaylist('/media/list.m3u')).resolves.toEqual([
      join('/media', 'a.mkv'),
      join('/media', 'b.mkv')
    ])
    expect(readPlaylistText).toHaveBeenCalledWith('/media/list.m3u')
  })

  it('skips comment/directive and blank lines', async () => {
    const readPlaylistText = vi
      .fn<ReadPlaylistText>()
      .mockResolvedValue('#EXTM3U\n#EXTINF:120,Title\n/media/a.mkv\n\n')
    const { picker } = createPicker({ readPlaylistText })

    await expect(picker.readPlaylist('/media/list.m3u')).resolves.toEqual([join('/media', 'a.mkv')])
  })
})

describe('createMediaPicker savePlaylist', () => {
  it('writes serialized M3U to the chosen path and returns it', async () => {
    const paths = ['/media/a.mkv', '/media/b.mkv']
    const showSaveDialog = vi
      .fn<ShowSaveDialog>()
      .mockResolvedValue({ canceled: false, filePath: '/out/list.m3u' })
    const writePlaylistText = vi.fn<WritePlaylistText>().mockResolvedValue()
    const { picker } = createPicker({ showSaveDialog, writePlaylistText })

    await expect(picker.savePlaylist(paths)).resolves.toBe('/out/list.m3u')
    expect(writePlaylistText).toHaveBeenCalledWith(
      '/out/list.m3u',
      '#EXTM3U\n/media/a.mkv\n/media/b.mkv\n'
    )
  })

  it('defaults the save dialog to playlist.m3u inside the last open folder', async () => {
    const showSaveDialog = vi.fn<ShowSaveDialog>().mockResolvedValue({ canceled: true })
    const history = {
      getLastOpenFolder: vi.fn<() => string | undefined>(() => join('/media', 'series')),
      setLastOpenFolder: vi.fn()
    }
    const { picker } = createPicker({ showSaveDialog, mediaHistory: history })

    await picker.savePlaylist(['/media/a.mkv'])
    expect(showSaveDialog).toHaveBeenCalledWith({
      defaultPath: join('/media', 'series', 'playlist.m3u'),
      filters: [{ name: 'Playlist', extensions: ['m3u', 'm3u8'] }]
    })
  })

  it('writes nothing and returns undefined when the save dialog is cancelled', async () => {
    const showSaveDialog = vi.fn<ShowSaveDialog>().mockResolvedValue({ canceled: true })
    const writePlaylistText = vi.fn<WritePlaylistText>().mockResolvedValue()
    const { picker } = createPicker({ showSaveDialog, writePlaylistText })

    await expect(picker.savePlaylist(['/media/a.mkv'])).resolves.toBeUndefined()
    expect(writePlaylistText).not.toHaveBeenCalled()
  })
})
