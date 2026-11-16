import { findActiveCue, offsetTimePos, type Cue } from '../../../shared/cue'
import type { Chapter } from '../../../shared/chapter'

const PREV_CHAPTER_RESTART_SECONDS = 2

function seekTargetForCueStart(cue: Cue, offsetMs: number): number {
  return cue.start + offsetMs / 1000
}

export interface LoopSelection {
  cues: Cue[]
  cue: Cue
}

// Derive the loop during render so a replaced cue list invalidates it before the next effect.
export function activeLoopCue(selection: LoopSelection | null, cues: Cue[]): Cue | null {
  return selection && selection.cues === cues ? selection.cue : null
}

export function replayCue(cues: Cue[], timePos: number, offsetMs: number): Cue | undefined {
  const t = offsetTimePos(timePos, offsetMs)
  const active = findActiveCue(cues, t)
  if (active) return active
  let latest: Cue | undefined
  for (const cue of cues) {
    if (t >= cue.end && (latest === undefined || cue.end > latest.end)) latest = cue
  }
  return latest
}

export function prevCue(cues: Cue[], timePos: number, offsetMs: number): Cue | undefined {
  const target = replayCue(cues, timePos, offsetMs)
  if (!target) return undefined
  let previous: Cue | undefined
  for (const cue of cues) {
    if (cue === target) continue
    if (cue.start < target.start && (previous === undefined || cue.start > previous.start))
      previous = cue
  }
  return previous ?? target
}

export function nextCue(cues: Cue[], timePos: number, offsetMs: number): Cue | undefined {
  const t = offsetTimePos(timePos, offsetMs)
  let next: Cue | undefined
  for (const cue of cues) {
    if (cue.start > t && (next === undefined || cue.start < next.start)) next = cue
  }
  return next
}

export function loopSeekTarget(
  loopCue: Cue,
  timePos: number,
  offsetMs: number
): number | undefined {
  const t = offsetTimePos(timePos, offsetMs)
  return t >= loopCue.end ? seekTargetForCueStart(loopCue, offsetMs) : undefined
}

/** Previous chapter target using the mpv/VLC restart threshold convention. */
export function prevChapterStart(chapters: Chapter[], timePos: number): number | undefined {
  if (chapters.length === 0) return undefined
  // Use the last chapter start before playback, including gaps and the region after its end.
  let currentStart: number | undefined
  for (const chapter of chapters) {
    if (chapter.start <= timePos && (currentStart === undefined || chapter.start > currentStart)) {
      currentStart = chapter.start
    }
  }
  if (currentStart === undefined) return 0
  if (timePos - currentStart > PREV_CHAPTER_RESTART_SECONDS) return currentStart
  let previousStart: number | undefined
  for (const chapter of chapters) {
    if (
      chapter.start < currentStart &&
      (previousStart === undefined || chapter.start > previousStart)
    ) {
      previousStart = chapter.start
    }
  }
  return previousStart ?? 0
}

export function nextChapterStart(chapters: Chapter[], timePos: number): number | undefined {
  let next: number | undefined
  for (const chapter of chapters) {
    if (chapter.start > timePos && (next === undefined || chapter.start < next))
      next = chapter.start
  }
  return next
}

// The overlay subtracts the subtitle offset; seeking must add it to land on the displayed cue.
export function seekTargetForCue(cue: Cue, offsetMs: number): number {
  return cue.start + offsetMs / 1000
}
