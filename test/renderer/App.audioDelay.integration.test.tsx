// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '@src/renderer/src/App'
import {
  DEFAULT_PLAYER_SETTINGS,
  subtitleOffsetKey,
  type PlayerSettings
} from '@src/shared/playerSettings'
import type { RecentMediaFile } from '@src/shared/mediaHistory'
import type { KizunaApi } from '@src/shared/preloadApi'

// Rendered coverage for the Audio-menu delay wiring: the file-change effect
// re-applies the persisted per-file delay to mpv (which retains audio-delay
// across loadfile), and the menu's ± controls both drive mpv and persist. The
// whole preload bridge is faked; no production code outside src/ runs.

const EPISODE = 'C:\\Media\\Episode05.mkv'

function recent(...paths: string[]): RecentMediaFile[] {
  return paths.map((path, i) => ({ path, openedAt: paths.length - i }))
}

interface Fakes {
  setAudioDelay: ReturnType<typeof vi.fn>
  setSpeed: ReturnType<typeof vi.fn>
  load: ReturnType<typeof vi.fn>
  setSettings: ReturnType<typeof vi.fn>
  getChapters: ReturnType<typeof vi.fn>
}

function installBridge(settings: PlayerSettings): Fakes {
  const noop = (): void => undefined
  const fakes: Fakes = {
    setAudioDelay: vi.fn(async () => undefined),
    setSpeed: vi.fn(async () => undefined),
    load: vi.fn(async () => undefined),
    setSettings: vi.fn(async () => settings),
    getChapters: vi.fn(async () => [])
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
      setSpeed: fakes.setSpeed,
      setMuted: vi.fn(async () => undefined),
      setAudioDelay: fakes.setAudioDelay,
      setAudioTrack: vi.fn(async () => undefined),
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
    launch: { onOpenPath: () => noop, onError: () => noop, rendererReady: noop },
    media: {
      openFile: vi.fn(async () => undefined),
      openSubtitleFile: vi.fn(async () => undefined),
      enumerateTracks: vi.fn(async () => []),
      loadSubtitle: vi.fn(async () => []),
      loadExternalSubtitle: vi.fn(async () => []),
      getVideoDimensions: vi.fn(async () => undefined),
      folderNeighbors: vi.fn(async () => ({})),
      getChapters: fakes.getChapters
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
      setSettings: fakes.setSettings
    },
    clipboard: { writeText: vi.fn(async () => undefined) },
    translate: { translate: vi.fn(), cancel: noop },
    files: { pathForFile: vi.fn() }
  } as unknown as KizunaApi

  return fakes
}

/** Opens the given recent file through the Media menu and waits for its load. */
async function openRecent(load: ReturnType<typeof vi.fn>): Promise<void> {
  await waitFor(() => expect(screen.getByRole('button', { name: 'Media' })).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: 'Media' }))
  fireEvent.click(screen.getByRole('menuitem', { name: EPISODE }))
  await waitFor(() => expect(load).toHaveBeenCalledWith(EPISODE))
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('App audio delay', () => {
  it('re-applies the persisted per-file audio delay to mpv when the file opens', async () => {
    const settings: PlayerSettings = {
      ...DEFAULT_PLAYER_SETTINGS,
      audioDelays: { [subtitleOffsetKey(EPISODE)]: -250 }
    }
    const fakes = installBridge(settings)
    render(<App />)

    await openRecent(fakes.load)
    await waitFor(() => expect(fakes.setAudioDelay).toHaveBeenCalledWith(-250))
  })

  it('applies a changed delay to mpv and schedules its persistence', async () => {
    const settings: PlayerSettings = { ...DEFAULT_PLAYER_SETTINGS, audioDelays: {} }
    const fakes = installBridge(settings)
    render(<App />)

    await openRecent(fakes.load)
    await waitFor(() => expect(fakes.setAudioDelay).toHaveBeenCalledWith(0)) // restored default

    fireEvent.click(screen.getByRole('button', { name: 'Audio' }))
    fireEvent.click(screen.getByRole('button', { name: 'Increase audio delay' }))

    expect(fakes.setAudioDelay).toHaveBeenLastCalledWith(50)
    await waitFor(() =>
      expect(fakes.setSettings).toHaveBeenCalledWith(
        expect.objectContaining({ audioDelays: { [subtitleOffsetKey(EPISODE)]: 50 } })
      )
    )
  })

  it('re-runs the per-file effects when the same path is reopened (finding 2)', async () => {
    // Reopening the current file (F8 second instance, or picking it from Recent
    // again) dispatches fileLoaded with an unchanged path but a bumped
    // loadGeneration, so the speed-reset / audio-delay-restore effect and the
    // chapter fetch — keyed on loadGeneration, not filePath — must re-run.
    const settings: PlayerSettings = {
      ...DEFAULT_PLAYER_SETTINGS,
      audioDelays: { [subtitleOffsetKey(EPISODE)]: -250 }
    }
    const fakes = installBridge(settings)
    render(<App />)

    await openRecent(fakes.load)
    await waitFor(() => expect(fakes.setSpeed).toHaveBeenCalledWith(1))
    await waitFor(() => expect(fakes.setAudioDelay).toHaveBeenCalledWith(-250))
    await waitFor(() => expect(fakes.getChapters).toHaveBeenCalledTimes(1))
    const speedCalls = fakes.setSpeed.mock.calls.length
    const delayCalls = fakes.setAudioDelay.mock.calls.length

    // Second open of the exact same path.
    fireEvent.click(screen.getByRole('button', { name: 'Media' }))
    fireEvent.click(screen.getByRole('menuitem', { name: EPISODE }))
    await waitFor(() => expect(fakes.load).toHaveBeenCalledTimes(2))

    await waitFor(() => expect(fakes.setSpeed.mock.calls.length).toBeGreaterThan(speedCalls))
    await waitFor(() => expect(fakes.setAudioDelay.mock.calls.length).toBeGreaterThan(delayCalls))
    expect(fakes.setSpeed).toHaveBeenLastCalledWith(1)
    expect(fakes.setAudioDelay).toHaveBeenLastCalledWith(-250)
    await waitFor(() => expect(fakes.getChapters).toHaveBeenCalledTimes(2))
  })
})
