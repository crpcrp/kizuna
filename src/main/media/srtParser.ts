// Turns raw .srt text into shared `Cue[]` (start/end in seconds). Pure,
// synchronous, no I/O — the file is read and handed in as a string by the
// caller.

import type { Cue } from '../../shared/cue'

const TIMING_RE =
  /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/

/** Converts an SRT timestamp's captured groups to seconds. */
function timeToSeconds(h: string, m: string, s: string, ms: string): number {
  return Number(h) * 3600 + Number(m) * 60 + Number(s) + Number(ms.padEnd(3, '0')) / 1000
}

/**
 * Parses standard .srt content into cues. Blocks are separated by a blank
 * line; each block is an optional numeric index line, a timing line
 * (`HH:MM:SS,mmm --> HH:MM:SS,mmm`), then one or more text lines. Handles
 * both CRLF and LF line endings. Malformed or empty blocks (no timing line
 * found, or no text) are skipped rather than throwing.
 */
export function parseSrt(content: string): Cue[] {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const blocks = normalized.split(/\n\s*\n/)
  const cues: Cue[] = []

  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim())
    const timingIndex = lines.findIndex((l) => TIMING_RE.test(l))
    if (timingIndex === -1) continue

    const match = lines[timingIndex].match(TIMING_RE)
    if (!match) continue
    const [, h1, m1, s1, ms1, h2, m2, s2, ms2] = match

    const textLines = lines.slice(timingIndex + 1).filter((l) => l.length > 0)
    if (textLines.length === 0) continue

    cues.push({
      start: timeToSeconds(h1, m1, s1, ms1),
      end: timeToSeconds(h2, m2, s2, ms2),
      text: textLines.join('\n')
    })
  }

  return cues
}
