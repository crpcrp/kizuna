// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '@src/renderer/src/App'
import { DEFAULT_PLAYER_SETTINGS, type PlayerSettings } from '@src/shared/playerSettings'
import { installFakeKizunaApi, type FakeKizunaApi } from '../harness/fakeKizunaApi'
import { EPISODE, appTeardown, openRecent, recent } from '../harness/appIntegration'

// Rendered coverage for finding 1's fix: App's keydown shortcut listener bails
// via isEditableTarget when the event originates in a menu text field, so
// typing into the Audio-menu delay input (e.g. Backspace to delete a digit)
// no longer fires the bare-key shortcut bound to that key (speedReset). The
// whole preload bridge is faked; no production code outside src/ runs.

interface Fakes {
  setSpeed: FakeKizunaApi['player']['setSpeed']
  load: FakeKizunaApi['player']['load']
}

function installBridge(settings: PlayerSettings): Fakes {
  const api = installFakeKizunaApi({
    player: {
      load: vi.fn(async () => undefined),
      setSpeed: vi.fn(async () => undefined)
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
    setSpeed: api.player.setSpeed,
    load: api.player.load
  }
}

afterEach(appTeardown)

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
