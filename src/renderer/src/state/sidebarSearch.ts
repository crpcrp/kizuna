import type { Cue } from '../../../shared/cue'
import { cueKey } from './tokenization'
/** A single occurrence of the search query within a cue's raw text. */
export interface SearchMatch {
  cueKey: string
  /** UTF-16 code-unit offsets into the cue's raw (un-normalized) text. */
  start: number
  end: number
}

interface SearchUnit {
  value: string
  start: number
  end: number
}

/** Builds one searchable unit per Unicode code point while retaining the
 * source string's UTF-16 offsets for that unit. */
function buildSearchUnits(text: string, normalize: boolean): SearchUnit[] {
  const units: SearchUnit[] = []
  let offset = 0
  for (const character of text) {
    const start = offset
    offset += character.length
    units.push({
      value: normalize ? character.normalize('NFKC').toLowerCase() : character.toLowerCase(),
      start,
      end: offset
    })
  }
  return units
}

/** Per-character NFKC+lowercase normalization, rejecting any character whose
 * expansion changes length (e.g. ㍑ → リットル) since that would break the
 * raw-offset mapping. Returns undefined when any character fails the
 * cheap-path check, signaling the raw-text fallback. */
function normalizeSearchUnits(text: string): SearchUnit[] | undefined {
  const units = buildSearchUnits(text, true)
  return units.every((unit) => [...unit.value].length === 1) ? units : undefined
}

function findMatchesInText(
  units: SearchUnit[],
  query: SearchUnit[]
): Array<{ start: number; end: number }> {
  const matches: Array<{ start: number; end: number }> = []
  if (query.length === 0) return matches
  for (let i = 0; i <= units.length - query.length; i++) {
    let matched = true
    for (let j = 0; j < query.length; j++) {
      if (units[i + j].value !== query[j].value) {
        matched = false
        break
      }
    }
    if (matched) {
      matches.push({
        start: units[i].start,
        end: units[i + query.length - 1].end
      })
      i += query.length - 1
    }
  }
  return matches
}

/** All matches in cue order, then offset order. Empty for a blank/
 *  whitespace-only query. */
export function findMatches(cues: Cue[], query: string): SearchMatch[] {
  if (query.trim().length === 0) return []

  const matches: SearchMatch[] = []
  const normalizedQuery = normalizeSearchUnits(query)
  // Lowercasing the whole query before splitting preserves the existing
  // literal fallback for characters whose case mapping expands.
  const fallbackQuery = buildSearchUnits(query.toLowerCase(), false)
  for (const cue of cues) {
    const normalizedUnits = normalizeSearchUnits(cue.text)
    const useNormalized = normalizedUnits !== undefined && normalizedQuery !== undefined
    const units = useNormalized ? normalizedUnits : buildSearchUnits(cue.text, false)
    const q = useNormalized ? normalizedQuery : fallbackQuery

    for (const { start, end } of findMatchesInText(units, q)) {
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
  const length = Math.max(0, textLength)
  const sorted = [...matches].sort((a, b) => a.start - b.start || a.end - b.end)

  let cursor = 0
  for (const match of sorted) {
    const start = Math.max(cursor, Math.min(length, Math.max(0, match.start)))
    const end = Math.min(length, Math.max(0, match.end))
    if (start >= end) continue
    if (start > cursor) segments.push({ start: cursor, end: start, kind: 'plain' })
    const isCurrent =
      currentMatch !== undefined &&
      currentMatch.start === match.start &&
      currentMatch.end === match.end
    segments.push({
      start,
      end,
      kind: isCurrent ? 'currentMatch' : 'match'
    })
    cursor = end
  }
  if (cursor < length) segments.push({ start: cursor, end: length, kind: 'plain' })

  return segments
}
