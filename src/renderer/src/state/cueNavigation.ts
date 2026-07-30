import { findActiveCue, offsetTimePos, type Cue } from '../../../shared/cue'
import type { Chapter } from '../../../shared/chapter'

export const PREV_CHAPTER_RESTART_SECONDS = 2

function seekTargetForCueStart(cue: Cue, offsetMs: number): number {
  return cue.start + offsetMs / 1000
}

/** A per-cue loop, remembered together with the cue list it was picked from. */
export interface LoopSelection {
  cues: Cue[]
  cue: Cue
}

/**
 * The loop still in force for `cues`. A new cue list — a file switch or a
 * subtitle-track switch — invalidates the selection, so the loop is derived
 * during render instead of cleared from an effect one commit later.
 */
export function activeLoopCue(selection: LoopSelection | null, cues: Cue[]): Cue | null {
  return selection && selection.cues === cues ? selection.cue : null
}

/** The cue to replay: active cue, else the last cue already finished. */
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

/** The cue strictly before replayCue's target, clamped to the first cue. */
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

/** The first cue whose start is after the offset-corrected time. */
export function nextCue(cues: Cue[], timePos: number, offsetMs: number): Cue | undefined {
  const t = offsetTimePos(timePos, offsetMs)
  let next: Cue | undefined
  for (const cue of cues) {
    if (cue.start > t && (next === undefined || cue.start < next.start)) next = cue
  }
  return next
}

/** Seek target when playback has passed the looped cue's end. */
export function loopSeekTarget(
  loopCue: Cue,
  timePos: number,
  offsetMs: number
): number | undefined {
  const t = offsetTimePos(timePos, offsetMs)
  return t >= loopCue.end ? seekTargetForCueStart(loopCue, offsetMs) : undefined
}

/** Index of the chapter containing timePos, -1 when none/empty. */
export function currentChapterIndex(chapters: Chapter[], timePos: number): number {
  return chapters.findIndex((chapter) => timePos >= chapter.start && timePos < chapter.end)
}

/** Previous chapter target using the mpv/VLC restart threshold convention. */
export function prevChapterStart(chapters: Chapter[], timePos: number): number | undefined {
  if (chapters.length === 0) return undefined
  // The chapter we are logically in: the greatest start <= timePos. Unlike
  // currentChapterIndex this also covers gaps between chapters and the region
  // after the last chapter's end, so end credits rewind to the last chapter
  // rather than to 0:00.
  let currentStart: number | undefined
  for (const chapter of chapters) {
    if (chapter.start <= timePos && (currentStart === undefined || chapter.start > currentStart)) {
      currentStart = chapter.start
    }
  }
  if (currentStart === undefined) return 0
  if (timePos - currentStart > PREV_CHAPTER_RESTART_SECONDS) return currentStart
  // Within the restart threshold: seek to the start of the chapter before it.
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

/** Start of the first chapter after timePos; undefined in/after the last. */
export function nextChapterStart(chapters: Chapter[], timePos: number): number | undefined {
  let next: number | undefined
  for (const chapter of chapters) {
    if (chapter.start > timePos && (next === undefined || chapter.start < next))
      next = chapter.start
  }
  return next
}

/**
 * Pure: the absolute playback time (seconds) to seek to so that `cue` becomes
 * the active/displayed cue under the current subtitle offset. The overlay
 * looks up the active cue at `offsetTimePos(timePos, offsetMs) = timePos -
 * offsetMs/1000`, so seeking to `cue.start + offsetMs/1000` lands playback
 * exactly at the cue's start once the offset is undone — keeping the sidebar's
 * click-to-seek consistent with the highlighted row.
 */
export function seekTargetForCue(cue: Cue, offsetMs: number): number {
  return cue.start + offsetMs / 1000
}
