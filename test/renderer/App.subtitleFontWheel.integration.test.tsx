// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '@src/renderer/src/App'
import { DEFAULT_PLAYER_SETTINGS, type PlayerSettings } from '@src/shared/playerSettings'
import { installFakeKizunaApi } from '../harness/fakeKizunaApi'
import { appTeardown } from '../harness/appIntegration'

function installBridge(): {
  setSettings: ReturnType<typeof vi.fn>
  getSettings: ReturnType<typeof vi.fn>
} {
  let savedSettings: PlayerSettings = {
    ...DEFAULT_PLAYER_SETTINGS,
    sidebarOpen: true
  }
  const getSettings = vi.fn(async () => savedSettings)
  const setSettings = vi.fn(async (patch: Partial<PlayerSettings>) => {
    savedSettings = { ...savedSettings, ...patch }
    return savedSettings
  })
  installFakeKizunaApi({ playerSettings: { getSettings, setSettings } })
  return { setSettings, getSettings }
}

function wheel(target: EventTarget, init: WheelEventInit): WheelEvent {
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init })
  for (const key of ['shiftKey', 'ctrlKey', 'altKey', 'metaKey'] as const) {
    Object.defineProperty(event, key, { value: init[key] ?? false })
  }
  target.dispatchEvent(event)
  return event
}

async function openSubtitleOptions(): Promise<HTMLInputElement> {
  await screen.findByRole('button', { name: 'Media' })
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
  fireEvent.click(screen.getByRole('menuitem', { name: 'Options' }))
  fireEvent.click(await screen.findByRole('tab', { name: 'Subtitles' }))
  const input = document.getElementById('subtitle-font-scale-input')
  if (!(input instanceof HTMLInputElement))
    throw new Error('Subtitle font-size input was not rendered')
  return input
}

afterEach(appTeardown)

describe('subtitle font-size wheel shortcut', () => {
  it('updates the content scale, cancels its wheel, ignores other surfaces, and persists', async () => {
    const fakes = installBridge()
    render(<App />)

    const content = document.getElementById('content')
    if (!content) throw new Error('Playback content was not rendered')
    const sidebar = await screen.findByLabelText('All subtitles')

    const plain = wheel(content, { deltaY: -1 })
    expect(plain.defaultPrevented).toBe(false)

    const increased = wheel(content, { deltaY: -1, shiftKey: true })
    expect(increased.defaultPrevented).toBe(true)

    const sidebarWheel = wheel(sidebar, { deltaY: -1, shiftKey: true })
    expect(sidebarWheel.defaultPrevented).toBe(false)

    const input = await openSubtitleOptions()
    await waitFor(() => expect(input.value).toBe('110'))
    await waitFor(() =>
      expect(fakes.setSettings).toHaveBeenCalledWith({
        subtitleStyle: expect.objectContaining({ fontScale: 1.1 })
      })
    )

    const optionsWheel = wheel(input, { deltaY: -1, shiftKey: true })
    expect(optionsWheel.defaultPrevented).toBe(false)
    expect(input.value).toBe('110')

    cleanup()
    render(<App />)
    const restoredInput = await openSubtitleOptions()
    await waitFor(() => expect(restoredInput.value).toBe('110'))
    expect(fakes.getSettings).toHaveBeenCalledTimes(2)
  })
})
