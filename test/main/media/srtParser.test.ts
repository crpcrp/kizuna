import { describe, it, expect } from 'vitest'
import { parseSrt } from '@src/main/media/srtParser'
import { findActiveCue } from '@src/shared/cue'

// Multi-cue SRT with a multi-line cue and CRLF line endings, mirroring a
// real extracted subtitle track.
const SRT = [
  '1',
  '00:00:01,000 --> 00:00:04,500',
  'Hello there.',
  '',
  '2',
  '00:00:05,250 --> 00:00:08,000',
  'This is a',
  'multi-line cue.',
  '',
  '3',
  '00:00:10,000 --> 00:00:12,000',
  'Final line.',
  ''
].join('\r\n')

describe('parseSrt', () => {
  it('parses cues with correct start/end seconds and text', () => {
    const cues = parseSrt(SRT)

    expect(cues).toHaveLength(3)

    expect(cues[0].start).toBeCloseTo(1)
    expect(cues[0].end).toBeCloseTo(4.5)
    expect(cues[0].text).toBe('Hello there.')

    expect(cues[1].start).toBeCloseTo(5.25)
    expect(cues[1].end).toBeCloseTo(8)
    expect(cues[1].text).toBe('This is a\nmulti-line cue.')

    expect(cues[2].start).toBeCloseTo(10)
    expect(cues[2].end).toBeCloseTo(12)
    expect(cues[2].text).toBe('Final line.')
  })

  it('skips malformed/empty blocks instead of throwing', () => {
    const withGarbage = SRT + '\r\n\r\nnot a real block\r\nno timing line here\r\n'
    expect(() => parseSrt(withGarbage)).not.toThrow()
    expect(parseSrt(withGarbage)).toHaveLength(3)
  })
})

describe('findActiveCue', () => {
  it('returns the cue active mid-interval', () => {
    const cues = parseSrt(SRT)
    expect(findActiveCue(cues, 6)?.text).toBe('This is a\nmulti-line cue.')
  })

  it('returns undefined before the first cue', () => {
    const cues = parseSrt(SRT)
    expect(findActiveCue(cues, 0)).toBeUndefined()
  })

  it('returns undefined after the last cue', () => {
    const cues = parseSrt(SRT)
    expect(findActiveCue(cues, 100)).toBeUndefined()
  })

  it('returns undefined in a gap between cues', () => {
    const cues = parseSrt(SRT)
    expect(findActiveCue(cues, 9)).toBeUndefined()
  })

  it('treats start as inclusive', () => {
    const cues = parseSrt(SRT)
    expect(findActiveCue(cues, 1)?.text).toBe('Hello there.')
  })

  it('treats end as exclusive', () => {
    const cues = parseSrt(SRT)
    expect(findActiveCue(cues, 4.5)).toBeUndefined()
  })
})
