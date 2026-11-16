export interface Cue {
  /** Inclusive start time, in seconds. */
  start: number
  /** Exclusive end time, in seconds. */
  end: number
  /** Cue text; multi-line cues are joined with '\n'. */
  text: string
}

/** Overlapping cues resolve to the first match in array order. */
export function findActiveCue(cues: Cue[], timePos: number): Cue | undefined {
  return cues.find((cue) => timePos >= cue.start && timePos < cue.end)
}

/** Positive offsets delay subtitles; playback time is in seconds and the offset is in milliseconds. */
export function offsetTimePos(timePos: number, offsetMs: number): number {
  return timePos - offsetMs / 1000
}
