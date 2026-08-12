import { useEffect, useState } from 'react'
import {
  gameOcrShortcutFromKeyboardEvent,
  type GameOcrSettings
} from '../../../../shared/gameOcrSettings'
import type {
  GameOcrWorkerState,
  GameOcrRuntimeStatus,
  GameOcrUiState
} from '../../../../shared/gameOcr'
import type { SettingEntry } from './types'

export interface GameOcrTabProps {
  active: boolean
  open: boolean
  settings: GameOcrSettings
  status: GameOcrRuntimeStatus
  onChangeShortcut: (shortcut: string) => void
  onStart: () => void
  onStop: () => void
  onRetry: () => void
}

export const GAME_OCR_SETTING_ENTRIES: SettingEntry[] = [
  {
    id: 'game-ocr-overview',
    label: 'Game OCR (Experimental)',
    category: 'gameOcr',
    keywords: ['ocr', 'screen', 'capture', 'display', 'experimental']
  },
  {
    id: 'game-ocr-privacy',
    label: 'Game OCR privacy and translation',
    category: 'gameOcr',
    keywords: ['privacy', 'local', 'pp-ocr', 'onnx', 'online', 'translator']
  },
  {
    id: 'game-ocr-shortcut',
    label: 'Game OCR capture shortcut',
    category: 'gameOcr',
    keywords: ['shortcut', 'hotkey', 'global', 'capture'],
    targetId: 'game-ocr-shortcut'
  },
  {
    id: 'game-ocr-worker-status',
    label: 'PP-OCR / ONNX Runtime status',
    category: 'gameOcr',
    keywords: ['pp-ocr', 'onnx', 'ocr', 'model', 'worker', 'ready']
  },
  {
    id: 'game-ocr-status',
    label: 'Game OCR status',
    category: 'gameOcr',
    keywords: ['ocr', 'armed', 'capturing', 'recognizing', 'inspecting', 'stopped']
  },
  {
    id: 'game-ocr-start',
    label: 'Start Game OCR',
    category: 'gameOcr',
    keywords: ['start', 'arm', 'register'],
    targetId: 'game-ocr-start'
  },
  {
    id: 'game-ocr-stop',
    label: 'Stop Game OCR',
    category: 'gameOcr',
    keywords: ['stop', 'disarm'],
    targetId: 'game-ocr-stop'
  },
  {
    id: 'game-ocr-retry',
    label: 'Retry Game OCR',
    category: 'gameOcr',
    keywords: ['retry', 'error', 'model', 'shortcut'],
    targetId: 'game-ocr-retry'
  }
]

const OCR_WORKER_LABELS: Record<GameOcrWorkerState, string> = {
  'not-started': 'Not started',
  starting: 'Starting…',
  ready: 'Ready',
  error: 'Error'
}

const GAME_LABELS: Record<GameOcrUiState, string> = {
  stopped: 'Stopped',
  starting: 'Starting…',
  armed: 'Armed',
  capturing: 'Capturing…',
  recognizing: 'Recognizing…',
  inspecting: 'Inspecting',
  error: 'Error'
}

function badgeClass(state: string): string {
  if (state === 'ready') return 'state-badge ready'
  if (state === 'error') return 'state-badge error'
  return 'state-badge unknown'
}

/** Windows-only settings and lifecycle controls for the experimental OCR flow. */
export default function GameOcrTab({
  active,
  open,
  settings,
  status,
  onChangeShortcut,
  onStart,
  onStop,
  onRetry
}: GameOcrTabProps): React.JSX.Element {
  const [listening, setListening] = useState(false)

  useEffect(() => {
    if (!open || !listening) return
    const capture = (event: KeyboardEvent): void => {
      event.preventDefault()
      event.stopPropagation()
      if (event.code === 'Escape') {
        setListening(false)
        return
      }
      const shortcut = gameOcrShortcutFromKeyboardEvent(event)
      if (!shortcut) return
      onChangeShortcut(shortcut)
      setListening(false)
    }
    window.addEventListener('keydown', capture, true)
    return () => window.removeEventListener('keydown', capture, true)
  }, [listening, onChangeShortcut, open])

  useEffect(() => {
    if (!open) return
    return () => setListening(false)
  }, [open])

  const errors = [status.ocr.error, status.game.error].filter(
    (message, index, all): message is string => Boolean(message) && all.indexOf(message) === index
  )
  const gameStopped = status.game.state === 'stopped'
  const canStart = gameStopped || status.game.state === 'error'

  return (
    <section className={active ? 'options-tab active' : 'options-tab'} aria-hidden={!active}>
      <div className="options-section">
        <h3 id="game-ocr-overview">Game OCR (Experimental)</h3>
        <p className="options-description" id="game-ocr-privacy">
          The display under the mouse is captured and temporarily covered with a frozen frame while
          Japanese text is recognized.
        </p>
        <p className="options-hint">
          PP-OCR and ONNX Runtime run locally. Only text you explicitly select for translation is
          sent to the existing online translator.
        </p>
        <div className="options-row options-shortcut-row">
          <span className="options-row-label">
            Capture shortcut
            <span className="options-row-description">
              A global shortcut used while Game OCR is armed.
            </span>
          </span>
          <button
            type="button"
            id="game-ocr-shortcut"
            className="options-keybind-button"
            aria-label="Rebind Game OCR capture shortcut"
            onClick={() => setListening(true)}
          >
            {listening ? 'Press a key…' : settings.captureShortcut}
          </button>
        </div>
      </div>

      <div className="options-section">
        <h3>Status</h3>
        <div className="options-row" id="game-ocr-worker-status">
          <span className="options-row-label">PP-OCR / ONNX Runtime</span>
          <span className={badgeClass(status.ocr.state)}>
            {OCR_WORKER_LABELS[status.ocr.state]}
          </span>
        </div>
        <div className="options-row" id="game-ocr-status">
          <span className="options-row-label">Game OCR</span>
          <span className={badgeClass(status.game.state)}>{GAME_LABELS[status.game.state]}</span>
        </div>
        {errors.length > 0 && (
          <div className="options-status-actions" role="alert" id="game-ocr-errors">
            {errors.map((message) => (
              <p className="options-error" key={message}>
                {message}
              </p>
            ))}
            <button type="button" className="options-button" id="game-ocr-retry" onClick={onRetry}>
              Retry
            </button>
          </div>
        )}
      </div>

      <div className="options-section">
        <h3>Controls</h3>
        <div className="options-row options-actions-row">
          <button
            type="button"
            className="options-button"
            id="game-ocr-start"
            disabled={!canStart}
            onClick={onStart}
          >
            Start Game OCR
          </button>
          <button
            type="button"
            className="options-button"
            id="game-ocr-stop"
            disabled={gameStopped}
            onClick={onStop}
          >
            Stop Game OCR
          </button>
        </div>
      </div>
    </section>
  )
}
