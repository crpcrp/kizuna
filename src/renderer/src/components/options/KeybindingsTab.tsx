import { useEffect, useState } from 'react'
import { describeKeyBinding, eventKeyBinding } from '../../state/keyBindings'
import type { KeyBinding, KeyBindings, PlayerKeyAction } from '../../../../shared/playerSettings'
import type { SettingEntry } from './types'

/** Row order and display label for each rebindable action. */
export const ACTION_ROWS: { action: PlayerKeyAction; label: string }[] = [
  { action: 'togglePause', label: 'Play / Pause' },
  { action: 'toggleFullscreen', label: 'Toggle Fullscreen' },
  { action: 'exitFullscreen', label: 'Exit Fullscreen' },
  { action: 'skipBack', label: 'Skip Back' },
  { action: 'skipForward', label: 'Skip Forward' },
  { action: 'speedDown', label: 'Speed down' },
  { action: 'speedUp', label: 'Speed up' },
  { action: 'speedReset', label: 'Reset speed' },
  { action: 'replayLine', label: 'Replay line' },
  { action: 'prevLine', label: 'Previous line' },
  { action: 'nextLine', label: 'Next line' },
  { action: 'loopLine', label: 'Loop line' },
  { action: 'abLoop', label: 'A–B loop' },
  { action: 'frameStep', label: 'Step forward one frame' },
  { action: 'frameBack', label: 'Step back one frame' },
  { action: 'prevFile', label: 'Previous file' },
  { action: 'nextFile', label: 'Next file' },
  { action: 'prevChapter', label: 'Previous chapter' },
  { action: 'nextChapter', label: 'Next chapter' },
  { action: 'screenshot', label: 'Save screenshot' },
  { action: 'miniPlayer', label: 'Mini player' }
]

export const KEYBINDINGS_SETTING_ENTRIES: SettingEntry[] = ACTION_ROWS.map(
  ({ action, label }): SettingEntry => ({
    id: `keybind-${action}`,
    label,
    category: 'keybindings',
    keywords: ['keybinding', 'shortcut', 'hotkey'],
    targetId: `keybind-${action}`
  })
)

export interface KeybindingsTabProps {
  active: boolean
  open: boolean
  keyBindings: KeyBindings
  heldModifiers?: ReadonlySet<string>
  onChangeKeyBinding: (action: PlayerKeyAction, binding: KeyBinding) => void
}

const NO_MODIFIERS: ReadonlySet<string> = new Set()

/** Keyboard shortcut settings and their temporary key-capture state. */
export default function KeybindingsTab({
  active,
  open,
  keyBindings,
  heldModifiers = NO_MODIFIERS,
  onChangeKeyBinding
}: KeybindingsTabProps): React.JSX.Element {
  const [listeningFor, setListeningFor] = useState<PlayerKeyAction | null>(null)

  useEffect(() => {
    if (!open || !listeningFor) return
    const capture = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      const binding = eventKeyBinding(e, heldModifiers)
      if (!binding) return
      onChangeKeyBinding(listeningFor, binding)
      setListeningFor(null)
    }
    window.addEventListener('keydown', capture, true)
    return () => window.removeEventListener('keydown', capture, true)
  }, [open, listeningFor, onChangeKeyBinding, heldModifiers])

  useEffect(() => {
    if (!open) return
    return () => setListeningFor(null)
  }, [open])

  return (
    <section className={active ? 'options-tab active' : 'options-tab'} aria-hidden={!active}>
      <div className="options-section">
        <h3>Keybindings</h3>
        <div className="options-shortcut-grid">
          {ACTION_ROWS.map(({ action, label }) => (
            <div className="options-row options-shortcut-row" key={action}>
              <span className="options-row-label">{label}</span>
              <button
                type="button"
                id={`keybind-${action}`}
                className="options-keybind-button"
                aria-label={`Rebind ${label}`}
                onClick={() => setListeningFor(action)}
              >
                {listeningFor === action ? 'Press a key…' : describeKeyBinding(keyBindings[action])}
              </button>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
