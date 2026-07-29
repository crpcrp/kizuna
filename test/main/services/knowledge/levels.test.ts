import { describe, it, expect } from 'vitest'
import {
  levelFromSrsStage,
  levelFromAnkiCard,
  mergeLevel,
  isStale,
  canSyncNow,
  type IntervalThresholds
} from '@src/main/services/knowledge/levels'
import type { AnkiCardInfo } from '@src/main/services/anki/ankiConnect'

const thresholds: IntervalThresholds = { knownIntervalDays: 21, wellKnownIntervalDays: 90 }

function card(overrides: Partial<AnkiCardInfo>): AnkiCardInfo {
  return {
    cardId: 1,
    note: 2,
    deckName: 'Japanese',
    fields: {},
    type: 0,
    queue: 0,
    interval: 0,
    ...overrides
  }
}

describe('levelFromSrsStage', () => {
  it.each([
    [0, 'unknown'],
    [1, 'learning'],
    [2, 'learning'],
    [3, 'learning'],
    [4, 'learning'],
    [5, 'known'],
    [6, 'known'],
    [7, 'known'],
    [8, 'wellKnown'],
    [9, 'wellKnown']
  ] as const)('stage %i -> %s', (stage, level) => {
    expect(levelFromSrsStage(stage)).toBe(level)
  })
})

describe('levelFromAnkiCard', () => {
  it('type 0 (new) is inDeck', () => {
    expect(levelFromAnkiCard(card({ type: 0 }), thresholds)).toBe('inDeck')
  })

  it('type 1 (learning) is learning', () => {
    expect(levelFromAnkiCard(card({ type: 1 }), thresholds)).toBe('learning')
  })

  it('type 3 (relearning) is learning', () => {
    expect(levelFromAnkiCard(card({ type: 3 }), thresholds)).toBe('learning')
  })

  it('type 2 (review) below the known threshold is learning', () => {
    expect(levelFromAnkiCard(card({ type: 2, interval: 20 }), thresholds)).toBe('learning')
  })

  it('type 2 (review) exactly at the known threshold is known', () => {
    expect(levelFromAnkiCard(card({ type: 2, interval: 21 }), thresholds)).toBe('known')
  })

  it('type 2 (review) between thresholds is known', () => {
    expect(levelFromAnkiCard(card({ type: 2, interval: 89 }), thresholds)).toBe('known')
  })

  it('type 2 (review) exactly at the wellKnown threshold is wellKnown', () => {
    expect(levelFromAnkiCard(card({ type: 2, interval: 90 }), thresholds)).toBe('wellKnown')
  })

  it('type 2 (review) above the wellKnown threshold is wellKnown', () => {
    expect(levelFromAnkiCard(card({ type: 2, interval: 400 }), thresholds)).toBe('wellKnown')
  })

  it('suspended (queue -1) is wellKnown regardless of interval/type', () => {
    expect(levelFromAnkiCard(card({ type: 0, interval: 0, queue: -1 }), thresholds)).toBe(
      'wellKnown'
    )
  })

  it('sibling-buried (queue -2) is inDeck', () => {
    expect(levelFromAnkiCard(card({ type: 2, interval: 400, queue: -2 }), thresholds)).toBe(
      'inDeck'
    )
  })

  it('manually-buried (queue -3) is inDeck', () => {
    expect(levelFromAnkiCard(card({ type: 2, interval: 400, queue: -3 }), thresholds)).toBe(
      'inDeck'
    )
  })

  it('never returns unknown — every real card is in a deck', () => {
    const cards = [
      card({ type: 0 }),
      card({ type: 1 }),
      card({ type: 2, interval: 21 }),
      card({ type: 3 }),
      card({ type: 2, interval: 400, queue: -1 })
    ]
    for (const c of cards) {
      expect(levelFromAnkiCard(c, thresholds)).not.toBe('unknown')
    }
  })
})

describe('mergeLevel', () => {
  it('picks the higher-ranked level regardless of argument order', () => {
    expect(mergeLevel('known', 'learning')).toBe('known')
    expect(mergeLevel('learning', 'known')).toBe('known')
  })

  it('is commutative for every pair', () => {
    const levels = ['unknown', 'inDeck', 'learning', 'known', 'wellKnown'] as const
    for (const a of levels) {
      for (const b of levels) {
        expect(mergeLevel(a, b)).toBe(mergeLevel(b, a))
      }
    }
  })

  it('returns the same level when both sides match', () => {
    expect(mergeLevel('wellKnown', 'wellKnown')).toBe('wellKnown')
  })
})

describe('isStale', () => {
  const now = Date.parse('2026-07-09T12:00:00.000Z')

  it('staleAfterHours 0 means never stale, even with no prior sync', () => {
    expect(isStale(null, now, 0)).toBe(false)
  })

  it('lastSyncAt null is always stale (when auto-sync is enabled)', () => {
    expect(isStale(null, now, 12)).toBe(true)
  })

  it('is not stale just under the threshold', () => {
    const lastSyncAt = new Date(now - 11 * 60 * 60 * 1000).toISOString()
    expect(isStale(lastSyncAt, now, 12)).toBe(false)
  })

  it('is stale exactly at the threshold', () => {
    const lastSyncAt = new Date(now - 12 * 60 * 60 * 1000).toISOString()
    expect(isStale(lastSyncAt, now, 12)).toBe(true)
  })

  it('is stale well past the threshold', () => {
    const lastSyncAt = new Date(now - 48 * 60 * 60 * 1000).toISOString()
    expect(isStale(lastSyncAt, now, 12)).toBe(true)
  })
})

describe('canSyncNow', () => {
  const now = Date.parse('2026-07-09T12:00:00.000Z')

  it('lastSyncAt null (never synced) is always allowed', () => {
    expect(canSyncNow(null, now, 60_000)).toBe(true)
  })

  it('is not allowed just under the interval', () => {
    const lastSyncAt = new Date(now - 59_000).toISOString()
    expect(canSyncNow(lastSyncAt, now, 60_000)).toBe(false)
  })

  it('is allowed exactly at the interval', () => {
    const lastSyncAt = new Date(now - 60_000).toISOString()
    expect(canSyncNow(lastSyncAt, now, 60_000)).toBe(true)
  })

  it('is allowed well past the interval', () => {
    const lastSyncAt = new Date(now - 60 * 60 * 1000).toISOString()
    expect(canSyncNow(lastSyncAt, now, 60_000)).toBe(true)
  })
})
