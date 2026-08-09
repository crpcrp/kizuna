import { describe, expect, it } from 'vitest'
import {
  addEntries,
  EMPTY_PLAYLIST,
  moveEntry,
  nextIndex,
  prevIndex,
  removeAt,
  reshuffle,
  setRepeat,
  setShuffle,
  type Rng
} from '@src/renderer/src/state/playlist'

/** Deterministic PRNG (mulberry32) so shuffle assertions are stable. */
function seededRng(seed: number): Rng {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function sorted(items: number[]): number[] {
  return [...items].sort((a, b) => a - b)
}

describe('addEntries', () => {
  it('drops HTTP and HTTPS URL paths', () => {
    const state = addEntries(EMPTY_PLAYLIST, [
      '/a.mkv',
      'https://host/live',
      'HTTP://host/x',
      '/b.mkv'
    ])
    expect(state.entries).toEqual(['/a.mkv', '/b.mkv'])
    expect(state.order).toEqual([0, 1])
  })

  it('appends to an empty queue and makes the first entry current', () => {
    const state = addEntries(EMPTY_PLAYLIST, ['/a.mkv', '/b.mkv'])
    expect(state.entries).toEqual(['/a.mkv', '/b.mkv'])
    expect(state.currentIndex).toBe(0)
    expect(state.order).toEqual([0, 1])
  })

  it('keeps the current entry when appending to a non-empty queue', () => {
    const base = { ...addEntries(EMPTY_PLAYLIST, ['/a', '/b']), currentIndex: 1 }
    const state = addEntries(base, ['/c'])
    expect(state.entries).toEqual(['/a', '/b', '/c'])
    expect(state.currentIndex).toBe(1)
  })

  it('allows duplicate paths (index-based identity)', () => {
    const state = addEntries(EMPTY_PLAYLIST, ['/a', '/a'])
    expect(state.entries).toEqual(['/a', '/a'])
    expect(state.entries.length).toBe(2)
  })

  it('returns the same state for an empty append', () => {
    const base = addEntries(EMPTY_PLAYLIST, ['/a'])
    expect(addEntries(base, [])).toBe(base)
  })

  it('keeps the shuffle sequence a valid permutation after appending', () => {
    const shuffledBase = setShuffle(
      addEntries(EMPTY_PLAYLIST, ['/a', '/b', '/c']),
      true,
      seededRng(1)
    )
    const state = addEntries(shuffledBase, ['/d', '/e'], seededRng(2))
    expect(sorted(state.order)).toEqual([0, 1, 2, 3, 4])
  })
})

describe('removeAt', () => {
  it('shifts the current entry down when removing before it', () => {
    const base = { ...addEntries(EMPTY_PLAYLIST, ['/a', '/b', '/c']), currentIndex: 2 }
    const state = removeAt(base, 0)
    expect(state.entries).toEqual(['/b', '/c'])
    expect(state.currentIndex).toBe(1)
  })

  it('points current at the next entry when removing the current one', () => {
    const base = { ...addEntries(EMPTY_PLAYLIST, ['/a', '/b', '/c']), currentIndex: 1 }
    const state = removeAt(base, 1)
    expect(state.entries).toEqual(['/a', '/c'])
    expect(state.currentIndex).toBe(1)
    expect(state.entries[state.currentIndex]).toBe('/c')
  })

  it('clamps current when removing the last (current) entry', () => {
    const base = { ...addEntries(EMPTY_PLAYLIST, ['/a', '/b']), currentIndex: 1 }
    const state = removeAt(base, 1)
    expect(state.entries).toEqual(['/a'])
    expect(state.currentIndex).toBe(0)
  })

  it('resets to -1 when the queue empties', () => {
    const state = removeAt(addEntries(EMPTY_PLAYLIST, ['/a']), 0)
    expect(state.entries).toEqual([])
    expect(state.currentIndex).toBe(-1)
    expect(state.order).toEqual([])
  })

  it('ignores an out-of-range index', () => {
    const base = addEntries(EMPTY_PLAYLIST, ['/a'])
    expect(removeAt(base, 5)).toBe(base)
    expect(removeAt(base, -1)).toBe(base)
  })

  it('keeps the shuffle sequence a valid permutation after removal', () => {
    const shuffledBase = setShuffle(
      addEntries(EMPTY_PLAYLIST, ['/a', '/b', '/c', '/d']),
      true,
      seededRng(3)
    )
    const state = removeAt(shuffledBase, 1)
    expect(sorted(state.order)).toEqual([0, 1, 2])
  })
})

describe('moveEntry', () => {
  it('reorders entries and keeps current pointing at the same entry', () => {
    const base = { ...addEntries(EMPTY_PLAYLIST, ['/a', '/b', '/c', '/d']), currentIndex: 0 }
    const state = moveEntry(base, 0, 2)
    expect(state.entries).toEqual(['/b', '/c', '/a', '/d'])
    expect(state.entries[state.currentIndex]).toBe('/a')
    expect(state.currentIndex).toBe(2)
  })

  it('moves a later entry before the current one and shifts current up', () => {
    const base = { ...addEntries(EMPTY_PLAYLIST, ['/a', '/b', '/c']), currentIndex: 1 }
    const state = moveEntry(base, 2, 0)
    expect(state.entries).toEqual(['/c', '/a', '/b'])
    expect(state.entries[state.currentIndex]).toBe('/b')
  })

  it('resets order to display order when not shuffled', () => {
    const base = addEntries(EMPTY_PLAYLIST, ['/a', '/b', '/c'])
    expect(moveEntry(base, 0, 2).order).toEqual([0, 1, 2])
  })

  it('preserves the shuffle play sequence across a move', () => {
    const shuffledBase = {
      ...setShuffle(addEntries(EMPTY_PLAYLIST, ['/a', '/b', '/c', '/d']), true, seededRng(5)),
      currentIndex: 0
    }
    const sequenceBefore = shuffledBase.order.map((position) => shuffledBase.entries[position])
    const state = moveEntry(shuffledBase, 0, 3)
    const sequenceAfter = state.order.map((position) => state.entries[position])
    expect(sequenceAfter).toEqual(sequenceBefore)
    expect(state.entries[state.currentIndex]).toBe('/a')
  })

  it('ignores invalid or no-op moves', () => {
    const base = addEntries(EMPTY_PLAYLIST, ['/a', '/b'])
    expect(moveEntry(base, 0, 0)).toBe(base)
    expect(moveEntry(base, 5, 0)).toBe(base)
    expect(moveEntry(base, 0, 9)).toBe(base)
  })
})

describe('nextIndex / prevIndex (display order)', () => {
  const three = { ...addEntries(EMPTY_PLAYLIST, ['/a', '/b', '/c']), currentIndex: 1 }

  it('advances and retreats within the list', () => {
    expect(nextIndex(three)).toBe(2)
    expect(prevIndex(three)).toBe(0)
  })

  it('returns null past the ends with repeat off', () => {
    expect(nextIndex({ ...three, currentIndex: 2 })).toBeNull()
    expect(prevIndex({ ...three, currentIndex: 0 })).toBeNull()
  })

  it('wraps with repeat all', () => {
    const all = setRepeat(three, 'all')
    expect(nextIndex({ ...all, currentIndex: 2 })).toBe(0)
    expect(prevIndex({ ...all, currentIndex: 0 })).toBe(2)
  })

  it('advances under repeat one — repeat-one governs EOF only, not next', () => {
    expect(nextIndex(setRepeat(three, 'one'))).toBe(2)
  })

  it('returns null for an empty queue', () => {
    expect(nextIndex(EMPTY_PLAYLIST)).toBeNull()
    expect(prevIndex(EMPTY_PLAYLIST)).toBeNull()
  })
})

describe('shuffle', () => {
  it('setShuffle produces a permutation of the same indices', () => {
    const base = addEntries(EMPTY_PLAYLIST, ['/a', '/b', '/c', '/d', '/e'])
    const state = setShuffle(base, true, seededRng(7))
    expect(sorted(state.order)).toEqual([0, 1, 2, 3, 4])
    expect(state.shuffle).toBe(true)
  })

  it('prevIndex retraces exactly the sequence nextIndex produced', () => {
    const base = { ...addEntries(EMPTY_PLAYLIST, ['/a', '/b', '/c', '/d']), currentIndex: 0 }
    const state = setShuffle(base, true, seededRng(9))
    const start = state.order[0]
    const afterNext = {
      ...state,
      currentIndex: nextIndex({ ...state, currentIndex: start }) as number
    }
    expect(prevIndex(afterNext)).toBe(start)
  })

  it('walks every entry once before hitting the end under shuffle', () => {
    let state = {
      ...setShuffle(addEntries(EMPTY_PLAYLIST, ['/a', '/b', '/c']), true, seededRng(11)),
      currentIndex: 0
    }
    state = { ...state, currentIndex: state.order[0] }
    const visited = [state.currentIndex]
    let next = nextIndex(state)
    while (next !== null) {
      visited.push(next)
      state = { ...state, currentIndex: next }
      next = nextIndex(state)
    }
    expect(sorted(visited)).toEqual([0, 1, 2])
  })

  it('anchors the shuffle sequence at the current entry so the remainder stays reachable', () => {
    // rng always returns 0, which would otherwise rotate the active entry to
    // the end; anchoring must keep it first regardless of the draw.
    const base = { ...addEntries(EMPTY_PLAYLIST, ['/a', '/b', '/c', '/d']), currentIndex: 2 }
    const state = setShuffle(base, true, () => 0)
    expect(state.order[0]).toBe(2)
    // With repeat off, nextIndex must not return null while entries remain.
    const visited = [state.order[0]]
    let cursor = { ...state, currentIndex: state.order[0] }
    let next = nextIndex(cursor)
    while (next !== null) {
      visited.push(next)
      cursor = { ...cursor, currentIndex: next }
      next = nextIndex(cursor)
    }
    expect(sorted(visited)).toEqual([0, 1, 2, 3])
  })

  it('disabling shuffle restores identity order', () => {
    const shuffledState = setShuffle(
      addEntries(EMPTY_PLAYLIST, ['/a', '/b', '/c']),
      true,
      seededRng(13)
    )
    expect(setShuffle(shuffledState, false).order).toEqual([0, 1, 2])
  })

  it('reshuffle rebuilds the permutation when shuffled and no-ops otherwise', () => {
    const shuffledState = setShuffle(
      addEntries(EMPTY_PLAYLIST, ['/a', '/b', '/c', '/d']),
      true,
      seededRng(1)
    )
    const reshuffledState = reshuffle(shuffledState, seededRng(2))
    expect(sorted(reshuffledState.order)).toEqual([0, 1, 2, 3])
    const plain = addEntries(EMPTY_PLAYLIST, ['/a', '/b'])
    expect(reshuffle(plain, seededRng(2))).toBe(plain)
  })
})
