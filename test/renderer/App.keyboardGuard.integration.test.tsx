// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '@src/renderer/src/App'
import { DEFAULT_PLAYER_SETTINGS, type PlayerSettings } from '@src/shared/playerSettings'
import type { RecentMediaFile } from '@src/shared/mediaHistory'
import type { KizunaApi } from '@src/shared/preloadApi'

// Rendered coverage for finding 1's fix: App's keydown shortcut listener bails
// via isEditableTarget when the event originates in a menu text field, so
// typing into the Audio-menu delay input (e.g. Backspace to delete a digit)
// no longer fires the bare-key shortcut bound to that key (speedReset). The
// whole preload bridge is faked; no production code outside src/ runs.

const EPISODE = 'C:\\Media\\Episode07.mkv'

function recent(...paths: string[]): RecentMediaFile[] {
  return paths.map((path, i) => ({ path, openedAt: paths.length - i }))
}

interface Fakes {
  setSpeed: ReturnType<typeof vi.fn>
  load: ReturnType<typeof vi.fn>
}

function installBridge(settings: PlayerSettings): Fakes {
  const noop = (): void => undefined
  const fakes: Fakes = {
    setSpeed: vi.fn(async () => undefined),
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
      setSpeed: fakes.setSpeed,
      setMuted: vi.fn(async () => undefined),
      setAudioDelay: vi.fn(async () => undefined),
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
      getChapters: vi.fn(async () => [])
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
  vi.restoreAllMocks()
})

describe('App keyboard-shortcut guard', () => {
  it('does not fire a bare-key shortcut typed into a menu input (finding 1)', async () => {
    const settings: PlayerSettings = { ...DEFAULT_PLAYER_SETTINGS }
    const fakes = installBridge(settings)
    render(<App />)

    await openRecent(fakes.load)
    // The load restore effect resets speed once; wait for it, then measure from
    // that baseline so we only count shortcut-driven setSpeed calls.
    await waitFor(() => expect(fakes.setSpeed).toHaveBeenCalledWith(1))
    const baseline = fakes.setSpeed.mock.calls.length

    // Backspace outside any field is the speedReset shortcut → setSpeed(1).
    fireEvent.keyDown(document.body, { code: 'Backspace' })
    await waitFor(() => expect(fakes.setSpeed.mock.calls.length).toBe(baseline + 1))

    // The same Backspace typed into the Audio-menu delay field (deleting a
    // digit) must be swallowed by the isEditableTarget guard — no speedReset.
    fireEvent.click(screen.getByRole('button', { name: 'Audio' }))
    const input = screen.getByRole('spinbutton', { name: 'Audio delay in milliseconds' })
    fireEvent.keyDown(input, { code: 'Backspace' })

    // Give any (erroneously) scheduled effect a chance to run before asserting.
    await Promise.resolve()
    expect(fakes.setSpeed.mock.calls.length).toBe(baseline + 1)
  })
})
