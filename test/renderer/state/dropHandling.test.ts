// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'
import { handleDroppedFiles } from '@src/renderer/src/state/dropHandling'

function makeDeps(overrides: Partial<Parameters<typeof handleDroppedFiles>[1]> = {}): Parameters<
  typeof handleDroppedFiles
>[1] & {
  pathForFile: ReturnType<typeof vi.fn>
  openPath: ReturnType<typeof vi.fn>
  loadSubtitle: ReturnType<typeof vi.fn>
  appendPlaylistFile: ReturnType<typeof vi.fn>
  reportError: ReturnType<typeof vi.fn>
} {
  const deps = {
    hasVideo: true,
    currentFilePath: () => 'E:\\anime\\episode.mkv',
    pathForFile: vi.fn((file: File) => `E:\\anime\\${file.name}`),
    openPath: vi.fn(async (path: string) => ({
      status: 'opened' as const,
      filePath: path,
      warnings: []
    })),
    loadSubtitle: vi.fn().mockResolvedValue(undefined),
    appendPlaylistFile: vi.fn().mockResolvedValue({ status: 'added', count: 1 }),
    reportError: vi.fn(),
    ...overrides
  }
  return deps as Parameters<typeof handleDroppedFiles>[1] & {
    pathForFile: ReturnType<typeof vi.fn>
    openPath: ReturnType<typeof vi.fn>
    loadSubtitle: ReturnType<typeof vi.fn>
    appendPlaylistFile: ReturnType<typeof vi.fn>
    reportError: ReturnType<typeof vi.fn>
  }
}

describe('handleDroppedFiles', () => {
  it('opens a dropped video using its real filesystem path', async () => {
    const deps = makeDeps({ hasVideo: false })
    await handleDroppedFiles([new File([], 'episode 01.MKV')], deps)
    expect(deps.openPath).toHaveBeenCalledWith('E:\\anime\\episode 01.MKV')
  })

  it('opens a video before attaching its matching sidecar', async () => {
    const deps = makeDeps()
    await handleDroppedFiles([new File([], 'episode.srt'), new File([], 'episode.mkv')], deps)
    expect(deps.loadSubtitle).toHaveBeenCalledWith(
      'E:\\anime\\episode.mkv',
      'E:\\anime\\episode.srt'
    )
    expect(deps.openPath.mock.invocationCallOrder[0]).toBeLessThan(
      deps.loadSubtitle.mock.invocationCallOrder[0]
    )
  })

  it('does not attach a sidecar when the open fails or another file wins', async () => {
    const failed = makeDeps({
      openPath: vi.fn().mockResolvedValue({
        status: 'failed',
        filePath: 'E:\\anime\\episode.mkv',
        message: 'nope'
      })
    })
    await handleDroppedFiles([new File([], 'episode.mkv'), new File([], 'episode.srt')], failed)
    expect(failed.loadSubtitle).not.toHaveBeenCalled()

    const stale = makeDeps({ currentFilePath: () => 'E:\\anime\\other.mkv' })
    await handleDroppedFiles([new File([], 'episode.mkv'), new File([], 'episode.srt')], stale)
    expect(stale.loadSubtitle).not.toHaveBeenCalled()
  })

  it('attaches a subtitle to the current video and surfaces warnings', async () => {
    const deps = makeDeps({
      loadSubtitle: vi.fn().mockResolvedValue('No subtitles found in this file.')
    })
    await handleDroppedFiles([new File([], 'episode.ass')], deps)
    expect(deps.loadSubtitle).toHaveBeenCalledWith(
      'E:\\anime\\episode.mkv',
      'E:\\anime\\episode.ass'
    )
    expect(deps.reportError).toHaveBeenCalledWith('No subtitles found in this file.')
  })

  it('requires an open video for a lone subtitle', async () => {
    const deps = makeDeps({ hasVideo: false })
    await handleDroppedFiles([new File([], 'episode.srt')], deps)
    expect(deps.loadSubtitle).not.toHaveBeenCalled()
    expect(deps.reportError).toHaveBeenCalledWith('Open a video before adding a subtitle file.')
  })

  it('appends playlist files and reports empty or unreadable ones', async () => {
    const appended = makeDeps({
      appendPlaylistFile: vi.fn().mockResolvedValue({ status: 'added', count: 3 })
    })
    await handleDroppedFiles([new File([], 'queue.m3u')], appended)
    expect(appended.appendPlaylistFile).toHaveBeenCalledWith('E:\\anime\\queue.m3u')

    const empty = makeDeps({ appendPlaylistFile: vi.fn().mockResolvedValue({ status: 'empty' }) })
    await handleDroppedFiles([new File([], 'queue.m3u8')], empty)
    expect(empty.reportError).toHaveBeenCalledWith('Playlist is empty.')

    const unreadable = makeDeps({
      appendPlaylistFile: vi.fn().mockResolvedValue({ status: 'unreadable' })
    })
    await handleDroppedFiles([new File([], 'queue.m3u8')], unreadable)
    expect(unreadable.reportError).toHaveBeenCalledWith('Could not read the playlist.')

    const rejected = makeDeps({
      appendPlaylistFile: vi.fn().mockRejectedValue(new Error('load failed'))
    })
    await handleDroppedFiles([new File([], 'queue.m3u8')], rejected)
    expect(rejected.reportError).toHaveBeenCalledWith('Could not read the playlist.')
  })

  it('reports unsupported files but silently ignores drags without files', async () => {
    const unsupported = makeDeps()
    await handleDroppedFiles([new File([], 'notes.txt')], unsupported)
    expect(unsupported.reportError).toHaveBeenCalledWith('Unsupported file type.')
    expect(unsupported.pathForFile).not.toHaveBeenCalled()

    const empty = makeDeps()
    await handleDroppedFiles([], empty)
    expect(empty.reportError).not.toHaveBeenCalled()
  })
})
