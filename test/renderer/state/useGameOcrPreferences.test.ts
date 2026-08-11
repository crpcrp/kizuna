// @vitest-environment happy-dom
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useGameOcrPreferences } from '@src/renderer/src/state/useGameOcrPreferences'
import { DEFAULT_APPEARANCE, DEFAULT_POPUP_SETTINGS } from '@src/shared/playerSettings'
import type { PlayerSettings } from '@src/shared/playerSettings'

afterEach(cleanup)

function settings(overrides: Partial<PlayerSettings>): PlayerSettings {
  return {
    popupSettings: DEFAULT_POPUP_SETTINGS,
    translationEnabled: false,
    appearance: DEFAULT_APPEARANCE,
    levelColors: {},
    ...overrides
  } as PlayerSettings
}

function setup() {
  let present: (() => void) | undefined
  const getSettings = vi.fn(async () => settings({ translationEnabled: false }))
  const bridge = {
    playerSettings: { getSettings },
    gameOcr: {
      onPresentation: vi.fn((cb: () => void) => {
        present = cb
        return () => {
          present = undefined
        }
      })
    }
  }
  const hook = renderHook(() =>
    useGameOcrPreferences(bridge as unknown as Parameters<typeof useGameOcrPreferences>[0])
  )
  return { hook, getSettings, bridge, present: () => present?.() }
}

describe('useGameOcrPreferences', () => {
  it('loads the player settings the frozen frame is drawn with', async () => {
    const { hook, getSettings } = setup()

    await waitFor(() => expect(getSettings).toHaveBeenCalledOnce())
    expect(hook.result.current.popup).toEqual(DEFAULT_POPUP_SETTINGS)
    expect(hook.result.current.translationEnabled).toBe(false)
  })

  it('re-reads them for every frame, because the renderer outlives each one', async () => {
    const { hook, getSettings, present } = setup()
    await waitFor(() => expect(getSettings).toHaveBeenCalledOnce())

    // The player window stays usable between two captures, so a preference
    // changed there has to reach the next frozen frame.
    getSettings.mockResolvedValueOnce(
      settings({ translationEnabled: true, levelColors: { known: '#123456' } })
    )
    present()

    await waitFor(() => expect(hook.result.current.translationEnabled).toBe(true))
    expect(hook.result.current.levelColors).toEqual({ known: '#123456' })
    expect(getSettings).toHaveBeenCalledTimes(2)
  })

  it('keeps the last known preferences when a reload fails', async () => {
    const { hook, getSettings, present } = setup()
    getSettings.mockResolvedValueOnce(settings({ translationEnabled: true }))
    present()
    await waitFor(() => expect(hook.result.current.translationEnabled).toBe(true))

    getSettings.mockRejectedValueOnce(new Error('settings are unavailable'))
    present()

    await waitFor(() => expect(getSettings).toHaveBeenCalledTimes(3))
    expect(hook.result.current.translationEnabled).toBe(true)
  })
})
