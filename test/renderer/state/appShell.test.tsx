import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import App from '@src/renderer/src/App'
import {
  applyOffsetToFolder,
  buildPlayerAdapter,
  copySidebarCue,
  appClassName,
  handleDroppedFiles,
  appendPathsToPlaylist,
  appendPlaylistFile,
  loadSubtitleFromPicker,
  loadChaptersForCurrentFile,
  registerLaunchOpenHandler,
  shouldOpenWordPopup,
  shouldClosePopupOnPointerDown,
  type LaunchOpenSessionDeps,
  toggleFromRightClick,
  toggleSidebar,
  videoScaleWindowSize,
  videoContentBaseline,
  sidebarPreservingWindowSize,
  type DropHandlerDeps,
  type PlayerBridgePlayer,
  type SubtitleOffsetRefs,
  type SubtitlePickerSessionDeps
} from '@src/renderer/src/state/appShell'
import {
  createRecentFilesController,
  type RecentFilesBridge
} from '@src/renderer/src/state/recentFilesController'
import { appTitle } from '@src/shared/appInfo'
import type { OpenMediaResult } from '@src/renderer/src/state/playerActions'
import type { PlayerAction } from '@src/renderer/src/state/playerState'
import type { Cue } from '@src/shared/cue'
import type { Track } from '@src/shared/track'
import type { Chapter } from '@src/shared/chapter'

