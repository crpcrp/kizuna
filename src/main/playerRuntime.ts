import type { LaunchPathBuffer } from './launchArgs'
import type { StartupProbe } from './startupProbe'
import type { FrameCaptureService, ScreenshotService } from './services/screenshots'
import type { PowerSaveController } from './services/powerSave'
import type { SystemMediaController } from './services/systemMedia'

export type PlayerRuntimeState = 'not-started' | 'starting' | 'ready' | 'failed'
export type PlayerStartResult = 'ready' | 'failed'

export interface PlayerRuntimeBridgeServices {
  powerSave: Pick<PowerSaveController, 'update'>
  systemMedia: Pick<SystemMediaController, 'update'>
  screenshots: ScreenshotService
  frames: FrameCaptureService
}

export interface PlayerRuntimeDeps {
  /** Starts and connects the singleton mpv controller. */
  startMpv(): Promise<void>
  createPowerSave(): PowerSaveController
  createSystemMedia(): SystemMediaController
  createScreenshots(): ScreenshotService
  createFrames(): FrameCaptureService
  registerBridge(services: PlayerRuntimeBridgeServices): void
  launchPathBuffer: Pick<LaunchPathBuffer, 'markPlayerReady' | 'markPlayerFailed'>
  startupProbe: Pick<StartupProbe, 'mark'>
  warn?(error: unknown): void
}

export interface PlayerRuntime {
  ensureStarted(): Promise<PlayerStartResult>
  getState(): PlayerRuntimeState
  releasePowerSave(): void
  disposeSystemMedia(): void
}

/**
 * Owns the one player bootstrap attempt for the process lifetime. The
 * factories and bridge registration are injected so this boundary can be
 * tested without Electron or a bundled mpv binary.
 */
export function createPlayerRuntime(deps: PlayerRuntimeDeps): PlayerRuntime {
  let state: PlayerRuntimeState = 'not-started'
  let startupPromise: Promise<PlayerStartResult> | undefined
  let powerSave: PowerSaveController | undefined
  let systemMedia: SystemMediaController | undefined

  const warn = deps.warn ?? ((error: unknown) => console.warn('[kizuna] mpv not started:', error))

  const fail = (error: unknown): PlayerStartResult => {
    state = 'failed'
    try {
      warn(error)
    } catch {
      // A logger must not turn a handled startup failure into an unhandled one.
    }
    try {
      deps.launchPathBuffer.markPlayerFailed()
    } catch {
      // The launch buffer is best-effort during a failed bootstrap.
    }
    return 'failed'
  }

  const start = async (): Promise<PlayerStartResult> => {
    try {
      await deps.startMpv()
      powerSave = deps.createPowerSave()
      systemMedia = deps.createSystemMedia()
      const screenshots = deps.createScreenshots()
      const frames = deps.createFrames()
      deps.registerBridge({ powerSave, systemMedia, screenshots, frames })
      deps.launchPathBuffer.markPlayerReady()
      deps.startupProbe.mark('mpv')
      state = 'ready'
      return 'ready'
    } catch (error) {
      return fail(error)
    }
  }

  return {
    ensureStarted(): Promise<PlayerStartResult> {
      if (startupPromise) return startupPromise
      state = 'starting'
      startupPromise = start()
      return startupPromise
    },
    getState(): PlayerRuntimeState {
      return state
    },
    releasePowerSave(): void {
      powerSave?.dispose()
    },
    disposeSystemMedia(): void {
      systemMedia?.dispose()
    }
  }
}
