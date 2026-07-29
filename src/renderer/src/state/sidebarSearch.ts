import type { Cue } from '../../../shared/cue'
import { cueKey } from './playerActions'

/** A single occurrence of the search query within a cue's raw text. */
export interface SearchMatch {
  cueKey: string
  /** char offsets into the cue's raw (un-normalized) text */
  start: number
  end: number
}

/** Per-character NFKC+lowercase normalization, rejecting any character whose
 * expansion changes length (e.g. ｷﾞ → ギ collapses two chars into one) since
 * that would break the raw-offset mapping. Returns undefined when any
 * character fails the cheap-path check, signaling the raw-text fallback. */
function normalizeCharwise(text: string): string[] | undefined {
  const chars = [...text]
  const normalized: string[] = []
  for (const ch of chars) {
    const n = ch.normalize('NFKC').toLowerCase()
    if ([...n].length !== 1) return undefined
    normalized.push(n)
  }
  return normalized
}

function findMatchesInText(
  chars: string[],
  query: string[]
): Array<{ start: number; end: number }> {
  const matches: Array<{ start: number; end: number }> = []
  if (query.length === 0) return matches
  for (let i = 0; i <= chars.length - query.length; i++) {
    let matched = true
    for (let j = 0; j < query.length; j++) {
      if (chars[i + j] !== query[j]) {
        matched = false
        break
      }
    }
    if (matched) matches.push({ start: i, end: i + query.length })
  }
  return matches
}

/** All matches in cue order, then offset order. Empty for a blank/
 *  whitespace-only query. */
export function findMatches(cues: Cue[], query: string): SearchMatch[] {
  if (query.trim().length === 0) return []

  const matches: SearchMatch[] = []
  for (const cue of cues) {
    const rawChars = [...cue.text]
    const normalizedChars = normalizeCharwise(cue.text)
    const normalizedQuery = normalizeCharwise(query)

    const useNormalized = normalizedChars !== undefined && normalizedQuery !== undefined
    const chars = useNormalized ? normalizedChars! : rawChars.map((c) => c.toLowerCase())
    const q = useNormalized ? normalizedQuery! : [...query.toLowerCase()]

    for (const { start, end } of findMatchesInText(chars, q)) {
      matches.push({ cueKey: cueKey(cue), start, end })
    }
  }
  return matches
}

/** Wrapping navigation: index of the match to land on. */
export function stepMatch(current: number, total: number, dir: 1 | -1): number {
  if (total <= 0) return 0
  return (((current + dir) % total) + total) % total
}

/** Splits [0, textLength) into alternating plain/highlight segments for a
 *  single cue, given its matches and which (if any) is current. */
export interface HighlightSegment {
  start: number
  end: number
  kind: 'plain' | 'match' | 'currentMatch'
}

export function highlightSegments(
  textLength: number,
  matches: SearchMatch[],
  currentMatch?: SearchMatch
): HighlightSegment[] {
  const segments: HighlightSegment[] = []
  const sorted = [...matches].sort((a, b) => a.start - b.start)

  let cursor = 0
  for (const match of sorted) {
    if (match.start > cursor) segments.push({ start: cursor, end: match.start, kind: 'plain' })
    const isCurrent =
      currentMatch !== undefined &&
      currentMatch.start === match.start &&
      currentMatch.end === match.end
    segments.push({
      start: match.start,
      end: match.end,
      kind: isCurrent ? 'currentMatch' : 'match'
    })
    cursor = match.end
  }
  if (cursor < textLength) segments.push({ start: cursor, end: textLength, kind: 'plain' })

  return segments
}
