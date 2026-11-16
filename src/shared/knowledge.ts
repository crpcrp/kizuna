// `inDeck` means mined but not learned; real progress from any deck or WaniKani outranks it.

export type KnowledgeLevel = 'unknown' | 'inDeck' | 'learning' | 'known' | 'wellKnown'

/** Ascending; index = rank, used by `maxKnowledgeLevel` to pick the higher one. */
export const LEVEL_ORDER: KnowledgeLevel[] = ['unknown', 'inDeck', 'learning', 'known', 'wellKnown']

/** Normalizes the lemma identity shared by knowledge lookup and reports. */
export function normalizeKnowledgeLemma(lemma: string): string {
  return lemma.normalize('NFC').trim()
}

/** Higher-ranked (per LEVEL_ORDER) of the two levels wins. */
export function maxKnowledgeLevel(a: KnowledgeLevel, b: KnowledgeLevel): KnowledgeLevel {
  return LEVEL_ORDER.indexOf(a) >= LEVEL_ORDER.indexOf(b) ? a : b
}

export type KnowledgeSource = 'wanikani' | 'anki'

/** Provenance retained with one known-word row for the popup details view. */
export type KnowledgeSourceDetail = WaniKaniSourceDetail | AnkiSourceDetail

export interface WaniKaniSourceDetail {
  source: 'wanikani'
  curriculumLevel?: number
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
  /** Distinct `known_words.source` values for this lemma; independent of metadata JSON. */
  sourceKinds: KnowledgeSource[]
  sources: KnowledgeSourceDetail[]
}

/** Narrows untrusted JSON read from the knowledge database to popup-safe metadata. */
export function isKnowledgeSourceDetail(value: unknown): value is KnowledgeSourceDetail {
  if (typeof value !== 'object' || value === null) return false
  const detail = value as Record<string, unknown>
  if (detail.source === 'wanikani') {
    const hasCurriculumLevel = Object.prototype.hasOwnProperty.call(detail, 'curriculumLevel')
    return (
      (!hasCurriculumLevel ||
        (typeof detail.curriculumLevel === 'number' &&
          Number.isInteger(detail.curriculumLevel) &&
          detail.curriculumLevel > 0)) &&
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

/** WaniKani secrets stay main-side; renderer settings expose only whether a token is set. */
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
  /** Main reports OS-backed encryption; undefined means not loaded, so the UI must make no encryption claim. */
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
