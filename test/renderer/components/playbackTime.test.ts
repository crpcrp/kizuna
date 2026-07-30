import { describe, expect, it } from 'vitest'
import { formatTime } from '@src/renderer/src/components/playbackTime'

describe('formatTime', () => {
  it('formats sub-hour positions as M:SS', () => {
    expect(formatTime(0)).toBe('0:00')
    expect(formatTime(9)).toBe('0:09')
    expect(formatTime(65)).toBe('1:05')
    expect(formatTime(600)).toBe('10:00')
  })

  it('formats hour+ positions as H:MM:SS', () => {
    expect(formatTime(3600)).toBe('1:00:00')
    expect(formatTime(3661)).toBe('1:01:01')
  })

  it('floors fractional seconds', () => {
    expect(formatTime(12.9)).toBe('0:12')
  })

  it('clamps negative or non-finite input to 0:00', () => {
    expect(formatTime(-5)).toBe('0:00')
    expect(formatTime(Number.NaN)).toBe('0:00')
    expect(formatTime(Number.POSITIVE_INFINITY)).toBe('0:00')
  })
})
