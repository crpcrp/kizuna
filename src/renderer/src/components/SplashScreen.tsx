import { useState } from 'react'
import { APP_NAME } from '../../../shared/appInfo'
import { errorMessage } from '../util/errorMessage'

import './SplashScreen.css'

const APP_LOGO_URL = new URL('../../../../build/icon.png', import.meta.url).href
const dragStyle = { WebkitAppRegion: 'drag' } as React.CSSProperties
const noDragStyle = { WebkitAppRegion: 'no-drag' } as React.CSSProperties

export interface SplashScreenProps {
  gameOcrSupported: boolean
  onGameOcr: () => Promise<void>
  onPlayer: () => Promise<void>
  onOptions: () => Promise<void>
  onQuit: () => void
  error?: string
}

type PendingChoice = 'gameOcr' | 'player' | 'options' | null

/** The lightweight startup surface. It deliberately does not render App. */
export default function SplashScreen({
  gameOcrSupported,
  onGameOcr,
  onPlayer,
  onOptions,
  onQuit,
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
        <section className="splash-card" style={dragStyle}>
          <button
            type="button"
            className="splash-close"
            aria-label="Quit Kizuna"
            style={noDragStyle}
            onClick={onQuit}
          >
            &#x2715;
          </button>
          <div className="splash-visual" aria-hidden="true">
            <div className="splash-logo-frame splash-brand">
              <img src={APP_LOGO_URL} alt="" draggable="false" />
            </div>
            <div className="splash-visual-footer">
              <span>MEDIA × LANGUAGE</span>
              <span className="splash-track">
                <i />
                <i />
                <i />
                <i />
                <i />
              </span>
            </div>
          </div>
          <div className="splash-content">
            <div className="splash-heading">
              <h1 id="splash-title">{APP_NAME}</h1>
            </div>

            {message && (
              <p className="splash-error" role="alert">
                {message}
              </p>
            )}

            <div className="splash-choices" aria-label="Start Kizuna">
              <button
                type="button"
                className="splash-choice splash-choice-game-ocr"
                aria-label="Game OCR"
                disabled={!gameOcrSupported || pending !== null}
                style={noDragStyle}
                onClick={() => void run('gameOcr', onGameOcr)}
              >
                <span className="splash-choice-index">01</span>
                <span className="splash-choice-copy">
                  <span>Game OCR</span>
                  <small>{gameOcrSupported ? 'Capture text anywhere' : 'Windows only'}</small>
                </span>
                <span className="splash-choice-arrow" aria-hidden="true">
                  ↗
                </span>
              </button>
              <button
                type="button"
                className="splash-choice splash-choice-player"
                aria-label="Video player"
                disabled={pending !== null}
                style={noDragStyle}
                onClick={() => void run('player', onPlayer)}
              >
                <span className="splash-choice-index">02</span>
                <span className="splash-choice-copy">
                  <span>Video player</span>
                  <small>Watch and learn with subtitles</small>
                </span>
                <span className="splash-choice-arrow" aria-hidden="true">
                  ↗
                </span>
              </button>
              <button
                type="button"
                className="splash-choice splash-choice-options"
                aria-label="Options"
                disabled={pending !== null}
                style={noDragStyle}
                onClick={() => void run('options', onOptions)}
              >
                <span className="splash-choice-index">03</span>
                <span className="splash-choice-copy">
                  <span>Options</span>
                  <small>Configure Kizuna</small>
                </span>
                <span className="splash-choice-arrow" aria-hidden="true">
                  ↗
                </span>
              </button>
            </div>
            <p className="splash-content-footer">PLAY · MINE · REMEMBER</p>
          </div>
        </section>
      </main>
    </div>
  )
}
