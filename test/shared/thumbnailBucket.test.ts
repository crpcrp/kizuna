import { describe, it, expect } from 'vitest'
import { thumbnailBucket } from '@src/shared/thumbnailBucket'

describe('thumbnailBucket', () => {
  it('maps a time to its 1-percent bucket (floor)', () => {
    expect(thumbnailBucket(0, 100)).toBe(0)
    expect(thumbnailBucket(50, 100)).toBe(50)
    expect(thumbnailBucket(0.9, 100)).toBe(0)
    expect(thumbnailBucket(1.5, 100)).toBe(1)
  })

  it('clamps to 0..99', () => {
    expect(thumbnailBucket(-5, 100)).toBe(0)
    // At and past the reported end, the last bucket (99), never 100.
    expect(thumbnailBucket(100, 100)).toBe(99)
    expect(thumbnailBucket(999, 100)).toBe(99)
  })

  it('returns null for non-finite inputs', () => {
    expect(thumbnailBucket(Number.NaN, 100)).toBeNull()
    expect(thumbnailBucket(10, Number.POSITIVE_INFINITY)).toBeNull()
    expect(thumbnailBucket(10, Number.NaN)).toBeNull()
  })

  it('returns null for durations under 1 second (too short / unknown)', () => {
    expect(thumbnailBucket(0.2, 0.5)).toBeNull()
    expect(thumbnailBucket(0, 0)).toBeNull()
  })
})
