/** Electron's globalShortcut surface used by the Game OCR coordinator. */
export interface GameOcrShortcut {
  register(accelerator: string, callback: () => void): boolean
  unregister(accelerator: string): void
}

/**
 * Accelerators the frozen frame needs while it is on screen. The window never
 * takes the Windows foreground — deliberately, so the game keeps rendering and
 * so no first mouse press is spent activating it — which also means its page
 * receives no key events at all. These are registered when a frame appears and
 * released the moment it goes, so Escape and Ctrl+C belong to the game again
 * for as long as the user is playing it.
 */
export const FRAME_ACCELERATORS = Object.freeze({
  dismiss: 'Escape',
  copySelection: 'CommandOrControl+C'
})

/** Suppresses key-repeat callbacks from one held global-shortcut chord. */
const SHORTCUT_REPEAT_GUARD_MS = 250

/** What the frame accelerators do while a frozen frame is visible. */
export interface GameOcrFrameShortcutHandlers {
  dismiss(): void
  copySelection(): void
}

export interface GameOcrShortcutOwnerOptions {
  shortcut: GameOcrShortcut
  accelerator: string
  /** Runs one capture for one physical press of the capture accelerator. */
  onCapture: (pressedAt: number) => Promise<void>
  onError: (message: string, error: unknown) => void
  now: () => number
}

/**
 * Owns every global shortcut Game OCR claims: the capture accelerator with its
 * key-repeat guard, and the Escape/Ctrl+C pair held only while a frozen frame
 * is on screen. Nothing here knows about sessions, capture, or presentation.
 */
export interface GameOcrShortcutOwner {
  readonly accelerator: string
  /** True while the capture accelerator is claimed, so `armed` is honest. */
  readonly captureRegistered: boolean
  registerCapture(): boolean
  unregisterCapture(): void
  /** Replaces the capture accelerator, keeping the old one on conflict. */
  setAccelerator(next: string): boolean
  holdFrame(handlers: GameOcrFrameShortcutHandlers): void
  releaseFrame(): void
}

export function createGameOcrShortcutOwner(
  options: GameOcrShortcutOwnerOptions
): GameOcrShortcutOwner {
  let accelerator = options.accelerator
  let captureRegistered = false
  let frameHeld = false
  let lastCaptureAt = Number.NEGATIVE_INFINITY
  let captureInFlight = false

  const requestCapture = (): void => {
    if (captureInFlight) return
    const pressedAt = options.now()
    if (pressedAt - lastCaptureAt < SHORTCUT_REPEAT_GUARD_MS) return
    lastCaptureAt = pressedAt
    captureInFlight = true
    void options.onCapture(pressedAt).finally(() => {
      captureInFlight = false
    })
  }

  return {
    get accelerator() {
      return accelerator
    },
    get captureRegistered() {
      return captureRegistered
    },
    registerCapture() {
      if (captureRegistered) return true
      if (!options.shortcut.register(accelerator, requestCapture)) return false
      lastCaptureAt = Number.NEGATIVE_INFINITY
      captureInFlight = false
      captureRegistered = true
      return true
    },
    unregisterCapture() {
      if (!captureRegistered) return
      captureRegistered = false
      captureInFlight = false
      try {
        options.shortcut.unregister(accelerator)
      } catch (error) {
        options.onError('Game OCR shortcut cleanup failed.', error)
      }
    },
    setAccelerator(next) {
      if (next === accelerator) return true
      if (!captureRegistered) {
        accelerator = next
        return true
      }

      // Register the replacement first. If Electron reports a conflict, the
      // existing shortcut remains active and the caller can keep persisted
      // settings aligned with that usable state.
      if (!options.shortcut.register(next, requestCapture)) {
        options.onError(
          `The Game OCR shortcut is already in use: ${next}`,
          new Error('Shortcut conflict.')
        )
        return false
      }
      lastCaptureAt = Number.NEGATIVE_INFINITY

      const previous = accelerator
      accelerator = next
      try {
        options.shortcut.unregister(previous)
      } catch (error) {
        options.onError('Game OCR shortcut cleanup failed.', error)
      }
      return true
    },
    /**
     * Claimed only while a frame is visible. A refusal is not fatal: another
     * application already owns the accelerator, and the frame stays usable
     * without it — a background press still dismisses, and the box text can
     * still be selected — so this reports and carries on rather than failing a
     * capture the user can see.
     */
    holdFrame(handlers) {
      if (frameHeld) return
      frameHeld = true
      try {
        if (!options.shortcut.register(FRAME_ACCELERATORS.dismiss, handlers.dismiss)) {
          options.onError(
            `The Game OCR frame could not claim ${FRAME_ACCELERATORS.dismiss}; press the screenshot background to close it.`,
            new Error('Shortcut conflict.')
          )
        }
        if (!options.shortcut.register(FRAME_ACCELERATORS.copySelection, handlers.copySelection)) {
          options.onError(
            `The Game OCR frame could not claim ${FRAME_ACCELERATORS.copySelection}; copying selected text is unavailable.`,
            new Error('Shortcut conflict.')
          )
        }
      } catch (error) {
        options.onError('Game OCR frame shortcut registration failed.', error)
      }
    },
    releaseFrame() {
      if (!frameHeld) return
      frameHeld = false
      for (const held of Object.values(FRAME_ACCELERATORS)) {
        try {
          options.shortcut.unregister(held)
        } catch (error) {
          options.onError('Game OCR frame shortcut cleanup failed.', error)
        }
      }
    }
  }
}
