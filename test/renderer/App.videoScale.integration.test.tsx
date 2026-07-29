// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '@src/renderer/src/App'
import { DEFAULT_PLAYER_SETTINGS, type PlayerSettings } from '@src/shared/playerSettings'
import { initialPlayerState } from '@src/renderer/src/state/playerState'
import type { KizunaApi } from '@src/shared/preloadApi'

// Rendered coverage: the visible video size must survive a side panel opening —
// both the size a preset picked from Video ▸ Size and the default size nobody
// ever touched. mpv's margins take the panel's width out of the video area, so
// the *window* has to grow by that width; otherwise the picture silently
// shrinks. The whole preload bridge is faked; no production code outside src/
// runs.

const EPISODE = 'C:\\Media\\Episode05.mkv'
const VIDEO = { width: 1920, height: 1080 }
const SIDEBAR_WIDTH = 360
const PLAYLIST_WIDTH = 320
// The default-size window the unmodified case preserves: happy-dom lays nothing
// out, so the window box is stated rather than measured.
const WINDOW = { innerWidth: 1280, innerHeight: 720 }
// Roomy enough that nothing here ever hits clampWindowSize.
const SCREEN = { availWidth: 7680, availHeight: 4320 }

interface Fakes {
  setSize: ReturnType<typeof vi.fn>
  getVideoDimensions: ReturnType<typeof vi.fn>
  /** Only reached once the saved settings have landed, so it doubles as the
   *  "restored panel state is on screen" signal the sizing effects wait for. */
  setLoudnessNorm: ReturnType<typeof vi.fn>
  getSettings: ReturnType<typeof vi.fn>
}

function installBridge(
  settings: PlayerSettings = DEFAULT_PLAYER_SETTINGS,
  videoDimensions: Promise<typeof VIDEO | undefined> = Promise.resolve(VIDEO)
): Fakes {
  const noop = (): void => undefined
  const fakes: Fakes = {
    setSize: vi.fn(),
    getVideoDimensions: vi.fn(() => videoDimensions),
    setLoudnessNorm: vi.fn(async () => undefined),
    getSettings: vi.fn(async () => settings)
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
      setSize: fakes.setSize,
      setAlwaysOnTop: noop
    },
    player: {
      load: vi.fn(async () => undefined),
      cancelLoad: vi.fn(async () => undefined),
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
      setLoudnessNorm: fakes.setLoudnessNorm,
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
      getVideoDimensions: fakes.getVideoDimensions,
      folderNeighbors: vi.fn(async () => ({})),
      getChapters: vi.fn(async () => [])
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
      getSettings: fakes.getSettings,
      setSettings: vi.fn(async () => settings)
    },
    clipboard: { writeText: vi.fn(async () => undefined) },
    translate: { translate: vi.fn(), cancel: noop },
    files: { pathForFile: vi.fn() }
  } as unknown as KizunaApi

  return fakes
}

const originalOffsetWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')

/** Gives the two side-panel stacks a real measured width (happy-dom lays
 *  nothing out, so every offsetWidth would otherwise be 0). */
function stubSidebarWidths(): void {
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get(this: HTMLElement) {
      if (this.id === 'right-sidebar-stack') return SIDEBAR_WIDTH
      if (this.id === 'left-sidebar-stack') return PLAYLIST_WIDTH
      return 0
    }
  })
}

/** happy-dom reports a small default work area; every test states its own. */
function stubScreen(availWidth: number, availHeight: number): void {
  Object.defineProperty(window.screen, 'availWidth', { configurable: true, value: availWidth })
  Object.defineProperty(window.screen, 'availHeight', { configurable: true, value: availHeight })
}

/** The window box the default-size baseline is measured from. */
function stubWindowSize(): void {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: WINDOW.innerWidth })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: WINDOW.innerHeight })
}

/** Both presets sit under Video ▸ Size as plain percentage items. */
function pickVideoScale(label: string): void {
  fireEvent.click(screen.getByRole('button', { name: 'Video' }))
  fireEvent.click(screen.getByRole('menuitemradio', { name: label }))
}

function renderWithVideo(): void {
  render(<App initialState={{ ...initialPlayerState, filePath: EPISODE }} />)
}

/** Renders with the panel widths, work area and window box all stated, and
 *  waits until the video dimensions and saved settings have both landed —
 *  the point from which a panel toggle counts as a transition to compensate. */
async function renderReady(
  fakes: Fakes,
  screenSize: { availWidth: number; availHeight: number } = SCREEN
): Promise<void> {
  stubSidebarWidths()
  stubScreen(screenSize.availWidth, screenSize.availHeight)
  stubWindowSize()
  renderWithVideo()
  await waitFor(() => expect(fakes.getVideoDimensions).toHaveBeenCalledWith(EPISODE))
  await waitFor(() => expect(fakes.setLoudnessNorm).toHaveBeenCalled())
}

