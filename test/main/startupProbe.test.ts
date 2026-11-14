import { describe, expect, it } from 'vitest'
import { createStartupProbe } from '@src/main/startupProbe'

const milestones = ['window', 'mpv', 'renderer'] as const

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

    for (const milestone of milestones) probe.mark(milestone)

    expect(lines).toEqual([
      'kizuna-startup-probe: reached window',
      'kizuna-startup-probe: reached mpv',
      'kizuna-startup-probe: reached renderer',
      'kizuna-startup-probe: ready'
    ])
    expect(readyCount()).toBe(1)
  })

  it('ignores duplicate milestones and does not finish early', () => {
    const { probe, lines, readyCount } = makeProbe()

    probe.mark('window')
    probe.mark('window')

    expect(lines).toEqual(['kizuna-startup-probe: reached window'])
    expect(readyCount()).toBe(0)
  })

  it('does nothing when disabled', () => {
    const { probe, lines, readyCount } = makeProbe(false)

    for (const milestone of milestones) probe.mark(milestone)

    expect(lines).toEqual([])
    expect(readyCount()).toBe(0)
  })
})
