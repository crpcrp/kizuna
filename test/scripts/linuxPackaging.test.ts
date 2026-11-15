import { describe, it, expect } from 'vitest'
import { expectedArtifactNames, readStartupProbeOutcome } from '@scripts/linuxPackaging.mjs'
import { createStartupProbe, type StartupMilestone } from '@src/main/startupProbe'

describe('expectedArtifactNames', () => {
  // electron-builder expands ${arch} per packaging format, so the two names
  // legitimately disagree on the architecture token.
  it('carries platform and architecture in both names', () => {
    expect(expectedArtifactNames('kizuna', '1.2.3')).toEqual({
      appImage: 'kizuna-1.2.3-linux-x86_64.AppImage',
      deb: 'kizuna-1.2.3-linux-amd64.deb'
    })
  })
})

describe('readStartupProbeOutcome', () => {
  /** Drives the real probe so the parser is tested against its actual output. */
  function probeOutput(marks: StartupMilestone[]): string {
    const lines: string[] = []
    const probe = createStartupProbe({
      enabled: true,
      log: (line) => lines.push(line),
      ready: () => {}
    })
    for (const mark of marks) probe.mark(mark)
    return lines.join('\n')
  }

  // The script and the app agree on a wire format neither imports from the
  // other (one is ESM tooling, the other is bundled TypeScript), so the
  // contract is pinned by feeding the parser the real thing.
  it('reads a successful launch produced by the application itself', () => {
    const outcome = readStartupProbeOutcome(probeOutput(['window', 'mpv', 'renderer']))

    expect(outcome.ready).toBe(true)
    expect(outcome.milestones).toEqual(['window', 'mpv', 'renderer'])
  })

  it('reports a partial launch without calling it ready', () => {
    const outcome = readStartupProbeOutcome(probeOutput(['window']))

    expect(outcome.ready).toBe(false)
    expect(outcome.milestones).toEqual(['window'])
  })

  it('does not accept a ready line without every milestone', () => {
    expect(
      readStartupProbeOutcome(
        ['kizuna-startup-probe: reached window', 'kizuna-startup-probe: ready'].join('\n')
      ).ready
    ).toBe(false)
  })

  it('ignores unrelated Chromium and mpv output around the probe lines', () => {
    const stdout = [
      '[1:0809/100000.000:ERROR:viz_main_impl.cc(186)] Exiting GPU process',
      'kizuna-startup-probe: reached window',
      'AL lib: (EE) ALCplaybackAlsa_open: Could not open playback device',
      'kizuna-startup-probe: reached mpv',
      'kizuna-startup-probe: reached renderer',
      'kizuna-startup-probe: ready'
    ].join('\n')

    expect(readStartupProbeOutcome(stdout)).toEqual({
      ready: true,
      milestones: ['window', 'mpv', 'renderer']
    })
  })

  it('reports nothing ready for output with no probe lines', () => {
    expect(readStartupProbeOutcome('Segmentation fault')).toEqual({
      ready: false,
      milestones: []
    })
  })
})
