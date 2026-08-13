import type { AppSurface } from '../../shared/appShell'

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
  /** Pushes a changed surface to the renderer. */
  sendSurfaceChanged(surface: AppSurface): void
  /** Requests the normal Electron quit path. */
  quit(): void
}

export interface AppShellCoordinator {
  getSurface(): AppSurface
  showPlayer(): Promise<AppSurface>
  showOptions(): Promise<AppSurface>
  quit(): void
}

/**
 * Owns the renderer-visible surface and the native presentation ordering.
 * Player startup is shared separately from surface requests, so a racing
 * player/options pair still has one bootstrap and one final presentation.
 */
export function createAppShellCoordinator(deps: AppShellCoordinatorDeps): AppShellCoordinator {
  let surface = deps.initialSurface
  let presentedSurface: AppSurface | undefined
  let playerStart: Promise<unknown> | undefined
  let requestedSurface: 'options' | 'player' | undefined
  let requestVersion = 0
  let transition: Promise<void> | undefined
  let quitRequested = false

  if (surface === 'splash') {
    try {
      deps.presentSplash()
      presentedSurface = 'splash'
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

  const present = async (next: 'options' | 'player'): Promise<boolean> => {
    try {
      await (next === 'player' ? deps.presentPlayer() : deps.presentOptions())
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
      const currentVersion = requestVersion
      requestedSurface = undefined

      await ensurePlayer()
      // A later request arrived while the shared player bootstrap was in
      // flight. Skip the stale presentation and let the latest request win.
      if (requestVersion > currentVersion) continue

      const next = currentSurface
      if (next === surface && presentedSurface === next) continue

      if (!(await present(next))) continue
      if (next !== surface) {
        surface = next
        try {
          deps.sendSurfaceChanged(next)
        } catch {
          // A destroyed renderer must not turn a completed surface change
          // into an unhandled main-process rejection.
        }
      }
      presentedSurface = next
    }
  }

  const requestSurface = (next: 'options' | 'player'): Promise<AppSurface> => {
    requestedSurface = next
    requestVersion += 1
    if (!transition) {
      transition = runTransitions().finally(() => {
        transition = undefined
      })
    }
    return transition.then(() => surface)
  }

  return {
    getSurface(): AppSurface {
      return surface
    },
    showPlayer(): Promise<AppSurface> {
      return requestSurface('player')
    },
    showOptions(): Promise<AppSurface> {
      return requestSurface('options')
    },
    quit(): void {
      if (quitRequested) return
      quitRequested = true
      deps.quit()
    }
  }
}

/** Short factory name for callers that do not need the longer type name. */
export const createAppShell = createAppShellCoordinator
