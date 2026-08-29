// Shared AnkiConnect DTOs, crossing main/preload/renderer. Pure data + a
// validating merge (mirrors shared/playerSettings.ts's normalize functions).

import type { Token } from './token'
import type { LookupResult } from './dictionary'
import type { JlptLevel } from './jlpt'

export type AnkiField =
  | 'word'
  | 'reading'
  | 'definition'
  | 'sentence'
  | 'frequency'
  | 'pitchAccent'
  | 'jlptLevel'
  | 'wordAudio'
  | 'picture'
  | 'sentenceAudio'
export type DuplicatePolicy = 'prevent-global' | 'prevent-deck' | 'overwrite' | 'allow'

export interface AnkiSettings {
  url: string
  /** AnkiConnect API key. Empty string when unset (the common local case). */
  apiKey: string
  deckName: string
  modelName: string
  /**
   * Which note field each mined value goes into; `''` means unmapped. For the
   * two media fields (`picture`, `sentenceAudio`) the mapping *is* the switch:
   * a mapped field means "put a picture / sentence clip on my cards", and an
   * unmapped one means the capture never runs. They deliberately have no
   * separate include-toggle: the earlier `includeScreenshot` /
   * `includeSentenceAudio` toggles defaulted off, so mapping the field and
   * mining still produced a card with no picture and no clip. `frequency` and
   * `pitchAccent` and `jlptLevel` follow the same rule: mapping the row *is*
   * the opt-in.
   */
  fieldMap: Record<AnkiField, string>
  tags: string[]
  includeWordAudio: boolean
  duplicatePolicy: DuplicatePolicy
}

/** Every mappable note field, in Options → Anki row order. */
export const ANKI_FIELDS: AnkiField[] = [
  'word',
  'reading',
  'definition',
  'sentence',
  'frequency',
  'pitchAccent',
  'jlptLevel',
  'wordAudio',
  'picture',
  'sentenceAudio'
]
const DUPLICATE_POLICIES: DuplicatePolicy[] = [
  'prevent-global',
  'prevent-deck',
  'overwrite',
  'allow'
]

export const defaultAnkiSettings: AnkiSettings = {
  url: 'http://127.0.0.1:8765',
  apiKey: '',
  deckName: '',
  modelName: '',
  fieldMap: {
    word: '',
    reading: '',
    definition: '',
    sentence: '',
    frequency: '',
    pitchAccent: '',
    jlptLevel: '',
    wordAudio: '',
    picture: '',
    sentenceAudio: ''
  },
  tags: ['kizuna'],
  includeWordAudio: true,
  duplicatePolicy: 'prevent-deck'
}

/**
 * Deep-merges `raw` against `defaultAnkiSettings`; never throws. The result is
 * rebuilt key by key, so a settings file written by an older build keeps its
 * field mapping while its retired `includeScreenshot` / `includeSentenceAudio`
 * flags are simply dropped — an install that had them off is not left with the
 * media features still disabled.
 */
export function mergeAnkiSettings(raw: unknown): AnkiSettings {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const rawFieldMap =
    obj.fieldMap && typeof obj.fieldMap === 'object'
      ? (obj.fieldMap as Record<string, unknown>)
      : {}

  const fieldMap = {} as Record<AnkiField, string>
  for (const field of ANKI_FIELDS) {
    fieldMap[field] =
      typeof rawFieldMap[field] === 'string'
        ? (rawFieldMap[field] as string)
        : defaultAnkiSettings.fieldMap[field]
  }

  return {
    url: typeof obj.url === 'string' ? obj.url : defaultAnkiSettings.url,
    apiKey: typeof obj.apiKey === 'string' ? obj.apiKey : defaultAnkiSettings.apiKey,
    deckName: typeof obj.deckName === 'string' ? obj.deckName : defaultAnkiSettings.deckName,
    modelName: typeof obj.modelName === 'string' ? obj.modelName : defaultAnkiSettings.modelName,
    fieldMap,
    tags:
      Array.isArray(obj.tags) && obj.tags.every((t) => typeof t === 'string')
        ? (obj.tags as string[])
        : defaultAnkiSettings.tags,
    includeWordAudio:
      typeof obj.includeWordAudio === 'boolean'
        ? obj.includeWordAudio
        : defaultAnkiSettings.includeWordAudio,
    duplicatePolicy: DUPLICATE_POLICIES.includes(obj.duplicatePolicy as DuplicatePolicy)
      ? (obj.duplicatePolicy as DuplicatePolicy)
      : defaultAnkiSettings.duplicatePolicy
  }
}

