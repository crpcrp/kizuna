// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '@src/renderer/src/App'
import { DEFAULT_PLAYER_SETTINGS, type PlayerSettings } from '@src/shared/playerSettings'
import { initialPlayerState } from '@src/renderer/src/state/playerState'
import type { RecentMediaFile } from '@src/shared/mediaHistory'
import type { KizunaApi } from '@src/shared/preloadApi'
import type { Track } from '@src/shared/track'

// Wiring guard for the MenuBar call site. These assertions are deliberately
// about *which* bridge call each menu item reaches: the props they travel
// through are all `() => void`, so TypeScript cannot catch a handler swapped
// with its neighbour. `onFrameStep`/`onFrameBack` are the pair most at risk.
// The whole preload bridge is faked; no production code outside src/ runs.

const EPISODE = 'C:\\Media\\Episode05.mkv'

const AUDIO_JP: Track = { id: 1, kind: 'audio', codec: 'aac', language: 'jpn' }
const AUDIO_EN: Track = { id: 2, kind: 'audio', codec: 'ac3', language: 'eng' }
const SUB_JP: Track = { id: 3, kind: 'subtitle', codec: 'ass', title: 'Full', language: 'jpn' }
const SUB_EN: Track = { id: 4, kind: 'subtitle', codec: 'srt', title: 'Signs', language: 'eng' }

function recent(...paths: string[]): RecentMediaFile[] {
  return paths.map((path, i) => ({ path, openedAt: paths.length - i }))
}

interface Fakes {
  load: ReturnType<typeof vi.fn>
  getPlaybackHistory: ReturnType<typeof vi.fn>
  setYtdlpQuality: ReturnType<typeof vi.fn>
  frameStep: ReturnType<typeof vi.fn>
  frameBackStep: ReturnType<typeof vi.fn>
  setLoudnessNorm: ReturnType<typeof vi.fn>
  setAudioTrack: ReturnType<typeof vi.fn>
  setAudioDevice: ReturnType<typeof vi.fn>
  getAudioDevices: ReturnType<typeof vi.fn>
  setPlayerSettings: ReturnType<typeof vi.fn>
  loadSubtitle: ReturnType<typeof vi.fn>
}

function installBridge(settings: PlayerSettings = DEFAULT_PLAYER_SETTINGS): Fakes {
  const noop = (): void => undefined
  const fakes: Fakes = {
    load: vi.fn(async () => undefined),
    getPlaybackHistory: vi.fn(async () => undefined),
    setYtdlpQuality: vi.fn(async () => undefined),
    frameStep: vi.fn(async () => undefined),
    frameBackStep: vi.fn(async () => undefined),
    setLoudnessNorm: vi.fn(async () => undefined),
    setAudioTrack: vi.fn(async () => undefined),
    setAudioDevice: vi.fn(async () => undefined),
    getAudioDevices: vi.fn(async () => [
      { name: 'auto', description: 'Autoselect device' },
      { name: 'wasapi/speakers', description: 'Speakers' }
    ]),
    setPlayerSettings: vi.fn(async () => settings),
    loadSubtitle: vi.fn(async () => [])
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
      setYtdlpQuality: fakes.setYtdlpQuality,
      cancelLoad: vi.fn(async () => undefined),
      getVideoDimensions: vi.fn(async () => undefined),
      setPause: vi.fn(async () => undefined),
      seek: vi.fn(async () => undefined),
      setVolume: vi.fn(async () => undefined),
      setSpeed: vi.fn(async () => undefined),
      setMuted: vi.fn(async () => undefined),
      setAudioDelay: vi.fn(async () => undefined),
      setAudioTrack: fakes.setAudioTrack,
      setAbLoop: vi.fn(async () => undefined),
      setVideoMargins: vi.fn(async () => undefined),
      setVideoAdjustments: vi.fn(async () => undefined),
      frameStep: fakes.frameStep,
      frameBackStep: fakes.frameBackStep,
      getAudioDevices: fakes.getAudioDevices,
      setAudioDevice: fakes.setAudioDevice,
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
      enumerateTracks: vi.fn(async () => [AUDIO_JP, AUDIO_EN, SUB_JP, SUB_EN]),
      loadSubtitle: fakes.loadSubtitle,
      loadExternalSubtitle: vi.fn(async () => []),
      getVideoDimensions: vi.fn(async () => undefined),
      folderNeighbors: vi.fn(async () => ({})),
      getChapters: vi.fn(async () => [])
    },
    mediaHistory: {
      getRecentFiles: vi.fn(async () => recent(EPISODE)),
      getPlaybackHistory: fakes.getPlaybackHistory,
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
      setSettings: fakes.setPlayerSettings
    },
    clipboard: { writeText: vi.fn(async () => undefined) },
    translate: { translate: vi.fn(), cancel: noop },
    files: { pathForFile: vi.fn() }
  } as unknown as KizunaApi

  return fakes
}

