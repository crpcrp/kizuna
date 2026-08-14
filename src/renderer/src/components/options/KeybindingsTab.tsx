import { useEffect, useState } from 'react'
import {
  describeKeyBinding,
  eventKeyBinding,
  findKeyBindingConflicts,
  wheelEventKeyBinding
} from '../../state/keyBindings'
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
  { action: 'miniPlayer', label: 'Mini player' },
  { action: 'subtitleFontScaleUp', label: 'Increase subtitle size by 10%' },
  { action: 'subtitleFontScaleDown', label: 'Decrease subtitle size by 10%' }
]

/** Actions whose row also accepts a directional mouse-wheel gesture. */
const WHEEL_BINDABLE_ACTIONS: ReadonlySet<PlayerKeyAction> = new Set([
  'subtitleFontScaleUp',
  'subtitleFontScaleDown'
])

export const KEYBINDINGS_SETTING_ENTRIES: SettingEntry[] = ACTION_ROWS.map(
  ({ action, label }): SettingEntry => ({
    id: `keybind-${action}`,
    label,
    category: 'keybindings',
    keywords: ['keybinding', 'shortcut', 'hotkey'],
    targetId: `keybind-${action}`
  })
)

const ACTION_LABELS = new Map(ACTION_ROWS.map(({ action, label }) => [action, label]))

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
  const conflicts = findKeyBindingConflicts(keyBindings)

  useEffect(() => {
    if (!open || !listeningFor) return
    const wheelBindable = WHEEL_BINDABLE_ACTIONS.has(listeningFor)
    const captureKey = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      if (wheelBindable && e.code === 'Escape') {
        setListeningFor(null)
        return
      }
      const binding = eventKeyBinding(e, heldModifiers)
      if (!binding) return
      onChangeKeyBinding(listeningFor, binding)
      setListeningFor(null)
    }
    // Only a gesture that actually rebinds is consumed, so an ignored wheel
    // event still scrolls the Options panel as usual.
    const captureWheel = (e: WheelEvent): void => {
      const binding = wheelEventKeyBinding(e, heldModifiers)
      if (!binding) return
      e.preventDefault()
      e.stopPropagation()
      onChangeKeyBinding(listeningFor, binding)
      setListeningFor(null)
    }
    window.addEventListener('keydown', captureKey, true)
    if (wheelBindable) {
      window.addEventListener('wheel', captureWheel, { capture: true, passive: false })
    }
    return () => {
      window.removeEventListener('keydown', captureKey, true)
      window.removeEventListener('wheel', captureWheel, true)
    }
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
              <div className="options-keybind-control">
                <button
                  type="button"
                  id={`keybind-${action}`}
                  className="options-keybind-button"
                  aria-label={`Rebind ${label}`}
                  aria-describedby={conflicts.has(action) ? `keybind-${action}-warning` : undefined}
                  onClick={() => setListeningFor(action)}
                >
                  {listeningFor === action
                    ? WHEEL_BINDABLE_ACTIONS.has(action)
                      ? 'Press a key or scroll…'
                      : 'Press a key…'
                    : describeKeyBinding(keyBindings[action])}
                </button>
                {conflicts.has(action) && (
                  <p
                    className="options-keybind-warning"
                    id={`keybind-${action}-warning`}
                    role="alert"
                  >
                    This keybinding is already used by{' '}
                    {conflicts
                      .get(action)
                      ?.map((conflictingAction) => ACTION_LABELS.get(conflictingAction))
                      .join(', ')}
                    .
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
