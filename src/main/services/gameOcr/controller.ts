import type {
  GameOcrRuntimeStatus,
  GameOcrUiState,
  GameOcrWorkerState
} from '../../../shared/gameOcr'
import { normalizeGameOcrShortcut, type GameOcrSettings } from '../../../shared/gameOcrSettings'
import type { OcrDisplayBounds } from '../../../shared/ocr'
import type { PpOcrWorkerService, PpOcrWorkerStatus } from '../ocr/ppOcrWorker'
import type { SettingsStore } from '../settings'
import type { GameOcrCaptureTargets } from './captureTarget'
import { createGameOcrCaptureCoordinator, type GameOcrRecognitionAdapter } from './captureSession'
import type { GameOcrWindow } from './frozenFrameController'
import { createGameOcrShortcutOwner, type GameOcrShortcut } from './shortcuts'

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
  onError?: (message: string, error: unknown) => void
  /**
   * One line per capture describing what was targeted and, when the focused
   * window was not usable, why. Development only; it carries the executable
   * basename and PID, never a full path.
   */
  log?: (message: string) => void
  /** Injected so the key-repeat guard does not depend on a real clock. */
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

  const notify = (next: GameOcrStatus): void => {
    status = next
    const snapshot = { ...next }
    for (const listener of listeners) listener(snapshot)
  }

  const reportError = (message: string, error: unknown): void => {
    try {
      options.onError?.(message, error)
    } catch {
      // Status reporting must not break cancellation or shutdown.
    }
  }

  const log = (message: string): void => {
    try {
      options.log?.(message)
    } catch {
      // Logging must never affect the capture it describes.
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
    onCapture: () => requestCapture(),
    onError: reportError,
    now: options.now ?? (() => Date.now())
  })

  const coordinator = createGameOcrCaptureCoordinator({
    targets: options.targets,
    createPresentation: options.createPresentation,
    ocr: options.ocr,
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
    invalidateDisplayCache,
    holdFrameShortcuts: (handlers) => shortcuts.holdFrame(handlers),
    releaseFrameShortcuts: () => shortcuts.releaseFrame(),
    reportError,
    log
  })

  const requestCapture = (): Promise<void> => {
    if (status.state === 'off' || status.state === 'starting' || status.state === 'error') {
      return Promise.resolve()
    }
    return coordinator.capture()
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
    capture: requestCapture,
    stop,
    shutdown
  }
}

export interface GameOcrRuntimeService {
  getSettings(): GameOcrSettings
  setSettings(patch: Partial<GameOcrSettings>): Promise<GameOcrSettings>
  getStatus(): GameOcrRuntimeStatus
  subscribe(listener: (status: GameOcrRuntimeStatus) => void): () => void
  start(): Promise<GameOcrRuntimeStatus>
  stop(): Promise<GameOcrRuntimeStatus>
  retry(): Promise<GameOcrRuntimeStatus>
  /** Records a worker transition so the Options surface can show progress. */
  updateWorkerStatus(status: PpOcrWorkerStatus): void
  /** Records a non-fatal command/configuration error without disarming. */
  reportError(message: string): void
}

export interface GameOcrRuntimeOptions {
  settings: SettingsStore
  controller: GameOcrController
  worker: Pick<PpOcrWorkerService, 'getStatus'>
  /**
   * Checked before every arm attempt. Returning a message keeps the runtime
   * stopped and reports that message instead of spawning a worker that would
   * fail on a missing or damaged bundled resource. Re-run by `retry`, so
   * restoring the files recovers without a restart.
   */
  preflight?: () => string | undefined
}

const DEFAULT_WORKER_STATUS: PpOcrWorkerStatus = { state: 'stopped' }

/**
 * Joins the persisted shortcut, PP-OCR worker, and coordinator into the
 * small serializable state consumed by the main-window Options surface.
 */
export function createGameOcrRuntimeService(options: GameOcrRuntimeOptions): GameOcrRuntimeService {
  const listeners = new Set<(status: GameOcrRuntimeStatus) => void>()
  let workerStatus = options.worker.getStatus() ?? DEFAULT_WORKER_STATUS
  let nonFatalError: string | undefined

  const currentSettings = (): GameOcrSettings => options.settings.get().gameOcr

  const workerState = (status: PpOcrWorkerStatus): GameOcrWorkerState => {
    if (status.state === 'stopped') return 'not-started'
    return status.state === 'recognizing' ? 'ready' : status.state
  }

  const gameState = (status: GameOcrStatus): GameOcrUiState => {
    if (status.state === 'off') return 'stopped'
    return status.state
  }

  const buildStatus = (): GameOcrRuntimeStatus => {
    const controller = options.controller.getStatus()
    const worker = workerStatus
    return {
      shortcut: currentSettings().captureShortcut,
      ocr: {
        state: workerState(worker),
        ...(worker.error ? { error: worker.error } : {})
      },
      game: {
        state: gameState(controller),
        ...(controller.error || nonFatalError ? { error: controller.error ?? nonFatalError } : {})
      }
    }
  }

  const notify = (): void => {
    const status = buildStatus()
    for (const listener of listeners) listener(status)
  }

  options.controller.subscribe(() => notify())

  const start = async (): Promise<GameOcrRuntimeStatus> => {
    nonFatalError = undefined
    const problem = options.preflight?.()
    if (problem) {
      nonFatalError = problem
      notify()
      return buildStatus()
    }
    await options.controller.arm()
    notify()
    return buildStatus()
  }

  const stop = async (): Promise<GameOcrRuntimeStatus> => {
    nonFatalError = undefined
    await options.controller.stop()
    notify()
    return buildStatus()
  }

  return {
    getSettings: currentSettings,

    async setSettings(patch): Promise<GameOcrSettings> {
      const current = currentSettings()
      const nextShortcut = normalizeGameOcrShortcut(
        patch.captureShortcut ?? current.captureShortcut
      )
      const changed = nextShortcut !== current.captureShortcut
      if (changed && !(await options.controller.setAccelerator(nextShortcut))) {
        nonFatalError = `The Game OCR shortcut is already in use: ${nextShortcut}`
        notify()
        return current
      }
      nonFatalError = undefined
      const updated = options.settings.set({
        gameOcr: { ...current, captureShortcut: nextShortcut }
      }).gameOcr
      notify()
      return updated
    },

    getStatus: buildStatus,

    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    start,
    stop,
    retry: start,

    updateWorkerStatus(status) {
      workerStatus = { ...status }
      notify()
    },

    reportError(message) {
      nonFatalError = message
      notify()
    }
  }
}
