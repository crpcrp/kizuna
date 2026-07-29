// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '@src/renderer/src/App'
import { DEFAULT_PLAYER_SETTINGS } from '@src/shared/playerSettings'
import type { RecentMediaFile } from '@src/shared/mediaHistory'
import type { FileAvailability, KizunaApi } from '@src/shared/preloadApi'

// Rendered interaction coverage for the Media menu's recent-files section
// (plan slice M2). Everything below the renderer — dialogs, media, history —
// is the fake preload bridge; no production code is exercised outside src/.

const EPISODE_5 = 'C:\\Media\\Episode05.mkv'
const EPISODE_4 = 'C:\\Media\\episode04.mkv'
const PICKED = 'E:\\video\\picked.mkv'

function recent(...paths: string[]): RecentMediaFile[] {
  return paths.map((path, i) => ({ path, openedAt: paths.length - i }))
}

interface BridgeOptions {
  /** Resolved by every `getRecentFiles` call — mutate it to model a refresh. */
  recentFiles?: RecentMediaFile[]
  getRecentFiles?: () => Promise<RecentMediaFile[]>
  clearRecentFiles?: () => Promise<void>
  availability?: FileAvailability
  /** Paths the picker returns, one per "Open file…" (defaults to PICKED). */
  pickedPaths?: string[]
  /** Entries `media.readPlaylist` expands a picked .m3u into. */
  playlistEntries?: string[]
}

interface Bridge {
  getRecentFiles: ReturnType<typeof vi.fn>
  removeRecentFile: ReturnType<typeof vi.fn>
  clearRecentFiles: ReturnType<typeof vi.fn>
  checkFileAvailability: ReturnType<typeof vi.fn>
  openFile: ReturnType<typeof vi.fn>
  load: ReturnType<typeof vi.fn>
  /** Newest-first list the fake's `getRecentFiles` returns; mutable per test. */
  files: RecentMediaFile[]
}

function installBridge(options: BridgeOptions = {}): Bridge {
  const noop = (): void => undefined
  const files = [...(options.recentFiles ?? [])]

  const bridge: Bridge = {
    files,
    getRecentFiles: vi.fn(options.getRecentFiles ?? (async () => [...bridge.files])),
    removeRecentFile: vi.fn(async (path: string) => {
      bridge.files = bridge.files.filter((file) => file.path !== path)
      return [...bridge.files]
    }),
    clearRecentFiles: vi.fn(
      options.clearRecentFiles ??
        (async () => {
          bridge.files = []
        })
    ),
    checkFileAvailability: vi.fn(
      async () => options.availability ?? { status: 'available' as const }
    ),
    openFile: vi.fn(async () => {
      const picked = options.pickedPaths?.[bridge.openFile.mock.calls.length - 1] ?? PICKED
      bridge.files = recent(picked, ...bridge.files.map((file) => file.path))
      return picked
    }),
    load: vi.fn(async () => undefined)
  }

  window.matchMedia = vi.fn(() => ({
    matches: false,
    addEventListener: noop,
    removeEventListener: noop
  })) as never
  window.kizuna = {
    windowControls: {
      minimize: noop,
      close: noop,
      setFullscreen: noop,
      toggleFullscreen: noop,
      onFullscreenChange: () => noop,
      setSize: noop,
      setAlwaysOnTop: noop
    },
    launch: {
      onOpenPath: () => noop,
      onError: () => noop,
      rendererReady: noop
    },
    player: {
      load: bridge.load,
      setPause: vi.fn(async () => undefined),
      seek: vi.fn(async () => undefined),
      setVolume: vi.fn(async () => undefined),
      setMuted: vi.fn(async () => undefined),
      setAudioTrack: vi.fn(async () => undefined),
      setSpeed: vi.fn(async () => undefined),
      setAudioDelay: vi.fn(async () => undefined),
      setAbLoop: vi.fn(async () => undefined),
      setVideoMargins: vi.fn(async () => undefined),
      setVideoAdjustments: vi.fn(async () => undefined),
      getAudioDevices: vi.fn(async () => []),
      setAudioDevice: vi.fn(async () => undefined),
      setLoudnessNorm: vi.fn(async () => undefined),
      onTimePos: () => noop,
      onDuration: () => noop,
      onEofReached: () => noop,
      onPause: () => noop,
      onMediaKey: () => noop
    },
    media: {
      openFile: bridge.openFile,
      readPlaylist: vi.fn(async () => [...(options.playlistEntries ?? [])]),
      openSubtitleFile: vi.fn(async () => undefined),
      enumerateTracks: vi.fn(async () => []),
      loadSubtitle: vi.fn(async () => []),
      loadExternalSubtitle: vi.fn(async () => []),
      getVideoDimensions: vi.fn(async () => undefined)
    },
    mediaHistory: {
      getRecentFiles: bridge.getRecentFiles,
      getPlaybackHistory: vi.fn(async () => undefined),
      removeRecentFile: bridge.removeRecentFile,
      clearRecentFiles: bridge.clearRecentFiles,
      checkFileAvailability: bridge.checkFileAvailability,
      setAudioTrack: vi.fn(async () => undefined),
      setSubtitleTrack: vi.fn(async () => undefined)
    },
    mecab: {
      tokenize: vi.fn(async () => []),
      tokenizeBatch: vi.fn(async () => []),
      listDicts: vi.fn(async () => []),
      selectDict: vi.fn(async () => 'ipadic' as const),
      currentDict: vi.fn(async () => 'ipadic' as const)
    },
    dict: {
      importDict: vi.fn(),
      lookup: vi.fn(async () => []),
      listDicts: vi.fn(async () => []),
      setEnabled: vi.fn(),
      setFallbackOnly: vi.fn(),
      reorder: vi.fn(),
      removeDict: vi.fn(),
      onImportProgress: () => noop
    },
    anki: {
      ping: vi.fn(),
      deckNames: vi.fn(),
      modelNames: vi.fn(),
      modelFieldNames: vi.fn(),
      addNote: vi.fn(),
      findExisting: vi.fn(),
      findTargetDeckMembership: vi.fn(),
      openCard: vi.fn(),
      getSettings: vi.fn(),
      setSettings: vi.fn()
    },
    knowledge: {
      levelsFor: vi.fn(async () => ({})),
      detailsFor: vi.fn(async () => ({})),
      sync: vi.fn(),
      syncStatus: vi.fn(),
      getSettings: vi.fn(),
      setSettings: vi.fn()
    },
    playerSettings: {
      getSettings: vi.fn(async () => DEFAULT_PLAYER_SETTINGS),
      setSettings: vi.fn(async () => DEFAULT_PLAYER_SETTINGS)
    },
    clipboard: { writeText: vi.fn(async () => undefined) },
    translate: { translate: vi.fn() },
    files: { pathForFile: vi.fn() }
  } as unknown as KizunaApi

  return bridge
}

