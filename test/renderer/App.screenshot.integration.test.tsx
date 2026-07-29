// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '@src/renderer/src/App'
import { DEFAULT_PLAYER_SETTINGS, type PlayerSettings } from '@src/shared/playerSettings'
import type { RecentMediaFile } from '@src/shared/mediaHistory'
import type { KizunaApi } from '@src/shared/preloadApi'

// Rendered coverage for the screenshot wiring: the keybinding — the only
// surface since the Video-menu item was dropped — forwards the current file
// path + position to the player bridge, and both a success and a failure
// surface a message on the shared error banner. The whole preload bridge is
// faked; no production code outside src/ runs.

const EPISODE = 'C:\\Media\\Episode05.mkv'

/** Default binding for the screenshot action ('KeyS'). */
const SCREENSHOT_KEY = DEFAULT_PLAYER_SETTINGS.keyBindings.screenshot

function recent(...paths: string[]): RecentMediaFile[] {
  return paths.map((path, i) => ({ path, openedAt: paths.length - i }))
}

interface Fakes {
  screenshot: ReturnType<typeof vi.fn>
  load: ReturnType<typeof vi.fn>
}

function installBridge(settings: PlayerSettings, screenshot: ReturnType<typeof vi.fn>): Fakes {
  const noop = (): void => undefined
  const fakes: Fakes = {
    screenshot,
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
    player: {
      load: fakes.load,
      setPause: vi.fn(async () => undefined),
      seek: vi.fn(async () => undefined),
      setVolume: vi.fn(async () => undefined),
      setSpeed: vi.fn(async () => undefined),
      setMuted: vi.fn(async () => undefined),
      setAudioDelay: vi.fn(async () => undefined),
      setAudioTrack: vi.fn(async () => undefined),
      setAbLoop: vi.fn(async () => undefined),
      setVideoMargins: vi.fn(async () => undefined),
      setVideoAdjustments: vi.fn(async () => undefined),
      getAudioDevices: vi.fn(async () => []),
      setAudioDevice: vi.fn(async () => undefined),
      setLoudnessNorm: vi.fn(async () => undefined),
      screenshot: fakes.screenshot,
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
      getRecentFiles: vi.fn(async () => recent(EPISODE)),
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

/** Opens the recent file through the Media menu and waits for its load. */
async function openRecent(load: ReturnType<typeof vi.fn>): Promise<void> {
  await waitFor(() => expect(screen.getByRole('button', { name: 'Media' })).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: 'Media' }))
  fireEvent.click(screen.getByRole('menuitem', { name: EPISODE }))
  await waitFor(() => expect(load).toHaveBeenCalledWith(EPISODE))
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('App screenshot', () => {
  it('forwards the current file and position to the bridge and shows the saved path', async () => {
    const settings: PlayerSettings = { ...DEFAULT_PLAYER_SETTINGS }
    const screenshot = vi.fn(async () => 'C:\\Pics\\Kizuna\\Episode05-0-00-00.png')
    const fakes = installBridge(settings, screenshot)
    render(<App />)

    await openRecent(fakes.load)

    fireEvent.keyDown(window, { code: SCREENSHOT_KEY })

    await waitFor(() => expect(screenshot).toHaveBeenCalledWith(EPISODE, 0))
    await waitFor(() =>
      expect(
        screen.getByText('Screenshot saved: C:\\Pics\\Kizuna\\Episode05-0-00-00.png')
      ).toBeTruthy()
    )
  })

  it('surfaces a sanitized failure message on the banner when capture rejects', async () => {
    const settings: PlayerSettings = { ...DEFAULT_PLAYER_SETTINGS }
    const screenshot = vi.fn(async () => {
      throw new Error('mpv: no video')
    })
    const fakes = installBridge(settings, screenshot)
    render(<App />)

    await openRecent(fakes.load)

    fireEvent.keyDown(window, { code: SCREENSHOT_KEY })

    await waitFor(() => expect(screen.getByText('mpv: no video')).toBeTruthy())
  })

  it('auto-dismisses the success banner 1s after it appears, but not a moment sooner', async () => {
    const settings: PlayerSettings = { ...DEFAULT_PLAYER_SETTINGS }
    const screenshot = vi.fn(async () => 'C:\\Pics\\Kizuna\\Episode05-0-00-00.png')
    const fakes = installBridge(settings, screenshot)
    render(<App />)

    await openRecent(fakes.load)

    vi.useFakeTimers()
    const message = 'Screenshot saved: C:\\Pics\\Kizuna\\Episode05-0-00-00.png'

    await act(async () => {
      fireEvent.keyDown(window, { code: SCREENSHOT_KEY })
    })

    expect(screen.getByText(message)).toBeTruthy()

    act(() => {
      vi.advanceTimersByTime(999)
    })
    expect(screen.getByText(message)).toBeTruthy()

    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(screen.queryByText(message)).toBeNull()
  })

  it('cancels the pending auto-dismiss timer on unmount', async () => {
    const settings: PlayerSettings = { ...DEFAULT_PLAYER_SETTINGS }
    const screenshot = vi.fn(async () => 'C:\\Pics\\Kizuna\\Episode05-0-00-00.png')
    const fakes = installBridge(settings, screenshot)
    const view = render(<App />)

    await openRecent(fakes.load)

    vi.useFakeTimers()
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout')

    await act(async () => {
      fireEvent.keyDown(window, { code: SCREENSHOT_KEY })
    })

    view.unmount()
    expect(clearTimeoutSpy).toHaveBeenCalled()

    // No dangling timer fires afterward — nothing left to throw on a stale update.
    expect(() => vi.advanceTimersByTime(1000)).not.toThrow()
  })
})
