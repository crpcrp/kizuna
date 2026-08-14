import type { AppSurface } from '../shared/appShell'
import type { StartupBehavior } from '../shared/playerSettings'

export interface StartupDecisionInput {
  startupBehavior: StartupBehavior
  hasLaunchPath: boolean
  supportsGameOcr: boolean
  probe: boolean
}

export interface StartupDecision {
  initialSurface: AppSurface
  startGameOcr: boolean
  presentInitialSurface: boolean
}

/** Resolves the one startup choice before any player process is started. */
export function resolveStartupDecision(input: StartupDecisionInput): StartupDecision {
  if (input.hasLaunchPath || input.probe || input.startupBehavior === 'video-player') {
    return { initialSurface: 'player', startGameOcr: false, presentInitialSurface: true }
  }

  if (input.startupBehavior === 'game-ocr' && input.supportsGameOcr) {
    return { initialSurface: 'splash', startGameOcr: true, presentInitialSurface: false }
  }

  return { initialSurface: 'splash', startGameOcr: false, presentInitialSurface: true }
}
