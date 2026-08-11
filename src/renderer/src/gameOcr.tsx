import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import GameOcrFrame from './components/GameOcrFrame'
import GameOcrInteraction from './components/GameOcrInteraction'
import {
  DEFAULT_APPEARANCE,
  DEFAULT_POPUP_SETTINGS,
  type Appearance,
  type LevelColors,
  type PopupSettings
} from '../../shared/playerSettings'
import type { GameOcrLayoutSize } from './state/gameOcrLayout'
import { useAppearance } from './state/useAppearance'
import { useGameOcrSession } from './state/useGameOcrSession'
import './theme.css'

/** The frozen window is fixed to one display, but DPI changes still resize it. */
function useViewportSize(): GameOcrLayoutSize {
  const [size, setSize] = useState<GameOcrLayoutSize>(() => ({
    width: window.innerWidth,
    height: window.innerHeight
  }))
  useEffect(() => {
    const onResize = (): void =>
      setSize((current) =>
        current.width === window.innerWidth && current.height === window.innerHeight
          ? current
          : { width: window.innerWidth, height: window.innerHeight }
      )
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return size
}

interface GameOcrPreferences {
  popup: PopupSettings
  translationEnabled: boolean
  appearance: Appearance
  levelColors: LevelColors
}

/**
 * Reads the preferences the player window persists. The frozen frame is a
 * second renderer, so it loads them itself rather than inheriting anything
 * from the player's React tree — including the theme and the knowledge-level
 * colors its boxes are drawn with.
 */
function usePlayerPreferences(): GameOcrPreferences {
  const [preferences, setPreferences] = useState<GameOcrPreferences>({
    popup: DEFAULT_POPUP_SETTINGS,
    translationEnabled: false,
    appearance: DEFAULT_APPEARANCE,
    levelColors: {}
  })
  useEffect(() => {
    let active = true
    void window.kizuna.playerSettings.getSettings().then(
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
    return () => {
      active = false
    }
  }, [])
  return preferences
}

function GameOcrApp(): React.JSX.Element {
  const kizuna = window.kizuna
  const viewportSize = useViewportSize()
  const { popup, translationEnabled, appearance, levelColors } = usePlayerPreferences()
  useAppearance({ appearance, levelColors })
  const session = useGameOcrSession({
    bridge: {
      gameOcr: kizuna.gameOcr,
      mecab: kizuna.mecab,
      dict: kizuna.dict,
      knowledge: kizuna.knowledge
    },
    viewportSize,
    popupSettings: popup
  })

  return (
    <GameOcrFrame presentation={session.presentation} onClose={session.close}>
      <GameOcrInteraction
        regions={session.regions}
        captureKey={session.captureKey}
        bridge={kizuna}
        popupSettings={popup}
        translationEnabled={translationEnabled}
      />
    </GameOcrFrame>
  )
}

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('Game OCR renderer bootstrap failed: #root element not found')

createRoot(rootEl).render(
  <StrictMode>
    <GameOcrApp />
  </StrictMode>
)
