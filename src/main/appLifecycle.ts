// App-quit wiring. Split out from index.ts so it's unit-testable with fakes
// instead of a live Electron session/controller.

/** Electron does not await the `before-quit` listener, so only this subset is needed. */
export interface PreventableQuitEvent {
  preventDefault(): void
}

/** Subset of Electron's Session used on quit. */
export interface FlushableSession {
  flushStorageData(): void
}

/** Subset of MpvController used on quit. */
export interface QuittableController {
  quit(): Promise<void>
  dispose(): void
}

/** Maximum time to wait for asynchronous shutdown work before forcing teardown. */
export const SHUTDOWN_TIMEOUT_MS = 2_000

export type SetTimeoutFn = (callback: () => void, delayMs: number) => unknown
export type ClearTimeoutFn = (handle: unknown) => void

export interface QuitCoordinatorDeps {
  defaultSession: FlushableSession
  controller: QuittableController
  flushHistory?: () => void
  releasePowerSave?: () => void
  disposeSystemMedia?: () => void
  cleanupUrlSubtitles?: () => Promise<void>
  appQuit: () => void
  setTimeoutFn?: SetTimeoutFn
  clearTimeoutFn?: ClearTimeoutFn
  onError?: (operation: string, error: unknown) => void
  onShutdownStart?: () => void
}

export type QuitHandler = (event: PreventableQuitEvent) => void

export interface AppLifecycleCoordinator {
  handleBeforeQuit: QuitHandler
  /** Runs the normal shutdown sequence before invoking an explicit installer. */
  prepareForInstall(install: () => void): Promise<void>
}

function defaultOnError(operation: string, error: unknown): void {
  console.error(`[kizuna] ${operation} failed during shutdown`, error)
}

/**
 * Coordinates Electron shutdown without relying on Electron to await an event
 * listener. The returned handler is safe to register directly with
 * `app.on('before-quit', ...)`.
 */
export function createAppLifecycleCoordinator(deps: QuitCoordinatorDeps): AppLifecycleCoordinator {
  const flushHistory = deps.flushHistory ?? (() => {})
  const releasePowerSave = deps.releasePowerSave ?? (() => {})
  const disposeSystemMedia = deps.disposeSystemMedia ?? (() => {})
  const cleanupUrlSubtitles = deps.cleanupUrlSubtitles ?? (async () => {})
  const setTimeoutFn = deps.setTimeoutFn ?? ((callback, delayMs) => setTimeout(callback, delayMs))
  const clearTimeoutFn =
    deps.clearTimeoutFn ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>))
  const onError = deps.onError ?? defaultOnError

  let shutdownStarted = false
  let shutdownAllowed = false
  let hardDisposed = false
  let continuationCalled = false
  let continuation: () => void = deps.appQuit
  let shutdownPromise: Promise<void> | undefined

  const reportFailure = (operation: string, error: unknown): void => {
    try {
      onError(operation, error)
    } catch {
      // Logging must never create another unhandled shutdown failure.
    }
  }

  const runSafely = (operation: string, action: () => void): void => {
    try {
      action()
    } catch (error) {
      reportFailure(operation, error)
    }
  }

  const startAsync = (action: () => Promise<void>): Promise<void> => {
    try {
      return Promise.resolve(action())
    } catch (error) {
      // The rejected promise is consumed by Promise.allSettled below, which
      // reports the failure exactly once with the other async outcomes.
      return Promise.reject(error)
    }
  }

  const disposeHard = (): void => {
    if (hardDisposed) return
    hardDisposed = true
    runSafely('mpv hard disposal', () => deps.controller.dispose())
  }

  const finishShutdown = (): void => {
    if (shutdownAllowed) return
    shutdownAllowed = true
    if (continuationCalled) return
    continuationCalled = true
    runSafely(continuation === deps.appQuit ? 'app.quit' : 'update installation', continuation)
  }

  const startShutdown = (next: () => void): Promise<void> => {
    if (shutdownPromise) return shutdownPromise
    shutdownStarted = true
    continuation = next
    runSafely('shutdown notification', () => deps.onShutdownStart?.())

    // Keep the existing synchronous order: release media surfaces, then the
    // power-save blocker, then flush history and renderer storage.
    runSafely('system-media disposal', disposeSystemMedia)
    runSafely('power-save release', releasePowerSave)

    // Start URL cleanup at its existing position, but let it run alongside
    // the controller quit so either rejection cannot prevent the other.
    const urlCleanup = startAsync(cleanupUrlSubtitles)
    runSafely('history flush', flushHistory)
    runSafely('session storage flush', () => deps.defaultSession.flushStorageData())
    const controllerQuit = startAsync(() => deps.controller.quit())
    const cleanup = Promise.allSettled([urlCleanup, controllerQuit])
    const timer = setTimeoutFn(() => {
      disposeHard()
      finishShutdown()
    }, SHUTDOWN_TIMEOUT_MS)

    shutdownPromise = cleanup.then((results) => {
      const operations = ['URL-subtitle cleanup', 'mpv quit']
      for (const [index, result] of results.entries()) {
        if (result.status === 'rejected') reportFailure(operations[index], result.reason)
      }
      if (shutdownAllowed) return
      clearTimeoutFn(timer)
      finishShutdown()
    })
    return shutdownPromise
  }

  const handleBeforeQuit = (event: PreventableQuitEvent): void => {
    if (shutdownAllowed) return
    event.preventDefault()
    if (shutdownStarted) return
    void startShutdown(deps.appQuit)
  }

  return {
    handleBeforeQuit,
    prepareForInstall(install) {
      return startShutdown(install)
    }
  }
}

/** Backward-compatible handler factory for callers that only need normal quit. */
export function createQuitCoordinator(deps: QuitCoordinatorDeps): QuitHandler {
  return createAppLifecycleCoordinator(deps).handleBeforeQuit
}
