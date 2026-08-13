import type { OcrDisplayBounds, OcrResult } from '../../../shared/ocr'
import type { GameOcrCaptureTargets } from './captureTarget'
import { createGameOcrCaptureCoordinator, type GameOcrRecognitionAdapter } from './captureSession'
import type { GameOcrCaptureTimings } from './captureTimings'
import type { GameOcrWindow } from './frozenFrameWindow'
import { createGameOcrShortcutOwner, type GameOcrShortcut } from './shortcuts'

export { writeGameOcrTotalTime, type GameOcrCaptureTimings } from './captureTimings'
export type { GameOcrRecognitionAdapter } from './captureSession'
export type { GameOcrShortcut } from './shortcuts'

export type GameOcrState =
  'off' | 'starting' | 'armed' | 'capturing' | 'recognizing' | 'inspecting' | 'error'

export interface GameOcrStatus {
  state: GameOcrState
  sessionId: number
  error?: string
}

export interface GameOcrControllerOptions {
  shortcut: GameOcrShortcut
  accelerator: string
  /** Resolves the focused window, or the display under the pointer. */
  targets: GameOcrCaptureTargets
  /** Builds the frozen-frame window over the given logical desktop rectangle. */
  createPresentation: (bounds: OcrDisplayBounds) => GameOcrWindow
  ocr: GameOcrRecognitionAdapter
  /** Clears renderer-side token, lookup, popup, and translation work. */
  invalidateResults?: () => void
  onResult?: (result: OcrResult) => void
  onStateChange?: (status: GameOcrStatus) => void
  onError?: (message: string, error: unknown) => void
  /** Per-capture stage costs, for the development latency log. */
  onTimings?: (timings: GameOcrCaptureTimings) => void
  /**
   * One line per capture describing what was targeted and, when the focused
   * window was not usable, why. Development only; it carries the executable
   * basename and PID, never a full path.
   */
  onDiagnostic?: (message: string) => void
  /** Injected so timing assertions do not depend on a real clock. */
  now?: () => number
}

export interface GameOcrController {
  getStatus(): GameOcrStatus
  subscribe(listener: (status: GameOcrStatus) => void): () => void
  arm(): Promise<boolean>
  /** Changes the global shortcut, retaining the old registration on conflict. */
  setAccelerator(accelerator: string): Promise<boolean>
  /** Handles one configured global-shortcut press. Useful for tests and IPC. */
  capture(): Promise<void>
  stop(): Promise<void>
  shutdown(): Promise<void>
}

/**
 * The Game OCR lifecycle facade. It owns arming, stopping, and the published
 * status, and composes the two boundaries it does not implement: the shortcut
 * owner (`shortcuts.ts`) and the capture coordinator (`captureSession.ts`).
 */
