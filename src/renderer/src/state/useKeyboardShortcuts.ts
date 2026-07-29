import { useEffect, type RefObject } from 'react'
import type { KeyBindings } from '../../../shared/playerSettings'
import {
  eventKeyBinding,
  isEditableTarget,
  keyToAction,
  type ModifierTracker
} from '../util/uiHelpers'
import { performKeyAction, type KeyActionDeps } from './playerActions'

export type KeyboardShortcutContext = KeyActionDeps & { keyBindings: KeyBindings }

export interface UseKeyboardShortcutsInput {
  keyContextRef: RefObject<KeyboardShortcutContext | null>
  modifiers: ModifierTracker
  suspended: boolean
}

/** Installs the global player shortcut and modifier-tracking listeners. */
export function useKeyboardShortcuts({
  keyContextRef,
  modifiers,
  suspended
}: UseKeyboardShortcutsInput): void {
  // Which left-side Ctrl/Shift keys are held, for the modifier-prefixed
  // bindings below and for the Options menu's rebind capture (which reads the
  // same set). Kept in its own always-on effect — the shortcut effect below is
  // suspended while a dialog is open, and a tracker that missed those keyups
  // would report keys the user has long released.
  useEffect(() => {
    const tracker = modifiers
    const down = (e: KeyboardEvent): void => tracker.keyDown(e)
    const up = (e: KeyboardEvent): void => tracker.keyUp(e)
    const clear = (): void => tracker.clear()
    window.addEventListener('keydown', down, true)
    window.addEventListener('keyup', up, true)
    window.addEventListener('blur', clear)
    return () => {
      window.removeEventListener('keydown', down, true)
      window.removeEventListener('keyup', up, true)
      window.removeEventListener('blur', clear)
    }
  }, [modifiers])

  // Keyboard shortcuts, per state.keyBindings (user-configurable via the
  // Options menu). The listener reads changing playback context from a ref so
  // timePos updates do not re-register it several times per second.
  useEffect(() => {
    // Suspend global shortcuts while a modal owns the keyboard, so its
    // buttons' Escape/Space don't also reach the player (fullscreen-exit,
    // play/pause) behind it.
    if (suspended) return
    const onKey = (e: KeyboardEvent): void => {
      if (isEditableTarget(e.target)) return
      const context = keyContextRef.current
      if (!context) return
      const binding = eventKeyBinding(e, modifiers.held)
      if (!binding) return
      const action = keyToAction(binding, context.keyBindings)
      if (!action) return
      const preventDefault = performKeyAction(action, context)
      if (preventDefault) e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [keyContextRef, modifiers, suspended])
}
