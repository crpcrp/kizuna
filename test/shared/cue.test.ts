import { describe, it, expect } from 'vitest'
import { offsetTimePos, findActiveCue } from '@src/shared/cue'

describe('offsetTimePos', () => {
  it('is a no-op with offsetMs 0', () => {
    expect(offsetTimePos(10, 0)).toBe(10)
  })

  it('subtracts a positive offset (ms) converted to seconds, delaying subtitles', () => {
    // A cue meant for real time 10.5-12.5 is stored as 10-12; with a +500ms
    // delay offset, it should become active only once real time reaches 10.5.
    expect(offsetTimePos(10.5, 500)).toBe(10)
    expect(offsetTimePos(10.4, 500)).toBeCloseTo(9.9)
  })

  it('adds for a negative offset, showing subtitles earlier', () => {
    expect(offsetTimePos(10, -500)).toBe(10.5)
  })
})

describe('findActiveCue with offsetTimePos', () => {
  const cues = [{ start: 10, end: 12, text: 'a' }]

  it('delays a cue becoming active by a positive offset', () => {
    expect(findActiveCue(cues, offsetTimePos(10.4, 500))).toBeUndefined()
    expect(findActiveCue(cues, offsetTimePos(10.5, 500))?.text).toBe('a')
    expect(findActiveCue(cues, offsetTimePos(12.4, 500))?.text).toBe('a')
    expect(findActiveCue(cues, offsetTimePos(12.5, 500))).toBeUndefined()
  })
})
