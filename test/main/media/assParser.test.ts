import { describe, it, expect } from 'vitest'
import { parseAss } from '@src/main/media/assParser'

// Minimal [Events] block mirroring a real ASS subtitle track: a Format
// line, a Comment line to be ignored, one Dialogue with an override tag
// and a \N break, and one Dialogue whose text contains a comma.
const ASS = [
  '[Script Info]',
  'Title: Test',
  '',
  '[Events]',
  'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
  'Comment: 0,0:00:00.00,0:00:01.00,Default,,0,0,0,,should be ignored',
  'Dialogue: 0,0:00:01.00,0:00:04.50,Default,,0,0,0,,{\\i1}Hello there.{\\i0}\\NSecond line.',
  'Dialogue: 0,0:00:05.25,0:00:08.00,Default,,0,0,0,,Text, with a comma.'
].join('\n')

describe('parseAss', () => {
  it('parses cues with correct start/end seconds, strips tags, converts \\N, ignores comments', () => {
    const cues = parseAss(ASS)

    expect(cues).toHaveLength(2)

    expect(cues[0].start).toBeCloseTo(1)
    expect(cues[0].end).toBeCloseTo(4.5)
    expect(cues[0].text).toBe('Hello there.\nSecond line.')

    expect(cues[1].start).toBeCloseTo(5.25)
    expect(cues[1].end).toBeCloseTo(8)
    expect(cues[1].text).toBe('Text, with a comma.')
  })

  it('skips malformed lines instead of throwing', () => {
    const withGarbage =
      ASS + '\nDialogue: not enough fields\nDialogue: 0,bad,bad,Default,,0,0,0,,oops'
    expect(() => parseAss(withGarbage)).not.toThrow()
    expect(parseAss(withGarbage)).toHaveLength(2)
  })

  it('returns no cues when there is no [Events] section', () => {
    expect(parseAss('[Script Info]\nTitle: Test\n')).toHaveLength(0)
  })
})
