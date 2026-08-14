import { useState } from 'react'
import { APP_NAME } from '../../../shared/appInfo'
import { errorMessage } from '../util/errorMessage'

import './SplashScreen.css'

const APP_LOGO_URL = new URL('../../../../build/icon.png', import.meta.url).href

export interface SplashScreenProps {
  gameOcrSupported: boolean
  onGameOcr: () => Promise<void>
  onPlayer: () => Promise<void>
  onOptions: () => Promise<void>
  error?: string
}

type PendingChoice = 'gameOcr' | 'player' | 'options' | null

/** The lightweight startup surface. It deliberately does not render App. */
export default function SplashScreen({
  gameOcrSupported,
  onGameOcr,
  onPlayer,
  onOptions,
  error
}: SplashScreenProps): React.JSX.Element {
  const [pending, setPending] = useState<PendingChoice>(null)
  const [actionError, setActionError] = useState<string | undefined>()

  const run = async (choice: Exclude<PendingChoice, null>, action: () => Promise<void>) => {
    setPending(choice)
    setActionError(undefined)
    try {
      await action()
    } catch (err) {
      setActionError(errorMessage(err))
    } finally {
      setPending(null)
    }
  }

  const message = actionError ?? error

  return (
    <div id="app" className="splash-app">
      <main className="splash-main" aria-labelledby="splash-title">
        <section className="splash-card">
          <div className="splash-brand" aria-hidden="true">
            <img src={APP_LOGO_URL} alt="" draggable="false" />
          </div>
          <h1 id="splash-title">{APP_NAME}</h1>
          <p className="splash-subtitle">Choose how to begin.</p>

          {message && (
            <p className="splash-error" role="alert">
              {message}
            </p>
          )}

          <div className="splash-choices" aria-label="Start Kizuna">
            <button
              type="button"
              aria-label="Game OCR"
              disabled={!gameOcrSupported || pending !== null}
              onClick={() => void run('gameOcr', onGameOcr)}
            >
              <span>Game OCR</span>
              {!gameOcrSupported && <small>Windows only</small>}
            </button>
            <button
              type="button"
              aria-label="Video player"
              disabled={pending !== null}
              onClick={() => void run('player', onPlayer)}
            >
              Video player
            </button>
            <button
              type="button"
              aria-label="Options"
              disabled={pending !== null}
              onClick={() => void run('options', onOptions)}
            >
              Options
            </button>
          </div>
        </section>
      </main>
    </div>
  )
}
