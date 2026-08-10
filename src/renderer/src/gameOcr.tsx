import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import GameOcrFrame from './components/GameOcrFrame'
import type { GameOcrPresentation } from '../../shared/gameOcr'
import './theme.css'

function GameOcrApp(): React.JSX.Element {
  const api = window.kizuna.gameOcr
  const [presentation, setPresentation] = useState<GameOcrPresentation | undefined>()

  useEffect(() => {
    const unsubscribePresentation = api.onPresentation(setPresentation)
    const unsubscribeDiscard = api.onDiscard(() => setPresentation(undefined))
    const unsubscribeRecognition = api.onRecognitionState((recognizing) =>
      setPresentation((current) => (current ? { ...current, recognizing } : current))
    )
    api.rendererReady()
    return () => {
      unsubscribePresentation()
      unsubscribeDiscard()
      unsubscribeRecognition()
    }
  }, [api])

  const close = (): void => {
    setPresentation(undefined)
    api.close()
  }

  return <GameOcrFrame presentation={presentation} onClose={close} />
}

const rootEl = document.getElementById('root')
if (!rootEl) throw new Error('Game OCR renderer bootstrap failed: #root element not found')

createRoot(rootEl).render(
  <StrictMode>
    <GameOcrApp />
  </StrictMode>
)