export function createGameOcrController(options: GameOcrControllerOptions): GameOcrController {
  let status: GameOcrStatus = { state: 'off', sessionId: 0 }
  const listeners = new Set<(next: GameOcrStatus) => void>()
  let lifecycle = 0
  let armPromise: Promise<boolean> | undefined
  let stopping = false
  const now = options.now ?? (() => Date.now())

  const notify = (next: GameOcrStatus): void => {
    status = next
    const snapshot = { ...next }
    options.onStateChange?.(snapshot)
    for (const listener of listeners) listener(snapshot)
  }

  const reportError = (message: string, error: unknown): void => {
    try {
      options.onError?.(message, error)
    } catch {
      // Status reporting must not break cancellation or shutdown.
    }
  }

  const reportDiagnostic = (message: string): void => {
    try {
      options.onDiagnostic?.(message)
    } catch {
      // Diagnostics must never affect the capture they describe.
    }
  }

  const reportTimings = (timings: GameOcrCaptureTimings): void => {
    try {
      options.onTimings?.(timings)
    } catch {
      // Measurement must never affect the pipeline it measures.
    }
  }

  const invalidateResults = (): void => {
    try {
      options.invalidateResults?.()
    } catch (error) {
      reportError('Game OCR result invalidation failed.', error)
    }
  }

  const invalidateDisplayCache = (): void => {
    try {
      options.targets.invalidate()
    } catch (error) {
      reportError('Game OCR display cache cleanup failed.', error)
    }
  }

  const isRunning = (): boolean => !stopping && status.state !== 'off'

  const fail = (message: string, error: unknown, sessionId = status.sessionId): void => {
    shortcuts.releaseFrame()
    shortcuts.unregisterCapture()
    reportError(message, error)
    notify({ state: 'error', sessionId, error: message })
  }

  const shortcuts = createGameOcrShortcutOwner({
    shortcut: options.shortcut,
    accelerator: options.accelerator,
    onCapture: (pressedAt) => requestCapture(pressedAt),
    onError: reportError,
    now
  })

  const coordinator = createGameOcrCaptureCoordinator({
    targets: options.targets,
    createPresentation: options.createPresentation,
    ocr: options.ocr,
    now,
    isRunning,
    onStateChange: (state, sessionId) => notify({ state, sessionId }),
    onFailure: fail,
    onFrameEnded: () => {
      // Only a still-registered hotkey means armed. A failure released the
      // shortcut on its way into `error`, and reporting armed there would both
      // mislead the Options surface and let `arm`'s fast path decline to
      // register the shortcut again.
      if (isRunning() && shortcuts.captureRegistered)
        notify({ state: 'armed', sessionId: status.sessionId })
    },
    onSessionInvalidated: () => {
      lifecycle++
    },
    invalidateResults,
    invalidateDisplayCache,
    holdFrameShortcuts: (handlers) => shortcuts.holdFrame(handlers),
    releaseFrameShortcuts: () => shortcuts.releaseFrame(),
    reportError,
    reportDiagnostic,
    reportTimings,
    onResult: options.onResult
  })

  const requestCapture = (startedAt: number = now()): Promise<void> => {
    if (status.state === 'off' || status.state === 'starting' || status.state === 'error') {
      return Promise.resolve()
    }
    return coordinator.capture(startedAt)
  }

  const arm = (): Promise<boolean> => {
    if (
      shortcuts.captureRegistered &&
      (status.state === 'armed' ||
        status.state === 'capturing' ||
        status.state === 'recognizing' ||
        status.state === 'inspecting')
    ) {
      return Promise.resolve(true)
    }
    if (armPromise) return armPromise

    stopping = false
    const armLifecycle = ++lifecycle
    notify({ state: 'starting', sessionId: status.sessionId })
    const operation = (async (): Promise<boolean> => {
      try {
        await options.ocr.start?.()
        if (armLifecycle !== lifecycle || stopping) return false
        if (!shortcuts.registerCapture()) {
          throw new Error(`The Game OCR shortcut is already in use: ${shortcuts.accelerator}`)
        }
        notify({ state: 'armed', sessionId: status.sessionId })
        return true
      } catch (error) {
        shortcuts.unregisterCapture()
        await options.ocr.stop().catch((stopError) => {
          reportError('Game OCR worker cleanup failed.', stopError)
        })
        if (armLifecycle === lifecycle && !stopping) {
          fail('Game OCR could not be armed.', error)
        }
        return false
      }
    })()
    const tracked = operation.finally(() => {
      if (armPromise === tracked) armPromise = undefined
    })
    armPromise = tracked
    return tracked
  }

  const stop = async (): Promise<void> => {
    stopping = true
    lifecycle++
    coordinator.invalidate()
    shortcuts.releaseFrame()
    shortcuts.unregisterCapture()
    // Releases cached desktop source ids and immutable display targets. The
    // adapter remains reusable if Game OCR is armed again later.
    invalidateDisplayCache()
    const close = coordinator.close()
    await Promise.allSettled([close, options.ocr.stop(), armPromise])
    notify({ state: 'off', sessionId: status.sessionId })
    stopping = false
  }

  /**
   * Stopping keeps the native foreground boundary loaded, because arming
   * again is the ordinary next thing to happen and reloading it is not free.
   * Only application shutdown releases it.
   */
  const shutdown = async (): Promise<void> => {
    await stop()
    try {
      options.targets.dispose()
    } catch (error) {
      reportError('Game OCR capture target cleanup failed.', error)
    }
  }

  return {
    getStatus: () => ({ ...status }),
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    arm,
    setAccelerator: (next) => Promise.resolve(shortcuts.setAccelerator(next)),
    capture: () => requestCapture(),
    stop,
    shutdown
  }
}