function deferred<T>(): {
  promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

// SSR-only render (no jsdom, no testing-library) per AGENTS.md testing policy.
describe('App', () => {
  it('renders the app title', () => {
    const html = renderToStaticMarkup(<App />)
    expect(html).toContain(appTitle('0.0.1'))
  })

  it('SSR-renders the full player shell without touching window', () => {
    // No global `window.kizuna` is defined in this Node test environment;
    // if the render path touched it, this would throw.
    expect(() => renderToStaticMarkup(<App />)).not.toThrow()

    const html = renderToStaticMarkup(<App />)
    expect(html).toContain('aria-label="Open file"')
    expect(html).toContain('id="subtitle"')
  })

  it('wraps #content in #player-area, with the sidebar closed by default', () => {
    const html = renderToStaticMarkup(<App />)
    expect(html).toMatch(/id="player-area"[^>]*>.*id="content"/s)
    expect(html).not.toContain('id="subtitle-sidebar"')
  })

  it("renders the Media menu's recent-files section, empty by default, with no error banner", () => {
    const html = renderToStaticMarkup(<App />)
    expect(html).toContain('Recent files')
    expect(html).toContain('No recent files')
    expect(html).not.toContain('id="media-error"')
  })
})

describe('loadChaptersForCurrentFile', () => {
  it('dispatches chapters only while the requested file is still current', async () => {
    const chapters = deferred<Chapter[]>()
    const media = { getChapters: vi.fn(() => chapters.promise) }
    const dispatch = vi.fn()
    let current = true

    const pending = loadChaptersForCurrentFile(media, '/old.mkv', () => current, dispatch)
    current = false
    chapters.resolve([{ start: 10, end: 20, title: 'Old file chapter' }])
    await pending

    expect(media.getChapters).toHaveBeenCalledWith('/old.mkv')
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('silently ignores optional chapter probe failures', async () => {
    const media = {
      getChapters: vi.fn(async () => {
        throw new Error('ffprobe failed')
      })
    }
    const dispatch = vi.fn()

    await expect(
      loadChaptersForCurrentFile(media, '/file.mkv', () => true, dispatch)
    ).resolves.toBeUndefined()

    expect(dispatch).not.toHaveBeenCalled()
  })
})

describe('registerLaunchOpenHandler', () => {
  function makeBridge(): {
    bridge: LaunchOpenSessionDeps['bridge']
    onOpenPath: ReturnType<typeof vi.fn>
    rendererReady: ReturnType<typeof vi.fn>
    pushOpenPath: (path: string) => void
    pushError: (message: string) => void
  } {
    const pathCallbacks: Array<(path: string) => void> = []
    const errorCallbacks: Array<(message: string) => void> = []
    const onOpenPath = vi.fn((cb: (path: string) => void) => {
      pathCallbacks.push(cb)
      return vi.fn()
    })
    const rendererReady = vi.fn()
    const bridge = {
      launch: {
        onOpenPath,
        onError: vi.fn((cb: (message: string) => void) => {
          errorCallbacks.push(cb)
          return vi.fn()
        }),
        rendererReady
      }
    } as unknown as LaunchOpenSessionDeps['bridge']
    return {
      bridge,
      onOpenPath,
      rendererReady,
      pushOpenPath: (path) => pathCallbacks[0](path),
      pushError: (message) => errorCallbacks[0](message)
    }
  }

  it('subscribes before signalling ready and routes a pushed path through the shared openPath closure', () => {
    const { bridge, onOpenPath, rendererReady, pushOpenPath } = makeBridge()
    const openPath = vi.fn().mockResolvedValue({ status: 'opened' })
    const reportError = vi.fn()

    registerLaunchOpenHandler({ bridge, openPath, reportError })
    pushOpenPath(String.raw`E:\anime\episode.mkv`)

    expect(onOpenPath.mock.invocationCallOrder[0]).toBeLessThan(
      rendererReady.mock.invocationCallOrder[0]
    )
    expect(openPath).toHaveBeenCalledWith(String.raw`E:\anime\episode.mkv`)
  })

  it('surfaces a launch error through the injected reportError', () => {
    const { bridge, pushError } = makeBridge()
    const reportError = vi.fn()

    registerLaunchOpenHandler({ bridge, openPath: vi.fn(), reportError })
    pushError('Playback engine failed to start; the file could not be opened.')

    expect(reportError).toHaveBeenCalledWith(
      'Playback engine failed to start; the file could not be opened.'
    )
  })
})

describe('buildPlayerAdapter', () => {
  function makeFakePlayer(): PlayerBridgePlayer & {
    setPause: ReturnType<typeof vi.fn>
    seek: ReturnType<typeof vi.fn>
    setVolume: ReturnType<typeof vi.fn>
    setSpeed: ReturnType<typeof vi.fn>
    setMuted: ReturnType<typeof vi.fn>
  } {
    return {
      setPause: vi.fn(async () => undefined),
      seek: vi.fn(async () => undefined),
      setVolume: vi.fn(async () => undefined),
      setSpeed: vi.fn(async () => undefined),
      setMuted: vi.fn(async () => undefined)
    }
  }

  it('does not call resolvePlayer until a method fires', () => {
    const resolvePlayer = vi.fn(() => makeFakePlayer())
    buildPlayerAdapter(vi.fn(), resolvePlayer)
    expect(resolvePlayer).not.toHaveBeenCalled()
  })

  it('setPause calls player.setPause and dispatches setPaused', async () => {
    const fakePlayer = makeFakePlayer()
    const dispatch = vi.fn<(action: PlayerAction) => void>()
    const adapter = buildPlayerAdapter(dispatch, () => fakePlayer)

    await adapter.setPause(true)

    expect(fakePlayer.setPause).toHaveBeenCalledWith(true)
    expect(dispatch).toHaveBeenCalledWith({ type: 'setPaused', value: true })
  })

  it('setVolume calls player.setVolume and dispatches setVolume', async () => {
    const fakePlayer = makeFakePlayer()
    const dispatch = vi.fn<(action: PlayerAction) => void>()
    const adapter = buildPlayerAdapter(dispatch, () => fakePlayer)

    await adapter.setVolume(42)

    expect(fakePlayer.setVolume).toHaveBeenCalledWith(42)
    expect(dispatch).toHaveBeenCalledWith({ type: 'setVolume', value: 42 })
  })

  it('setSpeed clamps, calls player.setSpeed, and dispatches setSpeed', async () => {
    const fakePlayer = makeFakePlayer()
    const dispatch = vi.fn<(action: PlayerAction) => void>()
    const adapter = buildPlayerAdapter(dispatch, () => fakePlayer)

    await adapter.setSpeed(4)

    expect(fakePlayer.setSpeed).toHaveBeenCalledWith(3)
    expect(dispatch).toHaveBeenCalledWith({ type: 'setSpeed', value: 3 })
  })

  it('seek calls player.seek with the absolute flag and does not dispatch', async () => {
    const fakePlayer = makeFakePlayer()
    const dispatch = vi.fn<(action: PlayerAction) => void>()
    const adapter = buildPlayerAdapter(dispatch, () => fakePlayer)

    await adapter.seek(10, true)

    expect(fakePlayer.seek).toHaveBeenCalledWith(10, true)
    expect(dispatch).not.toHaveBeenCalled()
  })

  it('setMuted calls player.setMuted and dispatches setMuted', async () => {
    const fakePlayer = makeFakePlayer()
    const dispatch = vi.fn<(action: PlayerAction) => void>()
    const adapter = buildPlayerAdapter(dispatch, () => fakePlayer)

    await adapter.setMuted(true)

    expect(fakePlayer.setMuted).toHaveBeenCalledWith(true)
    expect(dispatch).toHaveBeenCalledWith({ type: 'setMuted', value: true })
  })
})

describe('copySidebarCue', () => {
  it('passes the raw multi-line cue text to the clipboard writer unchanged', async () => {
    const writeText = vi.fn(async () => undefined)
    const cue: Cue = { start: 1, end: 3, text: 'First line, exactly.\nSecond line!' }

    await copySidebarCue(writeText, cue)

    expect(writeText).toHaveBeenCalledWith('First line, exactly.\nSecond line!')
  })
})

describe('toggleFromRightClick', () => {
  it('does nothing when the setting is disabled', () => {
    const setPause = vi.fn()
    toggleFromRightClick(false, false, setPause)
    expect(setPause).not.toHaveBeenCalled()
  })

  it('pauses a playing video when enabled', () => {
    const setPause = vi.fn()
    toggleFromRightClick(true, false, setPause)
    expect(setPause).toHaveBeenCalledWith(true)
  })

  it('resumes a paused video when enabled', () => {
    const setPause = vi.fn()
    toggleFromRightClick(true, true, setPause)
    expect(setPause).toHaveBeenCalledWith(false)
  })
})

describe('toggleSidebar', () => {
  it('opens a closed sidebar and persists sidebarOpen: true', () => {
    const setOpen = vi.fn()
    const persist = vi.fn()

    toggleSidebar(false, setOpen, persist)

    expect(setOpen).toHaveBeenCalledWith(true)
    expect(persist).toHaveBeenCalledWith({ sidebarOpen: true })
  })

  it('closes an open sidebar and persists sidebarOpen: false', () => {
    const setOpen = vi.fn()
    const persist = vi.fn()

    toggleSidebar(true, setOpen, persist)

    expect(setOpen).toHaveBeenCalledWith(false)
    expect(persist).toHaveBeenCalledWith({ sidebarOpen: false })
  })
})

describe('applyOffsetToFolder', () => {
  function makeRefs(
    subtitleOffsets: Record<string, number>,
    folderSubtitleOffsets: Record<string, number>
  ): SubtitleOffsetRefs {
    return {
      subtitleOffsets: { current: subtitleOffsets },
      folderSubtitleOffsets: { current: folderSubtitleOffsets }
    }
  }

  it('persists both maps in one patch and mirrors them into the refs', () => {
    const refs = makeRefs({ '/videos/a.mkv': 250, '/videos/b.mkv': -100 }, {})
    const persist = vi.fn()

    applyOffsetToFolder(refs, '/videos/a.mkv', 300, persist)

    // One atomic patch: the folder default plus the per-file entries it supersedes.
    expect(persist).toHaveBeenCalledTimes(1)
    expect(persist).toHaveBeenCalledWith({
      subtitleOffsets: {},
      folderSubtitleOffsets: { '/videos': 300 }
    })
    expect(refs.subtitleOffsets.current).toEqual({})
    expect(refs.folderSubtitleOffsets.current).toEqual({ '/videos': 300 })
  })

  it('leaves other folders alone', () => {
    const refs = makeRefs({ '/other/c.mkv': 500 }, { '/other': 50 })
    const persist = vi.fn()

    applyOffsetToFolder(refs, '/videos/a.mkv', 300, persist)

    expect(refs.subtitleOffsets.current).toEqual({ '/other/c.mkv': 500 })
    expect(refs.folderSubtitleOffsets.current).toEqual({ '/other': 50, '/videos': 300 })
  })
})

describe('videoScaleWindowSize', () => {
  const screenSize = { width: 1920, height: 1080 }

  it('returns undefined when video dimensions are not known', () => {
    expect(videoScaleWindowSize(undefined, 1, 32, 48, screenSize)).toBeUndefined()
  })

  it('computes the scaled+bar-adjusted size for a known video', () => {
    expect(videoScaleWindowSize({ width: 640, height: 360 }, 1, 32, 48, screenSize)).toEqual({
      width: 640,
      height: 360 + 32 + 48
    })
  })

  it('clamps an oversized result to the given screen size', () => {
    const result = videoScaleWindowSize({ width: 1920, height: 1080 }, 2, 0, 0, screenSize)
    expect(result).toEqual({ width: 1920, height: 1080 })
  })

  it('forwards the open side panels widths into the target width', () => {
    expect(
      videoScaleWindowSize({ width: 640, height: 360 }, 1, 32, 48, screenSize, 300, 340)
    ).toEqual({ width: 640 + 300 + 340, height: 360 + 32 + 48 })
  })

  it('still clamps once the sidebar widths push the size past the screen', () => {
    const result = videoScaleWindowSize({ width: 1600, height: 900 }, 1, 0, 0, screenSize, 200, 200)
    // 2000x900 does not fit 1920 wide: scaled by 1920/2000 = 0.96.
    expect(result).toEqual({ width: 1920, height: 864 })
  })
})

describe('videoContentBaseline', () => {
  it('is the whole window when no side panel is open', () => {
    expect(videoContentBaseline({ width: 1280, height: 720 })).toEqual({ width: 1280, height: 720 })
  })

  it('subtracts the panels open at measurement time', () => {
    expect(videoContentBaseline({ width: 1280, height: 720 }, 320, 360)).toEqual({
      width: 600,
      height: 720
    })
  })

  it('floors at zero rather than reporting a negative rectangle', () => {
    expect(videoContentBaseline({ width: 300, height: 720 }, 320, 360)).toEqual({
      width: 0,
      height: 720
    })
  })
})

describe('sidebarPreservingWindowSize', () => {
  const screenSize = { width: 2560, height: 1440 }
  const baseline = { width: 1280, height: 720 }

  it('returns undefined without a measured baseline', () => {
    expect(sidebarPreservingWindowSize(undefined, screenSize, 320)).toBeUndefined()
  })

  it('returns undefined for a degenerate baseline', () => {
    expect(sidebarPreservingWindowSize({ width: 0, height: 720 }, screenSize, 320)).toBeUndefined()
  })

  it('carries the open panels on top of the preserved rectangle', () => {
    expect(sidebarPreservingWindowSize(baseline, screenSize, 320, 360)).toEqual({
      width: 1280 + 320 + 360,
      height: 720
    })
  })

  it('restores the bare baseline once every panel is closed', () => {
    expect(sidebarPreservingWindowSize(baseline, screenSize)).toEqual(baseline)
  })

  it('clamps when the work area cannot pay for the panels', () => {
    // 2920x720 does not fit 2560 wide: scaled by 2560/2920 ≈ 0.8767.
    expect(sidebarPreservingWindowSize({ width: 2560, height: 720 }, screenSize, 360)).toEqual({
      width: 2560,
      height: 631
    })
  })
})

describe('handleDroppedFiles', () => {
  function makeDeps(overrides: Partial<DropHandlerDeps> = {}): DropHandlerDeps & {
    pathForFile: ReturnType<typeof vi.fn>
    openPath: ReturnType<typeof vi.fn>
    loadSubtitle: ReturnType<typeof vi.fn>
    appendPlaylistFile: ReturnType<typeof vi.fn>
    reportError: ReturnType<typeof vi.fn>
  } {
    return {
      hasVideo: true,
      currentFilePath: () => 'E:\\anime\\episode.mkv',
      // Stands in for the preload's webUtils.getPathForFile.
      pathForFile: vi.fn((file: File) => `E:\\anime\\${file.name}`),
      openPath: vi.fn(async (path: string) => ({ status: 'opened', filePath: path, warnings: [] })),
      loadSubtitle: vi.fn(async () => undefined),
      appendPlaylistFile: vi.fn(async () => 1),
      reportError: vi.fn(),
      ...overrides
    } as DropHandlerDeps & {
      pathForFile: ReturnType<typeof vi.fn>
      openPath: ReturnType<typeof vi.fn>
      loadSubtitle: ReturnType<typeof vi.fn>
      appendPlaylistFile: ReturnType<typeof vi.fn>
      reportError: ReturnType<typeof vi.fn>
    }
  }

  it('opens a dropped video by its real filesystem path', async () => {
    const deps = makeDeps({ hasVideo: false })

    await handleDroppedFiles([new File([], 'episode 01.MKV')], deps)

    expect(deps.openPath).toHaveBeenCalledWith('E:\\anime\\episode 01.MKV')
    expect(deps.reportError).not.toHaveBeenCalled()
  })

  it('prefers the video when a video and its subtitle are dropped together', async () => {
    const deps = makeDeps()

    await handleDroppedFiles([new File([], 'episode.srt'), new File([], 'episode.mkv')], deps)

    expect(deps.openPath).toHaveBeenCalledWith('E:\\anime\\episode.mkv')
    expect(deps.loadSubtitle).toHaveBeenCalledWith(
      'E:\\anime\\episode.mkv',
      'E:\\anime\\episode.srt'
    )
    expect(deps.openPath.mock.invocationCallOrder[0]).toBeLessThan(
      deps.loadSubtitle.mock.invocationCallOrder[0]
    )
  })

  it('loads a dropped subtitle onto the current video', async () => {
    const deps = makeDeps()

    await handleDroppedFiles([new File([], 'episode.ass')], deps)

    expect(deps.loadSubtitle).toHaveBeenCalledWith(
      'E:\\anime\\episode.mkv',
      'E:\\anime\\episode.ass'
    )
    expect(deps.openPath).not.toHaveBeenCalled()
    expect(deps.reportError).not.toHaveBeenCalled()
  })

  it('surfaces the load action’s warning for an unreadable subtitle file', async () => {
    const deps = makeDeps({ loadSubtitle: vi.fn(async () => 'No subtitles found in this file.') })

    await handleDroppedFiles([new File([], 'empty.srt')], deps)

    expect(deps.reportError).toHaveBeenCalledWith('No subtitles found in this file.')
  })

  it.each(['failed', 'stale', 'busy', 'cancelled', 'missing'] as const)(
    'does not attach a matching sidecar when opening is %s',
    async (status) => {
      const deps = makeDeps({
        openPath: vi.fn(async () =>
          status === 'failed' || status === 'missing'
            ? { status, filePath: 'E:\\anime\\episode.mkv', message: 'nope' }
            : { status }
        )
      })

      await handleDroppedFiles([new File([], 'episode.mkv'), new File([], 'episode.srt')], deps)

      expect(deps.loadSubtitle).not.toHaveBeenCalled()
    }
  )

  it('surfaces a matching sidecar parse warning without undoing the opened video', async () => {
    const deps = makeDeps({ loadSubtitle: vi.fn(async () => 'No subtitles found in this file.') })

    await handleDroppedFiles([new File([], 'episode.mkv'), new File([], 'episode.srt')], deps)

    expect(deps.openPath).toHaveBeenCalledWith('E:\\anime\\episode.mkv')
    expect(deps.reportError).toHaveBeenCalledWith('No subtitles found in this file.')
  })

  it('ignores a mismatched sidecar', async () => {
    const deps = makeDeps()

    await handleDroppedFiles([new File([], 'episode.mkv'), new File([], 'other.srt')], deps)

    expect(deps.openPath).toHaveBeenCalledWith('E:\\anime\\episode.mkv')
    expect(deps.loadSubtitle).not.toHaveBeenCalled()
  })

  it('does not attach after another video becomes current before the open settles', async () => {
    let currentFilePath = 'E:\\anime\\episode.mkv'
    const deps = makeDeps({
      currentFilePath: () => currentFilePath,
      openPath: vi.fn(async (path: string) => {
        currentFilePath = 'E:\\anime\\other.mkv'
        return { status: 'opened' as const, filePath: path, warnings: [] }
      })
    })

    await handleDroppedFiles([new File([], 'episode.mkv'), new File([], 'episode.srt')], deps)

    expect(deps.loadSubtitle).not.toHaveBeenCalled()
  })

  it('appends a dropped playlist file to the queue by its real path', async () => {
    const deps = makeDeps({ hasVideo: false, appendPlaylistFile: vi.fn(async () => 3) })

    await handleDroppedFiles([new File([], 'queue.m3u')], deps)

    expect(deps.appendPlaylistFile).toHaveBeenCalledWith('E:\\anime\\queue.m3u')
    expect(deps.openPath).not.toHaveBeenCalled()
    expect(deps.reportError).not.toHaveBeenCalled()
  })

  it('reports an empty or unreadable dropped playlist', async () => {
    const deps = makeDeps({ appendPlaylistFile: vi.fn(async () => 0) })

    await handleDroppedFiles([new File([], 'queue.m3u8')], deps)

    expect(deps.appendPlaylistFile).toHaveBeenCalledWith('E:\\anime\\queue.m3u8')
    expect(deps.reportError).toHaveBeenCalledWith('Playlist is empty or unreadable.')
  })

  it('rejects a subtitle dropped with no video open', async () => {
    const deps = makeDeps({ hasVideo: false })

    await handleDroppedFiles([new File([], 'episode.srt')], deps)

    expect(deps.loadSubtitle).not.toHaveBeenCalled()
    expect(deps.reportError).toHaveBeenCalledWith('Open a video before adding a subtitle file.')
  })

  it('reports a file it cannot open, but ignores a drag carrying no files at all', async () => {
    const unsupported = makeDeps()
    await handleDroppedFiles([new File([], 'notes.txt')], unsupported)
    expect(unsupported.reportError).toHaveBeenCalledWith('Unsupported file type.')
    expect(unsupported.pathForFile).not.toHaveBeenCalled()

    // A dragged URL or text selection: nothing to complain about.
    const empty = makeDeps()
    await handleDroppedFiles([], empty)
    expect(empty.reportError).not.toHaveBeenCalled()
  })

  // A5: the drop path holds no `mediaOpening` snapshot of its own — the
  // controller's synchronous guard is the single authority for open exclusion.
  it('lets the controller refuse a second drop made before the first open settles', async () => {
    const audioTrack: Track = { id: 1, kind: 'audio', codec: 'aac' }
    let resolveLoad!: () => void
    const load = new Promise<void>((resolve) => {
      resolveLoad = () => resolve()
    })
    const bridge = {
      media: {
        openFile: vi.fn(),
        enumerateTracks: vi.fn().mockResolvedValue([audioTrack]),
        loadSubtitle: vi.fn().mockResolvedValue([]),
        loadExternalSubtitle: vi.fn().mockResolvedValue([])
      },
      player: {
        load: vi.fn(() => load),
        setAudioTrack: vi.fn().mockResolvedValue(undefined),
        seek: vi.fn().mockResolvedValue(undefined)
      },
      mediaHistory: {
        getPlaybackHistory: vi.fn().mockResolvedValue(undefined),
        setAudioTrack: vi.fn().mockResolvedValue(undefined),
        setSubtitleTrack: vi.fn().mockResolvedValue(undefined),
        getRecentFiles: vi.fn().mockResolvedValue([]),
        clearRecentFiles: vi.fn().mockResolvedValue(undefined),
        checkFileAvailability: vi.fn().mockResolvedValue({ status: 'available' }),
        removeRecentFile: vi.fn().mockResolvedValue([])
      }
    } satisfies RecentFilesBridge

    const controller = createRecentFilesController()
    const dispatch = vi.fn()
    const results: OpenMediaResult[] = []
    const deps = makeDeps({
      hasVideo: false,
      openPath: vi.fn(async (path: string) => {
        const result = await controller.openPath(
          {
            bridge,
            dispatch,
            subtitleToken: { current: 0 },
            cueCache: new Map(),
            fileToken: { current: 0 }
          },
          path
        )
        results.push(result)
        return result
      })
    })

    // Both drops land in one frame: neither promise has settled when the second
    // handler runs, so nothing but the controller's guard can separate them.
    const first = handleDroppedFiles([new File([], 'first.mkv')], deps)
    const second = handleDroppedFiles([new File([], 'second.mkv')], deps)
    await second

    expect(results).toEqual([{ status: 'busy' }])
    expect(deps.reportError).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(bridge.player.load).toHaveBeenCalled())
    expect(bridge.player.load).toHaveBeenCalledTimes(1)
    expect(bridge.player.load).toHaveBeenCalledWith('E:\\anime\\first.mkv')

    resolveLoad()
    await first

    // The refused drop opened nothing, so the first video is the active file and
    // no late completion of the second can replace it.
    expect(results.at(-1)).toMatchObject({ status: 'opened', filePath: 'E:\\anime\\first.mkv' })
    const loaded = dispatch.mock.calls
      .map(([action]) => action as PlayerAction)
      .filter((action) => action.type === 'fileLoaded')
    expect(loaded).toEqual([
      { type: 'fileLoaded', filePath: 'E:\\anime\\first.mkv', tracks: [audioTrack] }
    ])
  })
})

describe('appendPathsToPlaylist / appendPlaylistFile', () => {
  function makeDeps(readPlaylist: (path: string) => Promise<string[]>) {
    const addPaths = vi.fn<(paths: string[]) => Promise<void>>(async () => undefined)
    return { deps: { readPlaylist: vi.fn(readPlaylist), addPaths }, addPaths }
  }

  it('expands playlist paths via readPlaylist and queues plain paths as-is', async () => {
    const { deps, addPaths } = makeDeps(async () => ['E:\\a\\x.mkv', 'E:\\a\\y.mkv'])

    const count = await appendPathsToPlaylist(['E:\\v.mkv', 'E:\\q.m3u'], deps)

    expect(deps.readPlaylist).toHaveBeenCalledWith('E:\\q.m3u')
    expect(addPaths).toHaveBeenCalledWith(['E:\\v.mkv', 'E:\\a\\x.mkv', 'E:\\a\\y.mkv'])
    expect(count).toBe(3)
  })

  it('never reads plain media paths', async () => {
    const { deps, addPaths } = makeDeps(async () => ['unused'])

    const count = await appendPathsToPlaylist(['E:\\v.mkv'], deps)

    expect(deps.readPlaylist).not.toHaveBeenCalled()
    expect(addPaths).toHaveBeenCalledWith(['E:\\v.mkv'])
    expect(count).toBe(1)
  })

  it('appendPlaylistFile drives readPlaylist → addPaths and returns the entry count', async () => {
    const { deps, addPaths } = makeDeps(async () => ['E:\\a\\x.mkv', 'E:\\a\\y.mkv'])

    const count = await appendPlaylistFile('E:\\q.m3u8', deps)

    expect(deps.readPlaylist).toHaveBeenCalledWith('E:\\q.m3u8')
    expect(addPaths).toHaveBeenCalledWith(['E:\\a\\x.mkv', 'E:\\a\\y.mkv'])
    expect(count).toBe(2)
  })

  it('appendPlaylistFile resolves 0 for an empty playlist', async () => {
    const { deps, addPaths } = makeDeps(async () => [])

    const count = await appendPlaylistFile('E:\\empty.m3u', deps)

    expect(count).toBe(0)
    expect(addPaths).toHaveBeenCalledWith([])
  })

  it('appendPlaylistFile catches an unreadable file and resolves 0 without queueing', async () => {
    const { deps, addPaths } = makeDeps(async () => {
      throw new Error('ENOENT')
    })

    const count = await appendPlaylistFile('E:\\gone.m3u', deps)

    expect(count).toBe(0)
    expect(addPaths).not.toHaveBeenCalled()
  })

  it('awaits the async addPaths before resolving and still returns the expanded count', async () => {
    let settled = false
    const addPaths = vi.fn<(paths: string[]) => Promise<void>>(async () => {
      await Promise.resolve()
      settled = true
    })
    const deps = { readPlaylist: vi.fn(async () => ['E:\\a\\x.mkv', 'E:\\a\\y.mkv']), addPaths }

    const count = await appendPathsToPlaylist(['E:\\q.m3u'], deps)

    // If the promise were left floating, `settled` would still be false here.
    expect(settled).toBe(true)
    expect(count).toBe(2)
  })

  it('appendPlaylistFile awaits the async addPaths (no floating promise on drop)', async () => {
    let settled = false
    const addPaths = vi.fn<(paths: string[]) => Promise<void>>(async () => {
      await Promise.resolve()
      settled = true
    })
    const deps = { readPlaylist: vi.fn(async () => ['E:\\a\\x.mkv']), addPaths }

    await appendPlaylistFile('E:\\q.m3u', deps)

    expect(settled).toBe(true)
  })
})

describe('loadSubtitleFromPicker', () => {
  function makeSession(
    overrides: {
      loadExternalSubtitle?: ReturnType<typeof vi.fn>
      setSubtitleTrack?: ReturnType<typeof vi.fn>
    } = {}
  ): SubtitlePickerSessionDeps['session'] & {
    loadExternalSubtitle: ReturnType<typeof vi.fn>
    setSubtitleTrack: ReturnType<typeof vi.fn>
  } {
    const loadExternalSubtitle =
      overrides.loadExternalSubtitle ?? vi.fn().mockResolvedValue(['こんにちは'])
    const setSubtitleTrack = overrides.setSubtitleTrack ?? vi.fn().mockResolvedValue(undefined)
    return {
      bridge: {
        media: { loadExternalSubtitle },
        mediaHistory: { setSubtitleTrack }
      },
      dispatch: vi.fn(),
      subtitleToken: { current: 0 },
      cueCache: new Map(),
      fileToken: { current: 0 },
      loadExternalSubtitle,
      setSubtitleTrack
    } as unknown as SubtitlePickerSessionDeps['session'] & {
      loadExternalSubtitle: ReturnType<typeof vi.fn>
      setSubtitleTrack: ReturnType<typeof vi.fn>
    }
  }

  function makeDeps(
    overrides: Partial<SubtitlePickerSessionDeps> = {}
  ): SubtitlePickerSessionDeps & { reportError: ReturnType<typeof vi.fn> } {
    return {
      expectedFilePath: 'E:\\anime\\episode.mkv',
      currentFilePath: () => 'E:\\anime\\episode.mkv',
      pickPath: vi.fn(async () => 'E:\\anime\\episode.srt'),
      session: makeSession(),
      reportError: vi.fn(),
      ...overrides
    } as SubtitlePickerSessionDeps & { reportError: ReturnType<typeof vi.fn> }
  }

  it('routes the picked path through the injected session', async () => {
    const session = makeSession()
    const deps = makeDeps({ session })

    await loadSubtitleFromPicker(deps)

    expect(session.loadExternalSubtitle).toHaveBeenCalledWith('E:\\anime\\episode.srt', 'auto')
    expect(session.setSubtitleTrack).toHaveBeenCalledWith('E:\\anime\\episode.mkv', {
      mode: 'external',
      path: 'E:\\anime\\episode.srt',
      encoding: 'auto'
    })
    expect(deps.reportError).not.toHaveBeenCalled()
  })

  it('does nothing when the dialog is cancelled', async () => {
    const session = makeSession()
    const deps = makeDeps({ session, pickPath: vi.fn(async () => undefined) })

    await loadSubtitleFromPicker(deps)

    expect(session.loadExternalSubtitle).not.toHaveBeenCalled()
    expect(deps.reportError).not.toHaveBeenCalled()
  })

  it('surfaces the load action’s warning for a malformed file', async () => {
    const session = makeSession({
      loadExternalSubtitle: vi.fn().mockRejectedValue(new Error('No subtitles found in this file.'))
    })
    const deps = makeDeps({ session })

    await loadSubtitleFromPicker(deps)

    expect(deps.reportError).toHaveBeenCalledWith('No subtitles found in this file.')
  })

  // A6: the video can be swapped out (drop, recent-file open) while the native
  // dialog is up. The subtitle then belongs to a file that is no longer playing.
  it('drops the picked file silently when the video changed while the dialog was open', async () => {
    let deferred!: (path: string) => void
    let playing = 'E:\\anime\\episode.mkv'
    const session = makeSession()
    const deps = makeDeps({
      session,
      expectedFilePath: playing,
      currentFilePath: () => playing,
      pickPath: vi.fn(
        () =>
          new Promise<string | undefined>((resolve) => {
            deferred = resolve
          })
      )
    })

    const done = loadSubtitleFromPicker(deps)
    playing = 'E:\\anime\\other.mkv'
    deferred('E:\\anime\\episode.srt')
    await done

    expect(session.loadExternalSubtitle).not.toHaveBeenCalled()
    expect(deps.reportError).not.toHaveBeenCalled()
  })

  it('loads once when the same video is still playing after the dialog resolves', async () => {
    let deferred!: (path: string) => void
    const session = makeSession()
    const deps = makeDeps({
      session,
      pickPath: vi.fn(
        () =>
          new Promise<string | undefined>((resolve) => {
            deferred = resolve
          })
      )
    })

    const done = loadSubtitleFromPicker(deps)
    deferred('E:\\anime\\episode.srt')
    await done

    expect(session.loadExternalSubtitle).toHaveBeenCalledTimes(1)
    expect(session.loadExternalSubtitle).toHaveBeenCalledWith('E:\\anime\\episode.srt', 'auto')
  })

  // Identity is exact: a case-folded or otherwise re-spelled path is a
  // different file as far as history persistence is concerned.
  it('treats a differently-spelled path as a different video', async () => {
    const session = makeSession()
    const deps = makeDeps({
      session,
      expectedFilePath: 'E:\\anime\\episode.mkv',
      currentFilePath: () => 'e:\\ANIME\\episode.mkv'
    })

    await loadSubtitleFromPicker(deps)

    expect(session.loadExternalSubtitle).not.toHaveBeenCalled()
    expect(deps.reportError).not.toHaveBeenCalled()
  })
})

describe('shouldOpenWordPopup', () => {
  it('suppresses token lookup only for a non-collapsed text selection', () => {
    expect(shouldOpenWordPopup(null)).toBe(true)
    expect(shouldOpenWordPopup({ isCollapsed: true })).toBe(true)
    expect(shouldOpenWordPopup({ isCollapsed: false })).toBe(false)
  })
})

describe('shouldClosePopupOnPointerDown', () => {
  const inside = {} as Node
  const outside = {} as Node
  const popup = { contains: (node: Node | null) => node === inside }

  it('closes only for a pointer-down outside the popup element', () => {
    expect(shouldClosePopupOnPointerDown(popup, outside, false)).toBe(true)
    expect(shouldClosePopupOnPointerDown(popup, inside, false)).toBe(false)
  })

  it('never closes while the mined-card picture dialog is open', () => {
    // Regression: the dialog renders outside #word-popup, so closing here left
    // the mine with no popup and it silently added nothing.
    expect(shouldClosePopupOnPointerDown(popup, outside, true)).toBe(false)
  })

  it('does not close when the popup element is absent', () => {
    expect(shouldClosePopupOnPointerDown(null, outside, false)).toBe(false)
  })
})

describe('appClassName', () => {
  it('is empty when windowed with nothing revealed', () => {
    expect(appClassName(false, false, false)).toBe('')
  })

  it('adds fullscreen and reveal classes for the truthy flags', () => {
    expect(appClassName(true, false, false)).toBe('fullscreen')
    expect(appClassName(true, true, false)).toBe('fullscreen reveal-top')
    expect(appClassName(true, true, true)).toBe('fullscreen reveal-top reveal-bottom')
    expect(appClassName(true, false, true)).toBe('fullscreen reveal-bottom')
  })
})