/** Opens the recent episode through the Media menu and waits for its load. */
async function openRecent(load: ReturnType<typeof vi.fn>): Promise<void> {
  await waitFor(() => expect(screen.getByRole('button', { name: 'Media' })).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: 'Media' }))
  fireEvent.click(screen.getByRole('menuitem', { name: EPISODE }))
  await waitFor(() => expect(load).toHaveBeenCalledWith(EPISODE))
}

/** Opens a top-level menu category by its button label. */
function openMenu(label: string): void {
  fireEvent.click(screen.getByRole('button', { name: label }))
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('MenuBar frame stepping reaches the matching mpv call', () => {
  it('"Step forward one frame" steps forward, never back', async () => {
    const fakes = installBridge()
    render(<App />)
    await openRecent(fakes.load)

    openMenu('Playback')
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Step forward one frame' }))

    await waitFor(() => expect(fakes.frameStep).toHaveBeenCalledOnce())
    expect(fakes.frameBackStep).not.toHaveBeenCalled()
  })

  it('"Step back one frame" steps back, never forward', async () => {
    const fakes = installBridge()
    render(<App />)
    await openRecent(fakes.load)

    openMenu('Playback')
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Step back one frame' }))

    await waitFor(() => expect(fakes.frameBackStep).toHaveBeenCalledOnce())
    expect(fakes.frameStep).not.toHaveBeenCalled()
  })
})

// Output device + loudness live in Options > Playback > Audio output (issue
// #290); only the per-file controls stayed in the Audio menu.
describe('Options audio-output items reach their bridge calls', () => {
  /** Opens Settings > Options and shows the Playback tab. */
  function openPlaybackOptions(): void {
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Playback' }))
  }

  it('showing the Playback tab refreshes the device list', async () => {
    const fakes = installBridge()
    render(<App />)
    await openRecent(fakes.load)

    const beforeOpen = fakes.getAudioDevices.mock.calls.length
    openPlaybackOptions()

    await waitFor(() => expect(fakes.getAudioDevices.mock.calls.length).toBeGreaterThan(beforeOpen))
  })

  it('picking a device applies that device name to mpv', async () => {
    const fakes = installBridge()
    render(<App />)
    await openRecent(fakes.load)

    openPlaybackOptions()
    const select = screen.getByLabelText(/Output device/) as HTMLSelectElement
    await waitFor(() => expect(select.options.length).toBe(2))
    fireEvent.change(select, { target: { value: 'wasapi/speakers' } })

    await waitFor(() => expect(fakes.setAudioDevice).toHaveBeenCalledWith('wasapi/speakers'))
  })

  it('shows auto for a saved device mpv no longer reports, keeping the saved preference', async () => {
    const fakes = installBridge({ ...DEFAULT_PLAYER_SETTINGS, audioDevice: 'wasapi/missing' })
    render(<App />)
    await openRecent(fakes.load)

    openPlaybackOptions()
    const select = screen.getByLabelText(/Output device/) as HTMLSelectElement
    await waitFor(() => expect(select.value).toBe('auto'))
    // The fallback is apply-time only: nothing rewrote the stored device.
    for (const [patch] of fakes.setPlayerSettings.mock.calls) {
      expect(patch?.audioDevice).toBeUndefined()
    }
  })

  it('shows an available saved device as the selected output', async () => {
    const fakes = installBridge({ ...DEFAULT_PLAYER_SETTINGS, audioDevice: 'wasapi/speakers' })
    render(<App />)
    await openRecent(fakes.load)

    openPlaybackOptions()
    const select = screen.getByLabelText(/Output device/) as HTMLSelectElement
    await waitFor(() => expect(select.value).toBe('wasapi/speakers'))
  })

  it('"Normalize loudness" toggles the filter on', async () => {
    const fakes = installBridge()
    render(<App />)
    await openRecent(fakes.load)

    openPlaybackOptions()
    fireEvent.click(screen.getByLabelText(/Normalize loudness/))

    await waitFor(() => expect(fakes.setLoudnessNorm).toHaveBeenCalledWith(true))
  })
})

describe('MenuBar audio items reach their bridge calls', () => {
  it('picking an audio track switches mpv to that track id', async () => {
    const fakes = installBridge()
    render(<App />)
    await openRecent(fakes.load)

    openMenu('Audio')
    await waitFor(() =>
      expect(screen.getByRole('menuitemradio', { name: '[EN] ac3' })).toBeTruthy()
    )
    fireEvent.click(screen.getByRole('menuitemradio', { name: '[EN] ac3' }))

    await waitFor(() => expect(fakes.setAudioTrack).toHaveBeenCalledWith(AUDIO_EN.id))
  })
})

describe('MenuBar subtitle selection reaches the loader', () => {
  // Switches to the track the file did *not* auto-select, so the assertion
  // proves the click drove the load rather than the on-open default.
  it('picking a subtitle track loads that track id', async () => {
    const fakes = installBridge()
    render(<App />)
    await openRecent(fakes.load)

    openMenu('Subtitle')
    await waitFor(() =>
      expect(screen.getByRole('menuitemradio', { name: '[EN] Signs' })).toBeTruthy()
    )
    fireEvent.click(screen.getByRole('menuitemradio', { name: '[EN] Signs' }))

    await waitFor(() => expect(fakes.loadSubtitle).toHaveBeenCalledWith(EPISODE, SUB_EN.id))
  })
})

describe('MenuBar yt-dlp quality wiring', () => {
  it('shows quality only for YouTube, reloads 720p at the current position, and checks it', async () => {
    const fakes = installBridge()
    const youtube = 'https://www.youtube.com/watch?v=abc'
    const initialState = { ...initialPlayerState, filePath: youtube, timePos: 42, paused: true }
    render(<App initialState={initialState} />)

    openMenu('Video')
    fireEvent.click(screen.getByRole('menuitemradio', { name: '720p or lower' }))

    await waitFor(() => expect(fakes.setYtdlpQuality).toHaveBeenCalledWith('720'))
    expect(fakes.load).toHaveBeenCalledWith(youtube)
    expect(window.kizuna.player.seek).toHaveBeenCalledWith(42, true)
    expect(window.kizuna.player.setPause).toHaveBeenCalledWith(true)
    openMenu('Video')
    await waitFor(() =>
      expect(
        screen.getByRole('menuitemradio', { name: '720p or lower' }).getAttribute('aria-checked')
      ).toBe('true')
    )

    cleanup()
    render(<App initialState={{ ...initialPlayerState, filePath: 'C:\\Media\\Episode05.mkv' }} />)
    openMenu('Video')
    expect(screen.queryByText('Quality')).toBeNull()
    cleanup()
    render(
      <App
        initialState={{ ...initialPlayerState, filePath: 'https://cdn.example.com/video.mp4' }}
      />
    )
    openMenu('Video')
    expect(screen.queryByText('Quality')).toBeNull()
  })

  it('keeps the previous quality selected when the existing URL-open pipeline fails', async () => {
    const fakes = installBridge()
    const youtube = 'https://www.youtube.com/watch?v=abc'
    fakes.getPlaybackHistory.mockRejectedValueOnce(new Error('sanitized URL load failure'))
    render(<App initialState={{ ...initialPlayerState, filePath: youtube }} />)

    openMenu('Video')
    fireEvent.click(screen.getByRole('menuitemradio', { name: '720p or lower' }))

    await waitFor(() => expect(fakes.setYtdlpQuality).toHaveBeenCalledWith('720'))
    await waitFor(() => expect(fakes.getPlaybackHistory).toHaveBeenCalledWith(youtube))
    openMenu('Video')
    await waitFor(() =>
      expect(
        screen.getByRole('menuitemradio', { name: 'Best available' }).getAttribute('aria-checked')
      ).toBe('true')
    )
    expect(fakes.load).not.toHaveBeenCalled()
    expect(window.kizuna.player.seek).not.toHaveBeenCalled()
    expect(window.kizuna.player.setPause).not.toHaveBeenCalled()
  })
})
