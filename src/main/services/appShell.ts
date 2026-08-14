import type { AppSurface } from '../../shared/appShell'

export type OptionsPresentationOrigin = 'startup' | 'gameOcr'

export interface AppShellCoordinatorDeps {
  /** The surface selected by the composition root for this window. */
  initialSurface: AppSurface
  /** Starts the one process-lifetime player runtime. */
  ensurePlayerStarted(): Promise<unknown>
  /** Presents only the renderer-owning overlay. */
  presentSplash(): void | Promise<void>
  /** Presents the full logical window set for the player. */
  presentPlayer(): void | Promise<void>
  /** Presents the full logical window set for Options. */
  presentOptions(): void | Promise<void>
  /** Hides Options opened from the armed Game OCR lifecycle. */
  dismissGameOcrOptions(): boolean | Promise<boolean>
  /** Pushes a changed surface to the renderer. */
  sendSurfaceChanged(surface: AppSurface): void
  /** Requests the normal Electron quit path. */
  quit(): void
}

export interface AppShellCoordinator {
  getSurface(): AppSurface
  showSplash(): Promise<AppSurface>
  showPlayer(): Promise<AppSurface>
  showOptions(origin?: OptionsPresentationOrigin): Promise<AppSurface>
  dismissOptions(): Promise<AppSurface>
  quit(): void
}

/**
 * Owns the renderer-visible surface and the native presentation ordering.
 * Player startup is shared separately from surface requests, so a racing
 * player/options pair still has one bootstrap and one final presentation.
 */
export function createAppShellCoordinator(deps: AppShellCoordinatorDeps): AppShellCoordinator {
  let surface = deps.initialSurface
  let optionsOrigin: OptionsPresentationOrigin = 'startup'
  let presentedSurface: AppSurface | undefined
  let playerStart: Promise<unknown> | undefined
  let requestedSurface: AppSurface | undefined
  let requestedOptionsOrigin: OptionsPresentationOrigin | undefined
  let requestVersion = 0
  let transition: Promise<void> | undefined
  let optionsDismissal: Promise<AppSurface> | undefined
  let quitRequested = false

  const presenterFor = (next: AppSurface): (() => void | Promise<void>) => {
    if (next === 'splash') return deps.presentSplash
    if (next === 'options') return deps.presentOptions
    return deps.presentPlayer
  }

  if (surface !== 'player') {
    const initialSurface = surface
    try {
      // Initial presentation can be asynchronous. Consume failures here so a
      // window teardown cannot become an unhandled main-process rejection.
      const result = presenterFor(initialSurface)()
      presentedSurface = initialSurface
      if (result) {
        void result.catch(() => {
          if (surface === initialSurface && presentedSurface === initialSurface) {
            presentedSurface = undefined
          }
        })
      }
    } catch {
      // Window teardown can race initialization; the next explicit request
      // may still present a usable player/options surface.
    }
  }

  const ensurePlayer = (): Promise<unknown> => {
    if (!playerStart) {
      playerStart = Promise.resolve()
        .then(() => deps.ensurePlayerStarted())
        .catch(() => undefined)
    }
    return playerStart
  }

  const present = async (next: AppSurface): Promise<boolean> => {
    try {
      await presenterFor(next)()
      return true
    } catch {
      // Native presentation is best-effort during window teardown. Keeping
      // the previous surface is safer than creating an unhandled rejection.
      return false
    }
  }

  const runTransitions = async (): Promise<void> => {
    while (requestedSurface) {
      const currentSurface = requestedSurface
      const currentOptionsOrigin =
        currentSurface === 'options' ? (requestedOptionsOrigin ?? 'startup') : undefined
      const currentVersion = requestVersion
      requestedSurface = undefined
      requestedOptionsOrigin = undefined

      if (currentSurface === 'player') {
        await ensurePlayer()
        // A later request arrived while the shared player bootstrap was in
        // flight. Skip the stale presentation and let the latest request win.
        if (requestVersion > currentVersion) continue
      }

      const next = currentSurface
      if (next === surface && presentedSurface === next) {
        if (next === 'options') optionsOrigin = currentOptionsOrigin ?? 'startup'
        continue
      }

      if (!(await present(next))) continue
      // Do not publish a surface that was superseded while its native
      // presentation was in flight.
      if (requestVersion > currentVersion) continue
      if (next !== surface) {
        surface = next
        try {
          deps.sendSurfaceChanged(next)
        } catch {
          // A destroyed renderer must not turn a completed surface change
          // into an unhandled main-process rejection.
        }
      }
      if (next === 'options') optionsOrigin = currentOptionsOrigin ?? 'startup'
      presentedSurface = next
    }
  }

  const requestSurfaceNow = (
    next: AppSurface,
    origin: OptionsPresentationOrigin = 'startup'
  ): Promise<AppSurface> => {
    requestedSurface = next
    requestedOptionsOrigin = next === 'options' ? origin : undefined
    requestVersion += 1
    if (!transition) {
      transition = runTransitions().finally(() => {
        transition = undefined
      })
    }
    return transition.then(() => surface)
  }

  const requestSurface = (
    next: AppSurface,
    origin: OptionsPresentationOrigin = 'startup'
  ): Promise<AppSurface> => {
    const pendingDismissal = optionsDismissal
    if (pendingDismissal) {
      return pendingDismissal.then(() => requestSurfaceNow(next, origin))
    }
    return requestSurfaceNow(next, origin)
  }

  const dismissOptions = (): Promise<AppSurface> => {
    if (surface !== 'options' || optionsOrigin !== 'gameOcr') {
      return requestSurface('splash')
    }
    if (optionsDismissal) return optionsDismissal

    const dismissalVersion = requestVersion
    const operation = Promise.resolve()
      .then(() => deps.dismissGameOcrOptions())
      .then((hidden) => {
        if (hidden && requestVersion === dismissalVersion) presentedSurface = undefined
        return surface
      })
    const tracked = operation.finally(() => {
      if (optionsDismissal === tracked) optionsDismissal = undefined
    })
    optionsDismissal = tracked
    return tracked
  }

  return {
    getSurface(): AppSurface {
      return surface
    },
    showSplash(): Promise<AppSurface> {
      return requestSurface('splash')
    },
    showPlayer(): Promise<AppSurface> {
      return requestSurface('player')
    },
    showOptions(origin: OptionsPresentationOrigin = 'startup'): Promise<AppSurface> {
      return requestSurface('options', origin)
    },
    dismissOptions,
    quit(): void {
      if (quitRequested) return
      quitRequested = true
      deps.quit()
    }
  }
}

/** Short factory name for callers that do not need the longer type name. */
export const createAppShell = createAppShellCoordinator
