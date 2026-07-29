import { describe, expect, it } from 'vitest'
import { priorityWeight } from '@src/shared/dictionary'

describe('priorityWeight', () => {
  it('recognizes supported Yomitan and Jitendex priority tags while ignoring unknown or empty tags', () => {
    expect(priorityWeight('P')).toBeGreaterThan(0)
    expect(priorityWeight('news1 ichi2 spec1 gai2')).toBeGreaterThan(0)
    expect(priorityWeight('', '★ priority form')).toBe(1)
    expect(priorityWeight('', 'fem')).toBe(0)
    expect(priorityWeight('ichi1', '')).toBe(1)
    expect(priorityWeight('newsflash1 custom')).toBe(0)
    expect(priorityWeight('', '★形')).toBe(0)
    expect(priorityWeight('')).toBe(0)
  })
})
