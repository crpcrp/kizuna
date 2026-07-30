// Pure policy for turning WaniKani/Anki source data into a KnowledgeLevel,
// and for merging/staleness across sources. No DB, no HTTP.

import { maxKnowledgeLevel, type KnowledgeLevel } from '../../../shared/knowledge'
import type { AnkiCardInfo } from '../anki/ankiConnect'

export interface IntervalThresholds {
  knownIntervalDays: number
  wellKnownIntervalDays: number
}

/**
 * WaniKani SRS stage → level. 0 unstarted, 1-4 Apprentice → learning, 5-6
 * Guru and 7 Master → known, 8 Enlightened and 9 Burned → wellKnown.
 */
export function levelFromSrsStage(stage: number): KnowledgeLevel {
  if (stage <= 0) return 'unknown'
  if (stage <= 4) return 'learning'
  if (stage <= 7) return 'known'
  return 'wellKnown'
}

/**
 * Anki card → level. A suspended card (`queue === -1`) is `wellKnown` by
 * explicit user policy. Buried cards (`queue === -2 | -3`) remain `inDeck`: the
 * card exists but is not in active rotation. `type 0` (fresh card) is `inDeck`;
 * `type 1|3` are (re)learning steps; `type 2` (review) is graded by `interval`
 * against the configured thresholds. Every real card is in some deck, so this
 * never returns 'unknown'.
 */
export function levelFromAnkiCard(card: AnkiCardInfo, t: IntervalThresholds): KnowledgeLevel {
  if (card.queue === -1) return 'wellKnown'
  if (card.queue === -2 || card.queue === -3) return 'inDeck'
  if (card.type === 0) return 'inDeck'
  if (card.type === 1 || card.type === 3) return 'learning'
  if (card.interval >= t.wellKnownIntervalDays) return 'wellKnown'
  if (card.interval >= t.knownIntervalDays) return 'known'
  return 'learning'
}

/** @deprecated Use maxKnowledgeLevel from shared/knowledge in new code. */
export function mergeLevel(a: KnowledgeLevel, b: KnowledgeLevel): KnowledgeLevel {
  return maxKnowledgeLevel(a, b)
}

/**
 * `staleAfterHours: 0` means auto-sync is disabled — never stale.
 * `lastSyncAt: null` (never synced) is always stale.
 */
export function isStale(lastSyncAt: string | null, now: number, staleAfterHours: number): boolean {
  if (staleAfterHours === 0) return false
  if (lastSyncAt === null) return true
  const elapsedMs = now - Date.parse(lastSyncAt)
  return elapsedMs >= staleAfterHours * 60 * 60 * 1000
}

/**
 * Whether at least `minIntervalMs` has elapsed since `lastSyncAt` (or it's
 * `null` — never synced, so always allowed). This is the floor a manual
 * "Sync now" click is checked against, independent of `isStale`'s
 * hours-scale auto-sync check — it exists to stop rapid repeat clicks from
 * hammering the source's API, not to decide whether a sync is *due*.
 */
export function canSyncNow(lastSyncAt: string | null, now: number, minIntervalMs: number): boolean {
  if (lastSyncAt === null) return true
  return now - Date.parse(lastSyncAt) >= minIntervalMs
}
