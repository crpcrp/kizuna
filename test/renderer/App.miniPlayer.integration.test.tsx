// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '@src/renderer/src/App'
import { DEFAULT_PLAYER_SETTINGS, type PlayerSettings } from '@src/shared/playerSettings'
import type { KizunaApi } from '@src/shared/preloadApi'
import type { WindowBounds } from '@src/shared/windowBounds'

// Rendered coverage for Feature 8 (mini-player): the Video-menu "Mini player"
// item and the Ctrl+M key action enter compact mode — saving the current window
// bounds, forcing always-on-top on, asking main for the mini corner, hiding the
// MenuBar, and swapping the BottomBar's fullscreen button for a restore button —
// and leaving it restores the saved bounds and prior always-on-top. The whole
// preload bridge is faked; no production code outside src/ runs.

const SAVED_BOUNDS: WindowBounds = { x: 100, y: 50, width: 1280, height: 720 }

interface Fakes {
  getBounds: ReturnType<typeof vi.fn>
  setBounds: ReturnType<typeof vi.fn>
  setAlwaysOnTop: ReturnType<typeof vi.fn>
  setVideoMargins: ReturnType<typeof vi.fn>
  toggleFullscreen: ReturnType<typeof vi.fn>
  /** Pushes a fullscreen-state change into the renderer, as main would. */
  emitFullscreen?: (value: boolean) => void
}

function installBridge(): Fakes {
  const noop = (): void => undefined
  const settings: PlayerSettings = { ...DEFAULT_PLAYER_SETTINGS }
  const fakes: Fakes = {
    getBounds: vi.fn(async () => SAVED_BOUNDS),
    setBounds: vi.fn(async (request: unknown) => request),
    setAlwaysOnTop: vi.fn(),
    setVideoMargins: vi.fn(async () => undefined),
    toggleFullscreen: vi.fn()
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
      toggleFullscreen: fakes.toggleFullscreen,
      onFullscreenChange: (cb: (value: boolean) => void) => {
        fakes.emitFullscreen = cb
        return noop
      },
      setSize: noop,
      setAlwaysOnTop: fakes.setAlwaysOnTop,
      getBounds: fakes.getBounds,
      setBounds: fakes.setBounds
    },
    player: {
      load: vi.fn(async () => undefined),
      setPause: vi.fn(async () => undefined),
      seek: vi.fn(async () => undefined),
      setVolume: vi.fn(async () => undefined),
      setSpeed: vi.fn(async () => undefined),
      setMuted: vi.fn(async () => undefined),
      setAudioDelay: vi.fn(async () => undefined),
      setAudioTrack: vi.fn(async () => undefined),
      setAbLoop: vi.fn(async () => undefined),
      setVideoMargins: fakes.setVideoMargins,
      setVideoAdjustments: vi.fn(async () => undefined),
      getAudioDevices: vi.fn(async () => []),
      setAudioDevice: vi.fn(async () => undefined),
      setLoudnessNorm: vi.fn(async () => undefined),
      screenshot: vi.fn(async () => ''),
      onTimePos: () => noop,
      onDuration: () => noop,
      onEofReached: () => noop,
      onPause: () => noop,
      onMediaKey: () => noop
    },
    launch: { onOpenPath: () => noop, onError: () => noop, rendererReady: noop },
    media: {
      openFile: vi.fn(async () => undefined),
      openSubtitleFile: vi.fn(async () => undefined),
      enumerateTracks: vi.fn(async () => []),
      loadSubtitle: vi.fn(async () => []),
      loadExternalSubtitle: vi.fn(async () => []),
      getVideoDimensions: vi.fn(async () => undefined),
      folderNeighbors: vi.fn(async () => ({}))
    },
    mediaHistory: {
      getRecentFiles: vi.fn(async () => []),
      getPlaybackHistory: vi.fn(async () => undefined),
      removeRecentFile: vi.fn(async () => []),
      clearRecentFiles: vi.fn(async () => undefined),
      checkFileAvailability: vi.fn(async () => ({ status: 'available' as const })),
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
      getSettings: vi.fn(async () => settings),
      setSettings: vi.fn(async () => settings)
    },
    clipboard: { writeText: vi.fn(async () => undefined) },
    translate: { translate: vi.fn(), cancel: noop },
    files: { pathForFile: vi.fn() }
  } as unknown as KizunaApi

  return fakes
}

