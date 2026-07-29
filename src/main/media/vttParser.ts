// WebVTT subtitle parser.
//
// The fallback format for acquired URL subtitles: yt-dlp is asked for
// `srt/vtt/best`, so SRT (read by srtParser.ts) is preferred and VTT is what we
// get when SRT isn't offered — notably YouTube auto-captions, which are VTT.
// Pure, synchronous, no I/O — the file is read and handed in as a string by the
// caller, mirroring srtParser.ts / assParser.ts.

import type { Cue } from '../../shared/cue'

// VTT timestamps allow an optional hours field: `MM:SS.mmm` or `HH:MM:SS.mmm`.
// A trailing cue-settings list (e.g. `align:start position:50%`) is ignored.
const TIMING_RE =
  /(?:(\d{1,}):)?(\d{2}):(\d{2})[.,](\d{1,3})\s*-->\s*(?:(\d{1,}):)?(\d{2}):(\d{2})[.,](\d{1,3})/

/** Converts a VTT timestamp's captured groups to seconds (hours optional). */
function timeToSeconds(h: string | undefined, m: string, s: string, ms: string): number {
  return (h ? Number(h) * 3600 : 0) + Number(m) * 60 + Number(s) + Number(ms.padEnd(3, '0')) / 1000
}

/** Strips inline VTT tags (`<c>`, `<00:00:00.000>`, `<v Bob>`, `</c>`). */
function cleanText(raw: string): string {
  return raw.replace(/<[^>]*>/g, '').trim()
}

/**
 * Parses WebVTT content into cues. Blocks are separated by blank lines; the
 * `WEBVTT` header, `NOTE`/`STYLE`/`REGION` blocks, and any block without a
 * timing line are skipped. A block may carry a cue-identifier line before the
 * timing line (ignored). Handles both CRLF and LF endings, `.`/`,` millisecond
 * separators, and hour-less timestamps. Malformed or text-less blocks are
 * skipped rather than throwing.
 */
export function parseVtt(content: string): Cue[] {
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  const blocks = normalized.split(/\n\s*\n/)
  const cues: Cue[] = []

  for (const block of blocks) {
    const lines = block.split('\n')
    const timingIndex = lines.findIndex((l) => TIMING_RE.test(l))
    if (timingIndex === -1) continue

    const match = lines[timingIndex].match(TIMING_RE)
    if (!match) continue
    const [, h1, m1, s1, ms1, h2, m2, s2, ms2] = match

    const textLines = lines
      .slice(timingIndex + 1)
      .map((l) => cleanText(l))
      .filter((l) => l.length > 0)
    if (textLines.length === 0) continue

    cues.push({
      start: timeToSeconds(h1, m1, s1, ms1),
      end: timeToSeconds(h2, m2, s2, ms2),
      text: textLines.join('\n')
    })
  }

  return cues
}
