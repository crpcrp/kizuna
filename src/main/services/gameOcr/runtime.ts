import type {
  GameOcrRuntimeStatus,
  GameOcrPaddleState,
  GameOcrUiState
} from '../../../shared/gameOcr'
import { normalizeGameOcrShortcut, type GameOcrSettings } from '../../../shared/gameOcrSettings'
import type { GameOcrController, GameOcrStatus as ControllerStatus } from './controller'
import type { PaddleOcrWorkerService, PaddleOcrWorkerStatus } from '../ocr/paddleWorker'
import type { SettingsStore } from '../settings'

export interface GameOcrRuntimeService {
  getSettings(): GameOcrSettings
  setSettings(patch: Partial<GameOcrSettings>): Promise<GameOcrSettings>
  getStatus(): GameOcrRuntimeStatus
  subscribe(listener: (status: GameOcrRuntimeStatus) => void): () => void
  start(): Promise<GameOcrRuntimeStatus>
  stop(): Promise<GameOcrRuntimeStatus>
  retry(): Promise<GameOcrRuntimeStatus>
  /** Records a worker transition so the Options surface can show progress. */
  updateWorkerStatus(status: PaddleOcrWorkerStatus): void
  /** Records a non-fatal command/configuration error without disarming. */
  reportError(message: string): void
}

export interface GameOcrRuntimeOptions {
  settings: SettingsStore
  controller: GameOcrController
  worker: Pick<PaddleOcrWorkerService, 'getStatus'>
  /**
   * Checked before every arm attempt. Returning a message keeps the runtime
   * stopped and reports that message instead of spawning a worker that would
   * fail on a missing or damaged bundled resource. Re-run by `retry`, so
   * restoring the files recovers without a restart.
   */
  preflight?: () => string | undefined
}

const DEFAULT_WORKER_STATUS: PaddleOcrWorkerStatus = { state: 'stopped' }

/**
 * Joins the persisted shortcut, PP-OCR worker, and coordinator into the
 * small serializable state consumed by the main-window Options surface.
 */
export function createGameOcrRuntimeService(options: GameOcrRuntimeOptions): GameOcrRuntimeService {
  const listeners = new Set<(status: GameOcrRuntimeStatus) => void>()
  let workerStatus = options.worker.getStatus() ?? DEFAULT_WORKER_STATUS
  let nonFatalError: string | undefined

  const currentSettings = (): GameOcrSettings => options.settings.get().gameOcr

  const workerState = (status: PaddleOcrWorkerStatus): GameOcrPaddleState => {
    if (status.state === 'stopped') return 'not-started'
    return status.state === 'recognizing' ? 'ready' : status.state
  }

  const gameState = (status: ControllerStatus): GameOcrUiState => {
    if (status.state === 'off') return 'stopped'
    return status.state
  }

  const buildStatus = (): GameOcrRuntimeStatus => {
    const controller = options.controller.getStatus()
    const worker = workerStatus
    return {
      shortcut: currentSettings().captureShortcut,
      paddle: {
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
