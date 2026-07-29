import { describe, expect, it } from 'vitest'
import type { Cue } from '@src/shared/cue'
import { cueKey } from '@src/renderer/src/state/playerActions'
import {
  findMatches,
  highlightSegments,
  stepMatch,
  type SearchMatch
} from '@src/renderer/src/state/sidebarSearch'

function cue(text: string, start = 0, end = 1): Cue {
  return { start, end, text }
}

describe('findMatches', () => {
  it('returns no matches for a blank query', () => {
    expect(findMatches([cue('猫が好き')], '')).toEqual([])
  })

  it('returns no matches for a whitespace-only query', () => {
    expect(findMatches([cue('猫が好き')], '   ')).toEqual([])
  })

  it('finds multiple matches within one cue', () => {
    const c = cue('猫と猫')
    const matches = findMatches([c], '猫')
    expect(matches).toEqual([
      { cueKey: cueKey(c), start: 0, end: 1 },
      { cueKey: cueKey(c), start: 2, end: 3 }
    ])
  })

  it('orders matches across cues in cue order then offset order', () => {
    const first = cue('犬猫')
    const second = cue('猫犬猫', 1, 2)
    const matches = findMatches([first, second], '猫')
    expect(matches).toEqual([
      { cueKey: cueKey(first), start: 1, end: 2 },
      { cueKey: cueKey(second), start: 0, end: 1 },
      { cueKey: cueKey(second), start: 2, end: 3 }
    ])
  })

  it('is case-insensitive for Latin text', () => {
    const c = cue('Hello World')
    expect(findMatches([c], 'world')).toEqual([{ cueKey: cueKey(c), start: 6, end: 11 }])
  })

  it('matches full-width against half-width query via NFKC', () => {
    const c = cue('ABC')
    expect(findMatches([c], 'ＡＢＣ')).toEqual([{ cueKey: cueKey(c), start: 0, end: 3 }])
  })

  it('falls back to raw-text matching when a character expands under NFKC', () => {
    // '㍑' individually normalizes to the 4-character 'リットル', which would
    // break raw-offset mapping if applied — must fall back to raw text, where
    // the literal '㍑' character is still findable.
    const c = cue('1㍑のジュース')
    expect(findMatches([c], '㍑')).toEqual([{ cueKey: cueKey(c), start: 1, end: 2 }])
  })

  it('returns no matches when the query is absent', () => {
    expect(findMatches([cue('猫が好き')], '犬')).toEqual([])
  })
})

describe('stepMatch', () => {
  it('wraps forward past the last match', () => {
    expect(stepMatch(2, 3, 1)).toBe(0)
  })

  it('wraps backward past the first match', () => {
    expect(stepMatch(0, 3, -1)).toBe(2)
  })

  it('steps forward within range', () => {
    expect(stepMatch(0, 3, 1)).toBe(1)
  })

  it('stays put when there is exactly one match', () => {
    expect(stepMatch(0, 1, 1)).toBe(0)
    expect(stepMatch(0, 1, -1)).toBe(0)
  })

  it('returns 0 when there are no matches', () => {
    expect(stepMatch(0, 0, 1)).toBe(0)
  })
})

describe('highlightSegments', () => {
  it('returns a single plain segment when there are no matches', () => {
    expect(highlightSegments(5, [])).toEqual([{ start: 0, end: 5, kind: 'plain' }])
  })

  it('handles a match at the start of the text', () => {
    const match: SearchMatch = { cueKey: 'k', start: 0, end: 2 }
    expect(highlightSegments(5, [match])).toEqual([
      { start: 0, end: 2, kind: 'match' },
      { start: 2, end: 5, kind: 'plain' }
    ])
  })

  it('handles a match at the end of the text', () => {
    const match: SearchMatch = { cueKey: 'k', start: 3, end: 5 }
    expect(highlightSegments(5, [match])).toEqual([
      { start: 0, end: 3, kind: 'plain' },
      { start: 3, end: 5, kind: 'match' }
    ])
  })

  it('handles adjacent matches with no plain gap between them', () => {
    const a: SearchMatch = { cueKey: 'k', start: 0, end: 2 }
    const b: SearchMatch = { cueKey: 'k', start: 2, end: 4 }
    expect(highlightSegments(4, [a, b])).toEqual([
      { start: 0, end: 2, kind: 'match' },
      { start: 2, end: 4, kind: 'match' }
    ])
  })

  it('flags the current match distinctly from other matches', () => {
    const a: SearchMatch = { cueKey: 'k', start: 0, end: 1 }
    const b: SearchMatch = { cueKey: 'k', start: 2, end: 3 }
    expect(highlightSegments(4, [a, b], b)).toEqual([
      { start: 0, end: 1, kind: 'match' },
      { start: 1, end: 2, kind: 'plain' },
      { start: 2, end: 3, kind: 'currentMatch' },
      { start: 3, end: 4, kind: 'plain' }
    ])
  })
})
