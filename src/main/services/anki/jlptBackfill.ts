import type { AnkiJlptBackfillCounts, AnkiSettings } from '../../../shared/anki'
import { JLPT_LEVELS, type JlptLevel } from '../../../shared/jlpt'
import type { AnkiNoteInfo } from './ankiConnect'
import type { JlptClassifier } from '../jlpt/classifier'

export interface JlptBackfillFields {
  wordField: string
  readingField: string
  targetField: string
}

export type JlptBackfillClassification =
  | { kind: 'would-write'; level: JlptLevel }
  | { kind: 'unclassified' }
  | { kind: 'already-populated' }
  | { kind: 'invalid-source' }
  | { kind: 'destination-missing' }

/** Removes markup Anki stores around note-field text and normalizes spaces. */
export function stripHtml(value: string): string {
  let stripped = value
  let previous: string
  do {
    previous = stripped
    stripped = stripped.replace(/<[^>]*>/gu, '')
  } while (stripped !== previous)

  return stripped.replace(/&nbsp;/giu, ' ')
}

const KANA_ONLY = /^[ぁ-ゖァ-ヺーゝゞヽヾ]+$/u

function isKana(value: string): boolean {
  return KANA_ONLY.test(value)
}

/**
 * Converts a plain kana or Anki furigana reading to classifier input. Anki's
 * `漢字[かんじ]かな` form becomes `かんじかな`; malformed ruby is ignored so
 * the caller can safely use expression-only classification instead.
 */
export function normalizeBackfillReading(rawValue: string): string | undefined {
  const value = stripHtml(rawValue).replace(/\s+/gu, '')
  if (value === '') return undefined
  if (!value.includes('[') && !value.includes(']')) return isKana(value) ? value : undefined

  let cursor = 0
  let reading = ''
  while (cursor < value.length) {
    const open = value.indexOf('[', cursor)
    const close = value.indexOf(']', cursor)
    if (close !== -1 && (open === -1 || close < open)) return undefined

    if (open === -1) {
      const tail = value.slice(cursor)
      return isKana(tail) ? reading + tail || undefined : undefined
    }

    const base = value.slice(cursor, open)
    const end = value.indexOf(']', open + 1)
    if (base === '' || end === -1) return undefined
    const ruby = value.slice(open + 1, end)
    if (!isKana(ruby)) return undefined
    reading += ruby
    cursor = end + 1
  }

  return reading === '' ? undefined : reading
}

/** Classifies one note without reading or mutating Anki. */
export function classifyBackfillNote(
  note: AnkiNoteInfo | undefined,
  fields: JlptBackfillFields,
  classifier: JlptClassifier
): JlptBackfillClassification {
  const target = note?.fields?.[fields.targetField]
  if (!target || typeof target.value !== 'string') return { kind: 'destination-missing' }
  if (target.value.trim() !== '') return { kind: 'already-populated' }

  const word = note?.fields?.[fields.wordField]
  if (!word || typeof word.value !== 'string') return { kind: 'invalid-source' }
  const expression = stripHtml(word.value).trim()
  if (expression === '') return { kind: 'invalid-source' }

  const rawReading = fields.readingField ? note?.fields?.[fields.readingField]?.value : undefined
  const reading = typeof rawReading === 'string' ? normalizeBackfillReading(rawReading) : undefined
  const level = classifier.levelFor(expression, reading)
  return level === null ? { kind: 'unclassified' } : { kind: 'would-write', level }
}

/** Creates the mutually-exclusive preview counters. */
export function emptyBackfillCounts(total = 0): AnkiJlptBackfillCounts {
  return {
    total,
    wouldWrite: Object.fromEntries(JLPT_LEVELS.map((level) => [level, 0])) as Record<
      JlptLevel,
      number
    >,
    unclassified: 0,
    alreadyPopulated: 0,
    invalidSource: 0,
    destinationMissing: 0
  }
}

/** Adds one classification and returns a fresh count object. */
export function addBackfillClassification(
  counts: AnkiJlptBackfillCounts,
  classification: JlptBackfillClassification
): AnkiJlptBackfillCounts {
  const next = { ...counts, wouldWrite: { ...counts.wouldWrite } }
  switch (classification.kind) {
    case 'would-write':
      next.wouldWrite[classification.level] += 1
      break
    case 'unclassified':
      next.unclassified += 1
      break
    case 'already-populated':
      next.alreadyPopulated += 1
      break
    case 'invalid-source':
      next.invalidSource += 1
      break
    case 'destination-missing':
      next.destinationMissing += 1
      break
  }
  return next
}

/** Extracts the fields used by the pure classifier from persisted settings. */
export function backfillFields(settings: AnkiSettings): JlptBackfillFields {
  return {
    wordField: settings.fieldMap.word,
    readingField: settings.fieldMap.reading,
    targetField: settings.fieldMap.jlptLevel
  }
}