export interface AnkiPing {
  ok: boolean
  version?: number
  error?: string
}

/** Existing Anki card plus the exact decks where the matched cards live. */
export interface AnkiExistingMatch {
  cardId: number
  deckNames: string[]
}

/** The verified outcome of adding a new note or updating an existing one. */
export interface AnkiMineResult {
  noteId: number
  operation: 'added' | 'updated'
  changedFields: string[]
}

/** Result of the explicit, user-confirmed JLPT note-type setup action. */
export type AnkiJlptSetupResult =
  | {
      status: 'changed'
      modelName: string
      addedField: boolean
      updatedTemplates: string[]
    }
  | {
      status: 'already-configured'
      modelName: string
    }
  | {
      status: 'preflight-failure' | 'api-failure' | 'verification-failure'
      modelName: string
      message: string
    }

/** Maximum unique expressions accepted by one target-deck membership request. */
export const ANKI_MEMBERSHIP_BATCH_LIMIT = 100

export type AnkiMembershipMatches = Record<string, AnkiExistingMatch | null>

/** Maximum note IDs sent to one AnkiConnect notesInfo request. */
export const ANKI_BACKFILL_BATCH_LIMIT = 100

export interface AnkiJlptBackfillCounts {
  total: number
  wouldWrite: Record<JlptLevel, number>
  unclassified: number
  alreadyPopulated: number
  invalidSource: number
  destinationMissing: number
}

/** The only renderer-supplied write candidate data accepted by the main process. */
export interface AnkiJlptBackfillCandidate {
  noteId: number
  expectedTargetValue: ''
}

export interface AnkiJlptBackfillPreviewReady {
  status: 'ready'
  operationToken: string
  deckName: string
  modelName: string
  wordField: string
  readingField: string
  targetField: string
  counts: AnkiJlptBackfillCounts
  candidates: AnkiJlptBackfillCandidate[]
}

export interface AnkiJlptBackfillPreviewFailure {
  status: 'preflight-failure' | 'api-failure'
  modelName: string
  message: string
  /** True when the existing "Set up JLPT field" action can resolve the error. */
  setupRequired?: boolean
}

export type AnkiJlptBackfillPreview = AnkiJlptBackfillPreviewReady | AnkiJlptBackfillPreviewFailure

export interface AnkiJlptBackfillApplyRequest {
  operationToken: string
  candidates: AnkiJlptBackfillCandidate[]
}

export interface AnkiJlptBackfillProgress {
  operationToken: string
  completed: number
  total: number
}

export interface AnkiJlptBackfillResult {
  updated: number
  skipped: number
  failed: number
  firstError?: string
}

/** A captured video frame, already encoded as raw base64 JPEG (no data: URL
 * prefix) by the renderer's crop dialog. */
export interface MineScreenshot {
  dataBase64: string
}

/**
 * Where the mined sentence's audio can be clipped from, resolved by the
 * renderer before the mine. Present only for a loaded *local* file with a
 * selected audio stream and usable cue timing; the window is already in
 * media-clock seconds (the user's subtitle offset has been applied), so the
 * main process never re-derives subtitle timing.
 */
export interface MineMediaContext {
  /** Absolute path of the loaded local media file. Never a remote URL. */
  path: string
  /** Absolute (ffprobe `stream.index`) index of the selected audio stream. */
  audioStreamIndex: number
  /** Clip start in media-clock seconds; never negative. */
  startSec: number
  /** Clip end in media-clock seconds; always greater than `startSec`. */
  endSec: number
}

export interface MineRequest {
  token: Token
  result: LookupResult
  sentence: string
  /** Present only when the user accepted a captured frame in the crop dialog;
   * the service turns it into the note's `picture` attachment. */
  screenshot?: MineScreenshot
  /** Present only when sentence audio can be clipped for this mine; the
   * service turns a successful extraction into an extra `audio` attachment. */
  media?: MineMediaContext
}
