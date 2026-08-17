import { describe, expect, it } from 'vitest'
import {
  AUTO_PAUSE_END_INSET_SECONDS,
  createSubtitleAutoPauseController,
  type SubtitleAutoPauseObservation
} from '@src/renderer/src/state/subtitleAutoPause'
import type { Cue } from '@src/shared/cue'

const CUE: Cue = { start: 2, end: 3, text: 'line' }
const CUES = [CUE]

function observation(
  patch: Partial<SubtitleAutoPauseObservation> = {}
): SubtitleAutoPauseObservation {
  return {
    timing: 'before',
    scope: 'all',
    cues: CUES,
    selectedSubtitleId: 1,
    japaneseSubtitleSelected: true,
    filePath: 'episode.mkv',
    loadGeneration: 1,
    subtitleOffsetMs: 0,
    timePos: 0,
    paused: false,
    ...patch
  }
}

describe('subtitle auto-pause controller', () => {
  it('uses the first observation as a baseline', () => {
    const controller = createSubtitleAutoPauseController()

    expect(controller.observe(observation({ timePos: 2.1 }))).toBeUndefined()
    expect(controller.observe(observation({ timePos: 2.2 }))).toBeUndefined()
  })

  it('is inert when disabled, paused, unavailable, or malformed', () => {
    const controller = createSubtitleAutoPauseController()

    for (const patch of [
      { timing: 'off' as const },
      { paused: true },
      { filePath: undefined },
      { selectedSubtitleId: null },
      { cues: [] },
      { timePos: Number.NaN },
      { subtitleOffsetMs: Number.POSITIVE_INFINITY }
    ]) {
      expect(controller.observe(observation(patch))).toBeUndefined()
    }
  })

  it('pauses once on a forward cue entry and consumes noisy updates', () => {
    const controller = createSubtitleAutoPauseController()
    controller.observe(observation({ timePos: 0 }))

    expect(controller.observe(observation({ timePos: 2.1 }))).toMatchObject({
      timing: 'before',
      cue: CUE,
      seekTarget: 2
    })
    expect(controller.observe(observation({ timePos: 2.2 }))).toBeUndefined()
  })

  it('uses only a complete true eligibility result in unknown scope', () => {
    const unknown: Cue = { start: 2, end: 3, text: 'unknown' }
    const known: Cue = { start: 4, end: 5, text: 'known' }
    const cues = [unknown, known]
    const eligible = (cue: Cue): boolean => cue === unknown
    const controller = createSubtitleAutoPauseController()

    controller.observe(
      observation({
        scope: 'unknown',
        cues,
        cueEligibility: eligible,
        timePos: 0
      })
    )
    expect(
      controller.observe(
        observation({
          scope: 'unknown',
          cues,
          cueEligibility: eligible,
          timePos: 2.1
        })
      )?.cue
    ).toBe(unknown)

    controller.observe(
      observation({
        scope: 'unknown',
        cues,
        cueEligibility: eligible,
        timePos: 3.5
      })
    )
    expect(
      controller.observe(
        observation({
          scope: 'unknown',
          cues,
          cueEligibility: eligible,
          timePos: 5.1
        })
      )
    ).toBeUndefined()
  })

  it('does not pause unknown scope without Japanese eligibility or a map', () => {
    const controller = createSubtitleAutoPauseController()
    controller.observe(observation({ scope: 'unknown', timePos: 0 }))
    expect(controller.observe(observation({ scope: 'unknown', timePos: 2.1 }))).toBeUndefined()

    const nonJapanese = createSubtitleAutoPauseController()
    nonJapanese.observe(
      observation({
        scope: 'unknown',
        japaneseSubtitleSelected: false,
        cueEligibility: () => true,
        timePos: 0
      })
    )
    expect(
      nonJapanese.observe({
        ...observation({
          scope: 'unknown',
          japaneseSubtitleSelected: false,
          cueEligibility: () => true,
          timePos: 2.1
        })
      })
    ).toBeUndefined()
  })

  it('establishes a fresh baseline when the current eligibility result changes', () => {
    const firstEligibility = (): boolean => false
    const secondEligibility = (): boolean => true
    const controller = createSubtitleAutoPauseController()

    controller.observe(
      observation({ scope: 'unknown', cueEligibility: firstEligibility, timePos: 0 })
    )
    expect(
      controller.observe(
        observation({ scope: 'unknown', cueEligibility: firstEligibility, timePos: 2.1 })
      )
    ).toBeUndefined()

    expect(
      controller.observe(
        observation({ scope: 'unknown', cueEligibility: secondEligibility, timePos: 0 })
      )
    ).toBeUndefined()
    expect(
      controller.observe(
        observation({ scope: 'unknown', cueEligibility: secondEligibility, timePos: 2.1 })
      )?.cue
    ).toBe(CUE)
  })

  it('pauses after a cue and seeks inside it by the shared inset', () => {
    const controller = createSubtitleAutoPauseController()
    controller.observe(observation({ timing: 'after', timePos: 0 }))

    expect(controller.observe(observation({ timing: 'after', timePos: 3.1 }))).toMatchObject({
      timing: 'after',
      cue: CUE,
      seekTarget: CUE.end - AUTO_PAUSE_END_INSET_SECONDS
    })
  })

  it('re-arms after backward movement and resets on a user seek', () => {
    const controller = createSubtitleAutoPauseController()
    controller.observe(observation({ timePos: 0 }))
    expect(controller.observe(observation({ timePos: 2.1 }))).toBeDefined()

    controller.observe(observation({ timePos: 1 }))
    expect(controller.observe(observation({ timePos: 2.1 }))).toBeDefined()

    controller.notifyUserSeek()
    controller.observe(observation({ timePos: 4 }))
    expect(controller.observe(observation({ timePos: 4.1 }))).toBeUndefined()
  })

  it('applies positive and negative subtitle offsets to the correction target', () => {
    const positive = createSubtitleAutoPauseController()
    positive.observe(observation({ timePos: 0, subtitleOffsetMs: 500 }))
    expect(positive.observe(observation({ timePos: 2.6, subtitleOffsetMs: 500 }))).toMatchObject({
      seekTarget: 2.5
    })

    const negative = createSubtitleAutoPauseController()
    negative.observe(observation({ timePos: 0, subtitleOffsetMs: -500 }))
    expect(negative.observe(observation({ timePos: 1.6, subtitleOffsetMs: -500 }))).toMatchObject({
      seekTarget: 1.5
    })
  })

  it('uses first-match order for overlapping cues and preserves gaps', () => {
    const first: Cue = { start: 0, end: 3, text: 'first' }
    const overlap: Cue = { start: 1, end: 2, text: 'overlap' }
    const gapCue: Cue = { start: 5, end: 6, text: '' }
    const cues = [first, overlap, gapCue]
    const controller = createSubtitleAutoPauseController()
    controller.observe(observation({ cues, timePos: -1, selectedSubtitleId: 1 }))

    expect(
      controller.observe(observation({ cues, timePos: 1.5, selectedSubtitleId: 1 }))?.cue
    ).toBe(first)
    controller.observe(observation({ cues, timePos: 3.5, selectedSubtitleId: 1 }))
    expect(
      controller.observe(observation({ cues, timePos: 5.1, selectedSubtitleId: 1 }))?.cue
    ).toBe(gapCue)
  })

  it('clamps zero and very-short after cues to a valid start target', () => {
    const zero: Cue = { start: 2, end: 2, text: 'zero' }
    const short: Cue = { start: 4, end: 4.001, text: 'short' }
    const cues = [zero, short]
    const controller = createSubtitleAutoPauseController()
    controller.observe(observation({ timing: 'after', cues, timePos: 0 }))

    expect(controller.observe(observation({ timing: 'after', cues, timePos: 2.1 }))).toMatchObject({
      seekTarget: 2
    })
  })

  it('resets when the file, cue list, mode, or offset changes', () => {
    const controller = createSubtitleAutoPauseController()
    controller.observe(observation({ timePos: 0 }))
    expect(controller.observe(observation({ timePos: 2.1 }))).toBeDefined()

    const nextCues = [{ ...CUE, text: 'new' }]
    expect(
      controller.observe(
        observation({ cues: nextCues, filePath: 'other.mkv', loadGeneration: 2, timePos: 2.1 })
      )
    ).toBeUndefined()
    expect(
      controller.observe(
        observation({
          cues: nextCues,
          filePath: 'other.mkv',
          loadGeneration: 2,
          timing: 'after',
          subtitleOffsetMs: 100,
          timePos: 2.1
        })
      )
    ).toBeUndefined()
  })
})
