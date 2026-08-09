import { describe, it, expect, vi } from 'vitest'
import {
  createStartupProbe,
  startupProbeMilestoneLine,
  startupProbeTimeoutFromEnv,
  STARTUP_MILESTONES,
  STARTUP_PROBE_DEFAULT_TIMEOUT_MS,
  STARTUP_PROBE_READY_LINE,
  STARTUP_PROBE_TIMEOUT_ENV,
  type StartupMilestone
} from '@src/main/startupProbe'

/**
 * Collects the probe's output and outcome. Timers are fakes so no test waits
 * on the real 90-second budget.
 */
function makeProbe(overrides: { enabled?: boolean; timeoutMs?: number } = {}) {
  const lines: string[] = []
  const finished: boolean[] = []
  let fire: (() => void) | undefined
  const cleared: unknown[] = []

  const probe = createStartupProbe({
    enabled: overrides.enabled ?? true,
    timeoutMs: overrides.timeoutMs,
    log: (line) => lines.push(line),
    finish: (ready) => finished.push(ready),
    setTimeoutFn: (cb) => {
      fire = cb
      return 'timer'
    },
    clearTimeoutFn: (handle) => cleared.push(handle)
  })

  return {
    probe,
    lines,
    finished,
    cleared,
    /** Simulates the timeout elapsing. */
    elapse: () => fire?.(),
    armed: () => fire !== undefined
  }
}

const ALL: StartupMilestone[] = [...STARTUP_MILESTONES]

describe('createStartupProbe', () => {
  it('reports each milestone once and finishes ready when all arrive', () => {
    const { probe, lines, finished, cleared } = makeProbe()

    for (const milestone of ALL) probe.mark(milestone)

    expect(lines).toEqual([...ALL.map(startupProbeMilestoneLine), STARTUP_PROBE_READY_LINE])
    expect(finished).toEqual([true])
    // The pending timeout must be cancelled, or the process would stay alive
    // for the rest of the budget after a successful launch.
    expect(cleared).toEqual(['timer'])
  })

  it('does not finish until every milestone has arrived', () => {
    const { probe, finished } = makeProbe()

    probe.mark('window')
    probe.mark('mpv')

    expect(finished).toEqual([])
  })

  it('ignores repeated marks, so a milestone cannot stand in for another', () => {
    const { probe, lines, finished } = makeProbe()

    probe.mark('window')
    probe.mark('window')
    probe.mark('window')

    expect(lines).toEqual([startupProbeMilestoneLine('window')])
    expect(finished).toEqual([])
  })

  it('names the milestones that never arrived when it times out', () => {
    const { probe, lines, finished, elapse } = makeProbe()

    probe.mark('window')
    elapse()

    expect(lines.at(-1)).toBe('kizuna-startup-probe: timed out waiting for mpv, renderer')
    expect(finished).toEqual([false])
  })

  it('settles once: a mark after a timeout cannot flip the outcome', () => {
    const { probe, finished, elapse } = makeProbe()

    probe.mark('window')
    elapse()
    for (const milestone of ALL) probe.mark(milestone)

    expect(finished).toEqual([false])
  })

  it('stays silent and arms no timer when disabled', () => {
    const { probe, lines, finished, armed } = makeProbe({ enabled: false })

    for (const milestone of ALL) probe.mark(milestone)

    expect(armed()).toBe(false)
    expect(lines).toEqual([])
    expect(finished).toEqual([])
  })

  it('cancels the timeout on dispose without reporting an outcome', () => {
    const { probe, lines, finished, cleared, elapse } = makeProbe()

    probe.dispose()
    elapse()

    expect(cleared).toEqual(['timer'])
    expect(lines).toEqual([])
    expect(finished).toEqual([])
  })

  it('arms the timer with the configured budget', () => {
    const setTimeoutFn = vi.fn(() => 'timer')

    createStartupProbe({
      enabled: true,
      timeoutMs: 1234,
      log: () => {},
      finish: () => {},
      setTimeoutFn,
      clearTimeoutFn: () => {}
    })

    expect(setTimeoutFn).toHaveBeenCalledWith(expect.any(Function), 1234)
  })
})

describe('startupProbeTimeoutFromEnv', () => {
  it('uses the default when unset', () => {
    expect(startupProbeTimeoutFromEnv({})).toBe(STARTUP_PROBE_DEFAULT_TIMEOUT_MS)
  })

  it('uses a positive override', () => {
    expect(startupProbeTimeoutFromEnv({ [STARTUP_PROBE_TIMEOUT_ENV]: '5000' })).toBe(5000)
  })

  // A malformed override that produced a zero timeout would fail every
  // packaged launch instantly and read as a packaging bug.
  it.each(['', 'soon', '0', '-1', 'NaN'])('falls back for the invalid value %o', (value) => {
    expect(startupProbeTimeoutFromEnv({ [STARTUP_PROBE_TIMEOUT_ENV]: value })).toBe(
      STARTUP_PROBE_DEFAULT_TIMEOUT_MS
    )
  })
})
