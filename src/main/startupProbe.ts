// Deterministic startup reporting for the packaged Linux smoke test.
//
// A packaged GUI launch has no return value to assert on: the app either comes
// up or hangs, and "hangs" is exactly the failure the smoke test exists to
// catch. Scraping Chromium's or mpv's own log noise would tie the test to
// third-party output that changes between releases, so the app reports its own
// milestones on stdout instead, in a format this module owns end to end.
//
// The probe is inert unless `KIZUNA_STARTUP_PROBE` is set, so an ordinary run
// pays one environment-variable read and nothing else. It is not a test hook
// bolted onto production: the milestones it reports (the window is presented,
// mpv's IPC connection is live, the renderer has mounted) are the same three
// facts a user waits for on launch.

/** Set to `1` to enable milestone reporting and the self-quit below. */
export const STARTUP_PROBE_ENV = 'KIZUNA_STARTUP_PROBE'

/** Overrides `STARTUP_PROBE_DEFAULT_TIMEOUT_MS` when set to a positive integer. */
export const STARTUP_PROBE_TIMEOUT_ENV = 'KIZUNA_STARTUP_PROBE_TIMEOUT_MS'

/**
 * Startup facts the probe waits for, in no particular order — `startPlayer`
 * and the renderer's mount race by design, and the probe must not encode a
 * winner.
 */
export const STARTUP_MILESTONES = ['window', 'mpv', 'renderer'] as const

export type StartupMilestone = (typeof STARTUP_MILESTONES)[number]

/**
 * Shared prefix for every probe line. The smoke test filters stdout on this,
 * so it must not collide with Chromium's or mpv's output.
 */
export const STARTUP_PROBE_PREFIX = 'kizuna-startup-probe'

/** Emitted once, after every milestone has been reached. */
export const STARTUP_PROBE_READY_LINE = `${STARTUP_PROBE_PREFIX}: ready`

/**
 * How long a packaged launch may take before the probe gives up. Generous on
 * purpose: a cold AppImage under `xvfb-run` on a loaded CI runner pays FUSE
 * mount, Chromium startup, and mpv's X11 handshake before the last milestone
 * lands, and a flaky timeout would be worse than a slow one.
 */
export const STARTUP_PROBE_DEFAULT_TIMEOUT_MS = 90_000

/** Pure. The line reporting that `milestone` has been reached. */
export function startupProbeMilestoneLine(milestone: StartupMilestone): string {
  return `${STARTUP_PROBE_PREFIX}: reached ${milestone}`
}

/** Pure. The line reporting which milestones never arrived. */
export function startupProbeTimeoutLine(missing: readonly StartupMilestone[]): string {
  return `${STARTUP_PROBE_PREFIX}: timed out waiting for ${missing.join(', ')}`
}

/**
 * Pure. Reads the probe timeout from an environment mapping, falling back to
 * the default for an unset, non-numeric, or non-positive value — a malformed
 * override must not turn into a zero-length timeout that fails every run.
 */
export function startupProbeTimeoutFromEnv(
  env: Record<string, string | undefined>,
  fallback: number = STARTUP_PROBE_DEFAULT_TIMEOUT_MS
): number {
  const raw = env[STARTUP_PROBE_TIMEOUT_ENV]
  if (raw === undefined) return fallback
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return Math.floor(parsed)
}

/** Fakeable timers, so the tests never wait on a real 90-second timeout. */
export type StartupProbeSetTimeout = (cb: () => void, ms: number) => unknown
export type StartupProbeClearTimeout = (handle: unknown) => void

export interface StartupProbeDeps {
  /** When false, every method is a no-op and no timer is ever armed. */
  enabled: boolean
  /** Milliseconds allowed for all milestones. */
  timeoutMs?: number
  /** Receives each probe line; production passes `console.log`. */
  log: (line: string) => void
  /**
   * Called exactly once with the run's outcome, after the matching line has
   * been logged. Production sets the exit code and quits the app.
   */
  finish: (ready: boolean) => void
  setTimeoutFn?: StartupProbeSetTimeout
  clearTimeoutFn?: StartupProbeClearTimeout
}

export interface StartupProbe {
  /** Records a milestone. Repeat and post-completion marks are ignored. */
  mark(milestone: StartupMilestone): void
  /** Cancels a pending timeout without reporting. Safe to call repeatedly. */
  dispose(): void
}

/** A probe that does nothing, returned whenever reporting is disabled. */
const inertProbe: StartupProbe = {
  mark: () => {},
  dispose: () => {}
}

/**
 * Creates the startup probe. Disabled builds get `inertProbe`, so callers can
 * mark milestones unconditionally without guarding on the environment.
 */
export function createStartupProbe({
  enabled,
  timeoutMs = STARTUP_PROBE_DEFAULT_TIMEOUT_MS,
  log,
  finish,
  setTimeoutFn = (cb, ms) => setTimeout(cb, ms),
  clearTimeoutFn = (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
}: StartupProbeDeps): StartupProbe {
  if (!enabled) return inertProbe

  const reached = new Set<StartupMilestone>()
  let settled = false
  let timer: unknown = setTimeoutFn(() => {
    timer = undefined
    settle(false)
  }, timeoutMs)

  function settle(ready: boolean): void {
    if (settled) return
    settled = true
    if (timer !== undefined) {
      clearTimeoutFn(timer)
      timer = undefined
    }
    log(
      ready
        ? STARTUP_PROBE_READY_LINE
        : startupProbeTimeoutLine(STARTUP_MILESTONES.filter((name) => !reached.has(name)))
    )
    finish(ready)
  }

  return {
    mark(milestone) {
      if (settled || reached.has(milestone)) return
      reached.add(milestone)
      log(startupProbeMilestoneLine(milestone))
      if (STARTUP_MILESTONES.every((name) => reached.has(name))) settle(true)
    },
    dispose() {
      settled = true
      if (timer === undefined) return
      clearTimeoutFn(timer)
      timer = undefined
    }
  }
}
