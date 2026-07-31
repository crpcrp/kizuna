// Knowledge-level vocabulary shared by main, preload, and renderer. Pure
// type + const, no imports.
//
// `inDeck` = the word has an Anki card in a configured known deck, but the card
// is still new or buried — mined, not yet learned. It outranks
// 'unknown' so mined words stop being offered for mining, and is outranked by
// any real learning progress from another deck or from WaniKani.

export type KnowledgeLevel = 'unknown' | 'inDeck' | 'learning' | 'known' | 'wellKnown'

/** Ascending; index = rank, used by `maxKnowledgeLevel` to pick the higher one. */
export const LEVEL_ORDER: KnowledgeLevel[] = ['unknown', 'inDeck', 'learning', 'known', 'wellKnown']

/** Higher-ranked (per LEVEL_ORDER) of the two levels wins. */
export function maxKnowledgeLevel(a: KnowledgeLevel, b: KnowledgeLevel): KnowledgeLevel {
  return LEVEL_ORDER.indexOf(a) >= LEVEL_ORDER.indexOf(b) ? a : b
}

export type KnowledgeSource = 'wanikani' | 'anki'

/** Provenance retained with one known-word row for the popup details view. */
export type KnowledgeSourceDetail = WaniKaniSourceDetail | AnkiSourceDetail

export interface WaniKaniSourceDetail {
  source: 'wanikani'
  curriculumLevel: number
  proficiency: string
}

export interface AnkiSourceDetail {
  source: 'anki'
  deck: string
  intervalDays: number
  cardId: number
  noteId: number
}

export interface KnowledgeDetails {
  level: KnowledgeLevel
  sources: KnowledgeSourceDetail[]
}

/** Narrows untrusted JSON read from the knowledge database to popup-safe metadata. */
export function isKnowledgeSourceDetail(value: unknown): value is KnowledgeSourceDetail {
  if (typeof value !== 'object' || value === null) return false
  const detail = value as Record<string, unknown>
  if (detail.source === 'wanikani') {
    return (
      typeof detail.curriculumLevel === 'number' &&
      Number.isInteger(detail.curriculumLevel) &&
      detail.curriculumLevel > 0 &&
      typeof detail.proficiency === 'string'
    )
  }
  if (detail.source === 'anki') {
    return (
      typeof detail.deck === 'string' &&
      typeof detail.intervalDays === 'number' &&
      Number.isFinite(detail.intervalDays) &&
      typeof detail.cardId === 'number' &&
      Number.isInteger(detail.cardId) &&
      detail.cardId > 0 &&
      typeof detail.noteId === 'number' &&
      Number.isInteger(detail.noteId) &&
      detail.noteId > 0
    )
  }
  return false
}

/** Result of the most recent explicit sync attempt for a source. */
export type SyncOutcome = 'synced' | 'cooldown' | 'unconfigured' | 'error'

/**
 * The user-tunable part of the knowledge settings — everything except the
 * WaniKani token, which the two processes represent differently (main stores
 * it encrypted, the renderer only learns whether one is set). Both the stored
 * `KnowledgeSettings` and the renderer-facing `PublicKnowledgeSettings` build
 * on this, so the fields and their defaults are declared once.
 */
export interface KnowledgeTuning {
  ankiKnownDecks: string[]
  ankiKnownField: string
  knownIntervalDays: number
  wellKnownIntervalDays: number
  coloringEnabled: boolean
  staleAfterHours: number
}

export const DEFAULT_KNOWLEDGE_TUNING: KnowledgeTuning = {
  ankiKnownDecks: [],
  ankiKnownField: '',
  knownIntervalDays: 21,
  wellKnownIntervalDays: 90,
  coloringEnabled: true,
  staleAfterHours: 23
}

/** `knowledge` settings as exposed to preload/renderer — never the raw encrypted token. */
export interface PublicKnowledgeSettings extends KnowledgeTuning {
  hasWanikaniToken: boolean
  /** Whether the OS secure store backs secret encryption — drives the honest
   * "encrypted at rest" vs "saved unencrypted" copy on the WaniKani token.
   * Always set by the main process; `undefined` only in the renderer's
   * not-yet-loaded fallback, where the UI must make no encryption claim at all
   * rather than defaulting to the alarming (and usually wrong) "unencrypted". */
  encryptionAvailable?: boolean
}

export interface SourceStatus {
  lastSyncAt: string | null
  count: number
  configured: boolean
  error?: string
  /** Present on `knowledge.sync()` results; omitted from a passive `syncStatus()` read. */
  outcome?: SyncOutcome
  /** Exact next allowed manual-sync time when `outcome` is `cooldown`. */
  retryAt?: string
}

export interface SyncStatus {
  wanikani: SourceStatus
  anki: SourceStatus
}
