// Minimal startup signal used by the packaged Linux smoke test. Ordinary runs
// receive an inert probe; the smoke runner owns the timeout and diagnostics.

export const STARTUP_PROBE_ENV = 'KIZUNA_STARTUP_PROBE'
export const STARTUP_MILESTONES = ['window', 'mpv', 'renderer'] as const
export type StartupMilestone = (typeof STARTUP_MILESTONES)[number]

export const STARTUP_PROBE_PREFIX = 'kizuna-startup-probe'
export const STARTUP_PROBE_READY_LINE = `${STARTUP_PROBE_PREFIX}: ready`

export function startupProbeMilestoneLine(milestone: StartupMilestone): string {
  return `${STARTUP_PROBE_PREFIX}: reached ${milestone}`
}

export interface StartupProbe {
  mark(milestone: StartupMilestone): void
}

const inertProbe: StartupProbe = { mark: () => {} }

export function createStartupProbe({
  enabled,
  log,
  ready
}: {
  enabled: boolean
  log: (line: string) => void
  ready: () => void
}): StartupProbe {
  if (!enabled) return inertProbe

  const reached = new Set<StartupMilestone>()
  let complete = false

  return {
    mark(milestone) {
      if (complete || reached.has(milestone)) return
      reached.add(milestone)
      log(startupProbeMilestoneLine(milestone))
      if (!allMilestonesReached(reached)) return
      complete = true
      log(STARTUP_PROBE_READY_LINE)
      ready()
    }
  }
}

function allMilestonesReached(reached: ReadonlySet<StartupMilestone>): boolean {
  return STARTUP_MILESTONES.every((milestone) => reached.has(milestone))
}
