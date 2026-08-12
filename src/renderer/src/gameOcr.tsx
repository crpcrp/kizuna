import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import GameOcrFrame from './components/GameOcrFrame'
import GameOcrInteraction from './components/GameOcrInteraction'
import type { GameOcrLayoutSize } from './state/gameOcrLayout'
import { useAppearance } from './state/useAppearance'
import { useGameOcrPreferences } from './state/useGameOcrPreferences'
import { useGameOcrSession } from './state/useGameOcrSession'
import './theme.css'
import './gameOcr.css'

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

function GameOcrApp(): React.JSX.Element {
  const kizuna = window.kizuna
  const viewportSize = useViewportSize()
  const { popup, translationEnabled, appearance, levelColors } = useGameOcrPreferences(kizuna)
  useAppearance({ appearance, levelColors })
  const session = useGameOcrSession({
    bridge: {
      gameOcr: kizuna.gameOcr,
      mecab: kizuna.mecab,
      dict: kizuna.dict,
      knowledge: kizuna.knowledge,
      clipboard: kizuna.clipboard
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
