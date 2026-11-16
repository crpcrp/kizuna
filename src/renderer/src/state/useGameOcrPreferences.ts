import { useEffect, useState } from 'react'
import {
  DEFAULT_APPEARANCE,
  DEFAULT_POPUP_SETTINGS,
  type Appearance,
  type LevelColors,
  type PopupSettings
} from '../../../shared/playerSettings'
import type { KizunaApi } from '../../../shared/preloadApi'

/** The slice of the player's persisted settings a frozen frame is drawn with. */
export interface GameOcrPreferences {
  popup: PopupSettings
  translationEnabled: boolean
  appearance: Appearance
  levelColors: LevelColors
}

export interface GameOcrPreferencesBridge {
  playerSettings: Pick<KizunaApi['playerSettings'], 'getSettings'>
  gameOcr: Pick<KizunaApi['gameOcr'], 'onFreeze'>
}

const DEFAULT_PREFERENCES: GameOcrPreferences = {
  popup: DEFAULT_POPUP_SETTINGS,
  translationEnabled: false,
  appearance: DEFAULT_APPEARANCE,
  levelColors: {}
}

// The retained OCR renderer has its own React tree; reload player preferences for each new freeze.
export function useGameOcrPreferences(bridge: GameOcrPreferencesBridge): GameOcrPreferences {
  const [preferences, setPreferences] = useState<GameOcrPreferences>(DEFAULT_PREFERENCES)
  const { playerSettings, gameOcr } = bridge

  useEffect(() => {
    let active = true
    const load = (): void => {
      void playerSettings.getSettings().then(
        (settings) => {
          if (!active) return
          setPreferences({
            popup: settings.popupSettings,
            translationEnabled: settings.translationEnabled,
            appearance: settings.appearance,
            levelColors: settings.levelColors
          })
        },
        // Defaults keep lookup working; only the opt-in translator stays off.
        () => undefined
      )
    }
    load()
    const unsubscribe = gameOcr.onFreeze(load)
    return () => {
      active = false
      unsubscribe()
    }
  }, [gameOcr, playerSettings])

  return preferences
}
