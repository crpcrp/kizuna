import type { GameOcrRuntimeStatus } from '../../../shared/gameOcr'
import type { GameOcrRuntimeService } from './runtime'

export interface GameOcrBackgroundWindow {
  hide(): void
  activate(): void
}

export interface GameOcrWindowCloseEvent {
  preventDefault(): void
}

export interface GameOcrTrayActions {
  show(): void
  stop(): void
  quit(): void
}

export interface GameOcrTray {
  setToolTip(toolTip: string): void
  destroy(): void
}

export interface GameOcrTrayFactory {
  create(actions: GameOcrTrayActions): GameOcrTray
}

export interface GameOcrBackgroundLifecycleOptions {
  runtime: Pick<GameOcrRuntimeService, 'getStatus' | 'subscribe'> & {
    stop(): Promise<unknown>
  }
  window: GameOcrBackgroundWindow
  tray: GameOcrTrayFactory
  quit: () => void
}

export interface GameOcrBackgroundLifecycle {
  /** Returns false when the native close must be prevented. */
  handleWindowClose(event: GameOcrWindowCloseEvent): boolean
  /** Stops cleanly if the main renderer/native window is no longer usable. */
  handleWindowLost(): void
  stop(): Promise<void>
  dispose(): void
}

const ARMED_STATES = new Set<GameOcrRuntimeStatus['game']['state']>([
  'armed',
  'capturing',
  'recognizing',
  'inspecting'
])
const TRAY_TOOLTIP = 'Kizuna — Game OCR armed'

/**
 * Keeps the normal player window and the Windows tray in sync with Game OCR.
 * Electron surfaces are injected so the lifecycle can be tested without a
 * native tray or BrowserWindow.
 */
export function createGameOcrBackgroundLifecycle(
  options: GameOcrBackgroundLifecycleOptions
): GameOcrBackgroundLifecycle {
  let tray: GameOcrTray | undefined
  let wasArmed = false
  let disposed = false
  let stopPromise: Promise<void> | undefined

  const reportSurfaceFailure = (action: () => void): void => {
    try {
      action()
    } catch {
      // A window or tray can disappear during shutdown. Cleanup must continue.
    }
  }

  const activateWindow = (): void => {
    if (disposed) return
    reportSurfaceFailure(() => options.window.activate())
  }

  const hideWindow = (): void => {
    if (disposed) return
    reportSurfaceFailure(() => options.window.hide())
  }

  const destroyTray = (): void => {
    const current = tray
    tray = undefined
    if (!current) return
    reportSurfaceFailure(() => current.destroy())
  }

  const stop = (): Promise<void> => {
    if (stopPromise) return stopPromise
    if (options.runtime.getStatus().game.state === 'stopped' && !tray) {
      return Promise.resolve()
    }

    const wasActiveBeforeStop = wasArmed
    const operation = (async (): Promise<void> => {
      try {
        await options.runtime.stop()
      } finally {
        if (wasActiveBeforeStop && wasArmed) activateWindow()
        destroyTray()
        wasArmed = false
      }
    })()
    const tracked = operation.finally(() => {
      if (stopPromise === tracked) stopPromise = undefined
    })
    stopPromise = tracked
    return tracked
  }

  const actions: GameOcrTrayActions = {
    show: activateWindow,
    stop: () => {
      void stop()
    },
    quit: options.quit
  }

  const createTray = (): void => {
    if (tray || disposed) return
    try {
      tray = options.tray.create(actions)
      tray.setToolTip(TRAY_TOOLTIP)
    } catch {
      destroyTray()
      activateWindow()
      void stop()
    }
  }

  const sync = (status: GameOcrRuntimeStatus): void => {
    if (disposed) return
    try {
      const armed = ARMED_STATES.has(status.game.state)
      if (armed) {
        createTray()
        if (!wasArmed) hideWindow()
      } else {
        if (wasArmed) activateWindow()
        destroyTray()
      }
      wasArmed = armed
    } catch {
      // A status listener must not break the runtime command that emitted it.
      activateWindow()
      void stop()
    }
  }

  const unsubscribe = options.runtime.subscribe(sync)
  sync(options.runtime.getStatus())

  return {
    handleWindowClose(event): boolean {
      if (!ARMED_STATES.has(options.runtime.getStatus().game.state)) return true
      reportSurfaceFailure(() => event.preventDefault())
      hideWindow()
      return false
    },

    handleWindowLost(): void {
      if (!ARMED_STATES.has(options.runtime.getStatus().game.state)) return
      void stop().then(options.quit, options.quit)
    },

    stop,

    dispose(): void {
      if (disposed) return
      disposed = true
      unsubscribe()
      wasArmed = false
      destroyTray()
    }
  }
}

export { TRAY_TOOLTIP }
