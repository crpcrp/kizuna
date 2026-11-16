// Pure policy for turning WaniKani/Anki source data into a KnowledgeLevel,
// and for merging/staleness across sources. No DB, no HTTP.

import type { KnowledgeLevel } from '../../../shared/knowledge'
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

// User policy: suspended means wellKnown; buried stays inDeck. Anki types 1/3 are (re)learning, 2 review.
export function levelFromAnkiCard(card: AnkiCardInfo, t: IntervalThresholds): KnowledgeLevel {
  if (card.queue === -1) return 'wellKnown'
  if (card.queue === -2 || card.queue === -3) return 'inDeck'
  if (card.type === 0) return 'inDeck'
  if (card.type === 1 || card.type === 3) return 'learning'
  if (card.interval >= t.wellKnownIntervalDays) return 'wellKnown'
  if (card.interval >= t.knownIntervalDays) return 'known'
  return 'learning'
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

// Rate-limit manual sync independently of the auto-sync staleness policy.
export function canSyncNow(lastSyncAt: string | null, now: number, minIntervalMs: number): boolean {
  if (lastSyncAt === null) return true
  return now - Date.parse(lastSyncAt) >= minIntervalMs
}
