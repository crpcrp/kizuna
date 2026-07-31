// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import App from '@src/renderer/src/App'
import {
  DEFAULT_PLAYER_SETTINGS,
  subtitleOffsetKey,
  type PlayerSettings
} from '@src/shared/playerSettings'
import { installFakeKizunaApi, type FakeKizunaApi } from '../harness/fakeKizunaApi'
import { EPISODE, installAppTeardown, openRecent, recent } from '../harness/appIntegration'

// Rendered coverage for the Audio-menu delay wiring: the file-change effect
// re-applies the persisted per-file delay to mpv (which retains audio-delay
// across loadfile), and the menu's ± controls both drive mpv and persist. The
// whole preload bridge is faked; no production code outside src/ runs.

interface Fakes {
  setAudioDelay: FakeKizunaApi['player']['setAudioDelay']
  setSpeed: FakeKizunaApi['player']['setSpeed']
  load: FakeKizunaApi['player']['load']
  setSettings: FakeKizunaApi['playerSettings']['setSettings']
  getChapters: FakeKizunaApi['media']['getChapters']
}

function installBridge(settings: PlayerSettings): Fakes {
  const api = installFakeKizunaApi({
    player: {
      load: vi.fn(async () => undefined),
      setSpeed: vi.fn(async () => undefined),
      setAudioDelay: vi.fn(async () => undefined)
    },
    media: {
      getChapters: vi.fn(async () => [])
    },
    mediaHistory: {
      getRecentFiles: vi.fn(async () => recent(EPISODE))
    },
    playerSettings: {
      getSettings: vi.fn(async () => settings),
      setSettings: vi.fn(async () => settings)
    }
  })

  return {
    setAudioDelay: api.player.setAudioDelay,
    setSpeed: api.player.setSpeed,
    load: api.player.load,
    setSettings: api.playerSettings.setSettings,
    getChapters: api.media.getChapters
  }
}

installAppTeardown()

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
