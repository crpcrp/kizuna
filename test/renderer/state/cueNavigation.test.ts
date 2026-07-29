import { describe, expect, it } from 'vitest'
import type { Cue } from '../../../src/shared/cue'
import {
  activeLoopCue,
  currentChapterIndex,
  loopSeekTarget,
  nextChapterStart,
  nextCue,
  prevChapterStart,
  prevCue,
  replayCue
} from '../../../src/renderer/src/state/cueNavigation'

const cues: Cue[] = [
  { start: 3, end: 4, text: 'third unsorted' },
  { start: 0, end: 1, text: 'first' },
  { start: 2, end: 2.5, text: 'second' }
]

describe('cueNavigation', () => {
  it('handles empty tracks and positions before the first cue', () => {
    expect(replayCue([], 1, 0)).toBeUndefined()
    expect(prevCue(cues, -1, 0)).toBeUndefined()
    expect(nextCue(cues, -1, 0)).toBe(cues[1])
  })

  it('chooses replay, previous, and next cues across gaps and track ends', () => {
    expect(replayCue(cues, 1.5, 0)).toBe(cues[1])
    expect(prevCue(cues, 1.5, 0)).toBe(cues[1])
    expect(nextCue(cues, 1.5, 0)).toBe(cues[2])
    expect(replayCue(cues, 5, 0)).toBe(cues[0])
    expect(nextCue(cues, 5, 0)).toBeUndefined()
  })

  it('treats cue end as exclusive and honors subtitle offsets', () => {
    expect(replayCue(cues, 1, 0)).toBe(cues[1])
    expect(replayCue(cues, 1.5, 500)).toBe(cues[1])
    expect(nextCue(cues, 3.4, 500)).toBe(cues[0])
  })

  it('clamps previous while inside the first cue and keeps first overlap match', () => {
    const overlapping: Cue[] = [
      { start: 0, end: 5, text: 'wide' },
      { start: 1, end: 2, text: 'narrow' }
    ]
    expect(prevCue(cues, 0.5, 0)).toBe(cues[1])
    expect(replayCue(overlapping, 1.5, 0)).toBe(overlapping[0])
  })

  it('returns a loop seek target only after the offset-corrected cue end', () => {
    expect(loopSeekTarget(cues[2], 2.4, 0)).toBeUndefined()
    expect(loopSeekTarget(cues[2], 3, 500)).toBe(2.5)
  })
})

describe('activeLoopCue', () => {
  it('is null when nothing is looping', () => {
    expect(activeLoopCue(null, cues)).toBeNull()
  })

  it('keeps the looped cue while the same cue list is rendered', () => {
    expect(activeLoopCue({ cues, cue: cues[1] }, cues)).toBe(cues[1])
  })

  it('drops the loop when a new cue list arrives, even with equal contents', () => {
    const replacement = cues.map((cue) => ({ ...cue }))
    expect(activeLoopCue({ cues, cue: cues[1] }, replacement)).toBeNull()
    expect(activeLoopCue({ cues, cue: cues[1] }, [])).toBeNull()
  })
})

describe('chapter navigation helpers', () => {
  const chapters = [
    { start: 5, end: 30, title: 'A' },
    { start: 35, end: 60, title: 'B' },
    { start: 60, end: 90, title: 'C' }
  ]

  it('finds the current chapter and handles gaps', async () => {
    expect(currentChapterIndex([], 10)).toBe(-1)
    expect(currentChapterIndex(chapters, 10)).toBe(0)
    expect(currentChapterIndex(chapters, 32)).toBe(-1)
  })

  it('seeks to previous chapter using the restart threshold', async () => {
    expect(prevChapterStart([], 10)).toBeUndefined()
    expect(prevChapterStart(chapters, 1)).toBe(0)
    expect(prevChapterStart(chapters, 61)).toBe(35)
    expect(prevChapterStart(chapters, 65)).toBe(60)
  })

  it('rewinds to the containing chapter from a gap or after the last chapter', async () => {
    // In the gap between chapter A (ends 30) and B (starts 35): fall back to A.
    expect(prevChapterStart(chapters, 32)).toBe(5)
    // After the last chapter's end (end credits): fall back to the last chapter.
    expect(prevChapterStart(chapters, 95)).toBe(60)
    // Within the restart threshold at the start of a gap-preceding chapter still
    // steps back to the previous chapter.
    expect(prevChapterStart(chapters, 36)).toBe(5)
  })

  it('seeks to the next chapter start', async () => {
    expect(nextChapterStart([], 10)).toBeUndefined()
    expect(nextChapterStart(chapters, 1)).toBe(5)
    expect(nextChapterStart(chapters, 35)).toBe(60)
    expect(nextChapterStart(chapters, 90)).toBeUndefined()
  })

  it('finds the next chapter start without assuming sorted input', async () => {
    const unsorted = [
      { start: 60, end: 90, title: 'C' },
      { start: 5, end: 30, title: 'A' },
      { start: 35, end: 60, title: 'B' }
    ]
    expect(nextChapterStart(unsorted, 1)).toBe(5)
    expect(nextChapterStart(unsorted, 35)).toBe(60)
    expect(prevChapterStart(unsorted, 95)).toBe(60)
  })
})