function toggleSubtitleSidebar(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Toggle subtitle sidebar' }))
}

function togglePlaylistSidebar(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Toggle playlist sidebar' }))
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  if (originalOffsetWidth) {
    Object.defineProperty(HTMLElement.prototype, 'offsetWidth', originalOffsetWidth)
  } else {
    // @ts-expect-error -- removing the stub restores happy-dom's own lookup.
    delete HTMLElement.prototype.offsetWidth
  }
})

describe('App video-scale window sizing across panel toggles', () => {
  it('grows the window by the subtitle panel width instead of shrinking the video', async () => {
    const fakes = installBridge()
    await renderReady(fakes)

    pickVideoScale('200%')
    // No panel open yet: the plain 200% size (bar heights are 0 in happy-dom).
    await waitFor(() => expect(fakes.setSize).toHaveBeenLastCalledWith(3840, 2160))

    toggleSubtitleSidebar()

    await waitFor(() => expect(fakes.setSize).toHaveBeenLastCalledWith(3840 + SIDEBAR_WIDTH, 2160))
  })

  it('adds the playlist width too, and shrinks back as each panel closes', async () => {
    const fakes = installBridge()
    await renderReady(fakes)

    pickVideoScale('200%')
    toggleSubtitleSidebar()
    togglePlaylistSidebar()

    await waitFor(() =>
      expect(fakes.setSize).toHaveBeenLastCalledWith(3840 + SIDEBAR_WIDTH + PLAYLIST_WIDTH, 2160)
    )

    togglePlaylistSidebar()
    await waitFor(() => expect(fakes.setSize).toHaveBeenLastCalledWith(3840 + SIDEBAR_WIDTH, 2160))

    toggleSubtitleSidebar()
    await waitFor(() => expect(fakes.setSize).toHaveBeenLastCalledWith(3840, 2160))
  })

  it('applies the same growth to a non-200% preset', async () => {
    const fakes = installBridge()
    await renderReady(fakes)

    pickVideoScale('50%')
    toggleSubtitleSidebar()

    await waitFor(() => expect(fakes.setSize).toHaveBeenLastCalledWith(960 + SIDEBAR_WIDTH, 540))
  })

  it('keeps a 100% preset intact across a panel toggle', async () => {
    const fakes = installBridge()
    await renderReady(fakes)

    pickVideoScale('Original size (100%)')
    await waitFor(() => expect(fakes.setSize).toHaveBeenLastCalledWith(1920, 1080))

    toggleSubtitleSidebar()
    await waitFor(() => expect(fakes.setSize).toHaveBeenLastCalledWith(1920 + SIDEBAR_WIDTH, 1080))
  })

  it('clamps to the work area when the video plus panels no longer fit', async () => {
    const fakes = installBridge()
    // A work area only as wide as the bare 200% video: the panel cannot be
    // paid for by the window, so the clamped size is the only case where the
    // rendered video legitimately shrinks.
    await renderReady(fakes, { availWidth: 3840, availHeight: 2160 })

    pickVideoScale('200%')
    toggleSubtitleSidebar()

    // 4200x2160 scaled by 3840/4200 to fit the width.
    await waitFor(() => expect(fakes.setSize).toHaveBeenLastCalledWith(3840, 1975))
  })
})

