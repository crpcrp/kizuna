// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '@src/renderer/src/App'
import { DEFAULT_PLAYER_SETTINGS, type PlayerSettings } from '@src/shared/playerSettings'
import type { RecentMediaFile } from '@src/shared/mediaHistory'
import { installFakeKizunaApi, type FakeKizunaApi } from '../harness/fakeKizunaApi'

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
  screenshot: FakeKizunaApi['player']['screenshot']
  load: FakeKizunaApi['player']['load']
}

function installBridge(
  settings: PlayerSettings,
  screenshot: FakeKizunaApi['player']['screenshot']
): Fakes {
  const api = installFakeKizunaApi({
    player: {
      load: vi.fn(async () => undefined),
      screenshot
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
    screenshot: api.player.screenshot,
    load: api.player.load
  }
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