async function openMiniPlayerFromMenu(): Promise<void> {
  await waitFor(() => expect(screen.getByRole('button', { name: 'Video' })).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: 'Video' }))
  fireEvent.click(screen.getByRole('menuitemradio', { name: 'Mini player' }))
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('App mini-player', () => {
  it('keeps the full embedded video viewport when Ctrl+M enters mini mode', async () => {
    const fakes = installBridge()
    render(<App />)

    const topControls = document.getElementById('top-controls')!
    const bottomBar = document.getElementById('bottom-bar')!
    Object.defineProperty(topControls, 'offsetHeight', { configurable: true, value: 30 })
    Object.defineProperty(bottomBar, 'offsetHeight', { configurable: true, value: 40 })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 270 })
    fireEvent(window, new Event('resize'))
    await waitFor(() =>
      expect(fakes.setVideoMargins).toHaveBeenLastCalledWith(30 / 270, 40 / 270, 0, 0)
    )
    fakes.setVideoMargins.mockClear()

    fireEvent.keyDown(window, { code: 'ControlLeft', ctrlKey: true })
    fireEvent.keyDown(window, { code: 'KeyM', ctrlKey: true })

    await waitFor(() => expect(screen.getByRole('button', { name: 'Restore window' })).toBeTruthy())
    await waitFor(() => expect(fakes.setVideoMargins).toHaveBeenLastCalledWith(0, 0, 0, 0))
  })

  it('enters mini mode: saves bounds, forces always-on-top, hides the menu, shows restore', async () => {
    const fakes = installBridge()
    render(<App />)

    await openMiniPlayerFromMenu()

    // Saved the current bounds and asked main for the mini corner.
    await waitFor(() => expect(fakes.getBounds).toHaveBeenCalled())
    await waitFor(() =>
      expect(fakes.setBounds).toHaveBeenCalledWith({
        mode: 'miniPlayer',
        topBarHeight: expect.any(Number),
        bottomBarHeight: expect.any(Number)
      })
    )
    expect(fakes.setAlwaysOnTop).toHaveBeenCalledWith(true)

    // MenuBar gone; the reduced BottomBar exposes the restore button.
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Video' })).toBeNull())
    expect(screen.getByRole('button', { name: 'Restore window' })).toBeTruthy()
  })

  it('leaving mini restores the saved bounds and the prior always-on-top flag', async () => {
    const fakes = installBridge()
    render(<App />)

    await openMiniPlayerFromMenu()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Restore window' })).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Restore window' }))

    await waitFor(() =>
      expect(fakes.setBounds).toHaveBeenCalledWith({ mode: 'explicit', bounds: SAVED_BOUNDS })
    )
    // Always-on-top was off before entering, so exiting turns it back off.
    expect(fakes.setAlwaysOnTop).toHaveBeenLastCalledWith(false)
    // MenuBar is back.
    await waitFor(() => expect(screen.getByRole('button', { name: 'Video' })).toBeTruthy())
  })

  it('does not enter mini-player while fullscreen (fullscreen wins)', async () => {
    const fakes = installBridge()
    render(<App />)
    await waitFor(() => expect(fakes.emitFullscreen).toBeDefined())

    // Main reports the window went fullscreen (e.g. via the F key).
    act(() => fakes.emitFullscreen!(true))

    await openMiniPlayerFromMenu()

    // The toggle is a no-op: no bounds read/write, no always-on-top change, and
    // the reduced restore button never appears — the app stays fullscreen only.
    expect(fakes.getBounds).not.toHaveBeenCalled()
    expect(fakes.setBounds).not.toHaveBeenCalled()
    expect(fakes.setAlwaysOnTop).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Restore window' })).toBeNull()
  })

  it('defers mini-player bounds restore until an external fullscreen path leaves fullscreen', async () => {
    const fakes = installBridge()
    render(<App />)
    await waitFor(() => expect(fakes.emitFullscreen).toBeDefined())

    await openMiniPlayerFromMenu()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Restore window' })).toBeTruthy())

    act(() => fakes.emitFullscreen!(true))

    expect(fakes.setBounds).not.toHaveBeenCalledWith({ mode: 'explicit', bounds: SAVED_BOUNDS })
    expect(fakes.setAlwaysOnTop).toHaveBeenLastCalledWith(false)
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Restore window' })).toBeNull())
    expect(screen.getByRole('button', { name: 'Video' })).toBeTruthy()

    act(() => fakes.emitFullscreen!(false))

    await waitFor(() =>
      expect(fakes.setBounds).toHaveBeenLastCalledWith({ mode: 'explicit', bounds: SAVED_BOUNDS })
    )
  })
})