/** Opens the Media dropdown and waits for the recent list to have hydrated. */
async function openMediaMenu(bridge: Bridge): Promise<void> {
  await waitFor(() => expect(bridge.getRecentFiles).toHaveBeenCalled())
  fireEvent.click(screen.getByRole('button', { name: 'Media' }))
}

function mediaMenuOpen(): boolean {
  return screen.getByRole('button', { name: 'Media' }).getAttribute('aria-expanded') === 'true'
}

function alertText(): string {
  return screen.getByRole('alert').textContent ?? ''
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('App recent-files interactions', () => {
  it('forwards the clicked entry’s exact path and closes the Media menu', async () => {
    const bridge = installBridge({ recentFiles: recent(EPISODE_5, EPISODE_4) })
    render(<App />)

    await openMediaMenu(bridge)
    expect(mediaMenuOpen()).toBe(true)
    fireEvent.click(await screen.findByRole('menuitem', { name: EPISODE_4 }))

    // The clicked row's own path — not the newest entry, not a normalized or
    // lower-cased variant — reaches the bridge, and the picker is never used.
    await waitFor(() => expect(bridge.load).toHaveBeenCalledWith(EPISODE_4))
    expect(bridge.checkFileAvailability).toHaveBeenCalledWith(EPISODE_4)
    expect(bridge.openFile).not.toHaveBeenCalled()
    expect(mediaMenuOpen()).toBe(false)
  })

  it('drops a missing recent entry, reports it, and never loads it', async () => {
    const bridge = installBridge({
      recentFiles: recent(EPISODE_5, EPISODE_4),
      availability: { status: 'missing' }
    })
    render(<App />)

    await openMediaMenu(bridge)
    fireEvent.click(await screen.findByRole('menuitem', { name: EPISODE_5 }))

    await waitFor(() => expect(alertText()).toContain('This file could no longer be found.'))
    expect(bridge.removeRecentFile).toHaveBeenCalledWith(EPISODE_5)
    expect(bridge.load).not.toHaveBeenCalled()
    // The list is refreshed from the bridge, so the dead shortcut is gone
    // while the surviving one stays clickable.
    await waitFor(() => expect(screen.queryByRole('menuitem', { name: EPISODE_5 })).toBeNull())
    expect(screen.getByRole('menuitem', { name: EPISODE_4 })).not.toBeNull()
  })

  it('empties the list when Clear recent files succeeds', async () => {
    const bridge = installBridge({ recentFiles: recent(EPISODE_5, EPISODE_4) })
    render(<App />)

    await openMediaMenu(bridge)
    const clear = await screen.findByRole('menuitem', { name: 'Clear recent files' })
    expect(clear.hasAttribute('disabled')).toBe(false)
    fireEvent.click(clear)

    await waitFor(() => expect(bridge.clearRecentFiles).toHaveBeenCalledTimes(1))
    await screen.findByText('No recent files')
    expect(screen.queryByRole('menuitem', { name: EPISODE_5 })).toBeNull()
    expect(
      screen.getByRole('menuitem', { name: 'Clear recent files' }).hasAttribute('disabled')
    ).toBe(true)
    expect(mediaMenuOpen()).toBe(false)
  })

  it('keeps the entries and reports the failure when Clear recent files fails', async () => {
    const bridge = installBridge({
      recentFiles: recent(EPISODE_5, EPISODE_4),
      clearRecentFiles: async () => {
        throw new Error('Could not clear recent files.')
      }
    })
    render(<App />)

    await openMediaMenu(bridge)
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Clear recent files' }))

    await waitFor(() => expect(alertText()).toContain('Could not clear recent files.'))
    expect(screen.getByRole('menuitem', { name: EPISODE_5 })).not.toBeNull()
    expect(screen.getByRole('menuitem', { name: EPISODE_4 })).not.toBeNull()
  })

  it('shows an empty list and an error when the initial recent-files read fails', async () => {
    const bridge = installBridge({
      recentFiles: recent(EPISODE_5),
      getRecentFiles: async () => {
        throw new Error('History unavailable.')
      }
    })
    render(<App />)

    await openMediaMenu(bridge)
    await waitFor(() => expect(alertText()).toContain('History unavailable.'))
    expect(await screen.findByText('No recent files')).not.toBeNull()
    expect(screen.queryByRole('menuitem', { name: EPISODE_5 })).toBeNull()
    // Nothing to clear, so the row stays disabled after the failed read.
    expect(
      screen.getByRole('menuitem', { name: 'Clear recent files' }).hasAttribute('disabled')
    ).toBe(true)
  })

  it('empties the playlist sidebar when the picker opens a single file over a queue', async () => {
    const bridge = installBridge({
      recentFiles: recent(EPISODE_5),
      pickedPaths: ['C:\\Media\\queue.m3u', PICKED],
      playlistEntries: [EPISODE_5, EPISODE_4]
    })
    render(<App />)

    await waitFor(() => expect(bridge.getRecentFiles).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Toggle playlist sidebar' }))

    // A picked .m3u replaces the queue with its entries, which the sidebar lists.
    await openMediaMenu(bridge)
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Open file' }))
    await waitFor(() => expect(bridge.load).toHaveBeenCalledWith(EPISODE_5))
    expect(screen.getAllByRole('button', { name: /^(Episode05|episode04)\.mkv$/ })).toHaveLength(2)

    // Opening a single file replaces that queue with just it — one entry is not
    // a playlist, so the sidebar goes back to its empty state.
    await openMediaMenu(bridge)
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Open file' }))

    await waitFor(() => expect(bridge.load).toHaveBeenCalledWith(PICKED))
    await waitFor(() => expect(screen.getByText(/Queue is empty/)).not.toBeNull())
    expect(screen.queryAllByRole('button', { name: /\.mkv$/ })).toHaveLength(0)
  })

  it('refreshes the recent list after the picker opens a file', async () => {
    const bridge = installBridge({ recentFiles: recent(EPISODE_5) })
    render(<App />)

    await openMediaMenu(bridge)
    expect(screen.queryByRole('menuitem', { name: PICKED })).toBeNull()
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Open file' }))

    await waitFor(() => expect(bridge.load).toHaveBeenCalledWith(PICKED))
    // The refresh re-reads the bridge rather than optimistically prepending,
    // so the just-opened file appears newest-first from the stored list.
    await waitFor(() => expect(screen.getByRole('menuitem', { name: PICKED })).not.toBeNull())
    expect(bridge.getRecentFiles.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(screen.getByRole('menuitem', { name: EPISODE_5 })).not.toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
