import { describe, expect, it } from 'vitest'
import {
  createStartupProbe,
  STARTUP_MILESTONES,
  STARTUP_PROBE_READY_LINE,
  startupProbeMilestoneLine
} from '@src/main/startupProbe'

function makeProbe(enabled = true) {
  const lines: string[] = []
  let readyCount = 0
  const probe = createStartupProbe({
    enabled,
    log: (line) => lines.push(line),
    ready: () => {
      readyCount += 1
    }
  })
  return { probe, lines, readyCount: () => readyCount }
}

describe('createStartupProbe', () => {
  it('reports each milestone and becomes ready once all are reached', () => {
    const { probe, lines, readyCount } = makeProbe()

    for (const milestone of STARTUP_MILESTONES) probe.mark(milestone)

    expect(lines).toEqual([
      ...STARTUP_MILESTONES.map(startupProbeMilestoneLine),
      STARTUP_PROBE_READY_LINE
    ])
    expect(readyCount()).toBe(1)
  })

  it('ignores duplicate milestones and does not finish early', () => {
    const { probe, lines, readyCount } = makeProbe()

    probe.mark('window')
    probe.mark('window')

    expect(lines).toEqual([startupProbeMilestoneLine('window')])
    expect(readyCount()).toBe(0)
  })

  it('does nothing when disabled', () => {
    const { probe, lines, readyCount } = makeProbe(false)

    for (const milestone of STARTUP_MILESTONES) probe.mark(milestone)

    expect(lines).toEqual([])
    expect(readyCount()).toBe(0)
  })
})