// The default/unmodified size is a size worth preserving too: the sidebar takes
// its width out of mpv's video area either way, so "no preset picked" must not
// mean "let the picture shrink". The baseline is the window box measured before
// the transition, never a fabricated percentage of the native resolution.
describe('App default-size preservation across panel toggles', () => {
  it('grows and shrinks the window around the subtitle panel with no preset picked', async () => {
    const fakes = installBridge()
    await renderReady(fakes)

    toggleSubtitleSidebar()
    await waitFor(() =>
      expect(fakes.setSize).toHaveBeenLastCalledWith(
        WINDOW.innerWidth + SIDEBAR_WIDTH,
        WINDOW.innerHeight
      )
    )

    toggleSubtitleSidebar()
    await waitFor(() =>
      expect(fakes.setSize).toHaveBeenLastCalledWith(WINDOW.innerWidth, WINDOW.innerHeight)
    )
  })

  it('does the same for the playlist panel', async () => {
    const fakes = installBridge()
    await renderReady(fakes)

    togglePlaylistSidebar()
    await waitFor(() =>
      expect(fakes.setSize).toHaveBeenLastCalledWith(
        WINDOW.innerWidth + PLAYLIST_WIDTH,
        WINDOW.innerHeight
      )
    )

    togglePlaylistSidebar()
    await waitFor(() =>
      expect(fakes.setSize).toHaveBeenLastCalledWith(WINDOW.innerWidth, WINDOW.innerHeight)
    )
  })

  it('accounts for both panels, adding and removing only the one that toggled', async () => {
    const fakes = installBridge()
    await renderReady(fakes)

    toggleSubtitleSidebar()
    togglePlaylistSidebar()
    await waitFor(() =>
      expect(fakes.setSize).toHaveBeenLastCalledWith(
        WINDOW.innerWidth + SIDEBAR_WIDTH + PLAYLIST_WIDTH,
        WINDOW.innerHeight
      )
    )

    togglePlaylistSidebar()
    await waitFor(() =>
      expect(fakes.setSize).toHaveBeenLastCalledWith(
        WINDOW.innerWidth + SIDEBAR_WIDTH,
        WINDOW.innerHeight
      )
    )

    toggleSubtitleSidebar()
    await waitFor(() =>
      expect(fakes.setSize).toHaveBeenLastCalledWith(WINDOW.innerWidth, WINDOW.innerHeight)
    )
  })

  it('treats a sidebar restored as open at startup as part of the baseline', async () => {
    const fakes = installBridge({ ...DEFAULT_PLAYER_SETTINGS, sidebarOpen: true })
    await renderReady(fakes)
    await waitFor(() => expect(document.getElementById('right-sidebar-stack')).toBeTruthy())

    // The restored window already pays for the open subtitle panel, so nothing
    // is resized just because the app came up with it showing.
    expect(fakes.setSize).not.toHaveBeenCalled()

    // The baseline is therefore the window minus that panel; opening the
    // playlist adds its width alone.
    togglePlaylistSidebar()
    await waitFor(() =>
      expect(fakes.setSize).toHaveBeenLastCalledWith(
        WINDOW.innerWidth + PLAYLIST_WIDTH,
        WINDOW.innerHeight
      )
    )

    // Closing the restored sidebar gives its width back to the window.
    toggleSubtitleSidebar()
    await waitFor(() =>
      expect(fakes.setSize).toHaveBeenLastCalledWith(
        WINDOW.innerWidth + PLAYLIST_WIDTH - SIDEBAR_WIDTH,
        WINDOW.innerHeight
      )
    )
  })

  it('clamps the compensated window to the work area', async () => {
    const fakes = installBridge()
    // Barely wider than the default window: there is no room to pay for the
    // panel, so the clamp is the one case that legitimately shrinks the picture.
    await renderReady(fakes, { availWidth: 1400, availHeight: WINDOW.innerHeight })

    toggleSubtitleSidebar()

    // 1640x720 scaled by 1400/1640 to fit the width.
    await waitFor(() => expect(fakes.setSize).toHaveBeenLastCalledWith(1400, 615))
  })

  it('rebases a panel opened before video dimensions become available', async () => {
    let resolveVideoDimensions!: (value: typeof VIDEO) => void
    const dimensions = new Promise<typeof VIDEO>((resolve) => {
      resolveVideoDimensions = resolve
    })
    const fakes = installBridge(DEFAULT_PLAYER_SETTINGS, dimensions)
    stubSidebarWidths()
    stubScreen(SCREEN.availWidth, SCREEN.availHeight)
    stubWindowSize()
    renderWithVideo()
    await waitFor(() => expect(fakes.getVideoDimensions).toHaveBeenCalledWith(EPISODE))
    await waitFor(() => expect(fakes.setLoudnessNorm).toHaveBeenCalled())

    togglePlaylistSidebar()
    await waitFor(() => expect(document.getElementById('left-sidebar-stack')).toBeTruthy())
    expect(fakes.setSize).not.toHaveBeenCalled()

    await act(async () => {
      resolveVideoDimensions(VIDEO)
      await dimensions
    })

    togglePlaylistSidebar()
    await waitFor(() =>
      expect(fakes.setSize).toHaveBeenLastCalledWith(
        WINDOW.innerWidth - PLAYLIST_WIDTH,
        WINDOW.innerHeight
      )
    )
  })

  it('leaves the window alone while no video is loaded', async () => {
    const fakes = installBridge()
    stubSidebarWidths()
    stubScreen(SCREEN.availWidth, SCREEN.availHeight)
    stubWindowSize()
    render(<App initialState={initialPlayerState} />)
    await waitFor(() => expect(fakes.getSettings).toHaveBeenCalled())

    togglePlaylistSidebar()
    await waitFor(() => expect(document.getElementById('left-sidebar-stack')).toBeTruthy())

    expect(fakes.setSize).not.toHaveBeenCalled()
  })
})
