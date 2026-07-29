// Shared subtitle cue type used by both srt/ass parsers (main process) and
// the renderer's SubtitleOverlay. Pure data + a pure lookup helper — no I/O.

/** A single subtitle line, with timing in seconds. */
export interface Cue {
  /** Inclusive start time, in seconds. */
  start: number
  /** Exclusive end time, in seconds. */
  end: number
  /** Cue text; multi-line cues are joined with '\n'. */
  text: string
}

/**
 * Returns the cue active at `timePos` (seconds), i.e. the first cue in
 * array order whose [start, end) interval contains it. `start` is
 * inclusive, `end` is exclusive. Returns undefined if no cue matches
 * (before the first cue, after the last, or in a gap between cues).
 * Pure linear scan — cues are assumed roughly time-ordered but overlaps
 * are tolerated by returning the first match.
 */
export function findActiveCue(cues: Cue[], timePos: number): Cue | undefined {
  return cues.find((cue) => timePos >= cue.start && timePos < cue.end)
}

/**
 * Applies a subtitle timing offset (milliseconds; positive delays subtitles,
 * negative shows them earlier) to a playback position, for use with
 * `findActiveCue` — looking up the cue active at `offsetTimePos(timePos,
 * offsetMs)` instead of `timePos` directly shifts which cue is "active"
 * without needing to reshape the cue array itself.
 */
export function offsetTimePos(timePos: number, offsetMs: number): number {
  return timePos - offsetMs / 1000
}
