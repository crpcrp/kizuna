export interface GameOcrShortcut {
  register(accelerator: string, callback: () => void): boolean
  unregister(accelerator: string): void
}

// Claim these only while a frame is visible so gameplay keeps its own Escape/Ctrl+C.
const FRAME_ACCELERATORS = Object.freeze({
  dismiss: 'Escape',
  copySelection: 'CommandOrControl+C'
})

/** Suppresses key-repeat callbacks from one held global-shortcut chord. */
const SHORTCUT_REPEAT_GUARD_MS = 250

export interface GameOcrFrameShortcutHandlers {
  dismiss(): void
  copySelection(): void
}

export interface GameOcrShortcutOwnerOptions {
  shortcut: GameOcrShortcut
  accelerator: string
  onCapture: () => Promise<void>
  onError: (message: string, error: unknown) => void
}

export interface GameOcrShortcutOwner {
  readonly accelerator: string
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
    const pressedAt = Date.now()
    if (pressedAt - lastCaptureAt < SHORTCUT_REPEAT_GUARD_MS) return
    lastCaptureAt = pressedAt
    captureInFlight = true
    void options.onCapture().finally(() => {
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

      // Register first so a conflict leaves the existing capture shortcut usable.
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
    // Shortcut conflicts are nonfatal: background dismissal and text selection still work.
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
