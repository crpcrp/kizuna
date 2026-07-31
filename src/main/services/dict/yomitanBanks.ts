// Yomitan bank formats: turns the JSON found inside a dictionary zip
// (`index.json`, `term_bank_N.json`, `kanji_bank_N.json`,
// `term_meta_bank_N.json`) into the row shapes the `terms` and `term_meta`
// tables store. Pure parsing — nothing here reads an archive or touches a
// database, and everything is specific to the Yomitan v3 format.

import type { FrequencyMode } from '../../../shared/dictionary'

/** Parsed `index.json` metadata for a Yomitan dictionary. */
export interface DictMeta {
  title: string
  revision: string
  /** Yomitan schema format/version number (e.g. 3). */
  format: number
  /**
   * From index.json's optional `frequencyMode` field: 'rank-based' means a
   * lower value is more common (a position in a ranking), 'occurrence-based'
   * means a higher value is more common (a raw count). Defaults to
   * 'rank-based' when absent or unrecognized, matching Yomitan's convention
   * for dictionaries that predate this field.
   */
  frequencyMode: FrequencyMode
}

/** One row derived from a Yomitan term bank entry, aligned with the `terms` table. */
export interface TermRow {
  expression: string
  reading: string
  /** Definition tags, space-separated string as Yomitan stores them. */
  termTags: string
  /** Sense/definition tags (Yomitan tuple index 2), space-separated string. */
  defTags: string
  rules: string
  score: number
  /** Normalized glossary text (joined, structured entries flattened to text). */
  glossary: string
  /**
   * The raw Yomitan glossary array (mix of plain strings and
   * structured-content entries), JSON-encoded verbatim. Lets the popup
   * render notes/lists/cross-references with their original structure
   * instead of the flattened `glossary` text above, which loses it.
   */
  glossaryJson: string
  sequence: number
}

/** One row derived from a Yomitan `term_meta_bank_N.json` entry (frequency or pitch data). */
export interface TermMetaRow {
  expression: string
  reading: string | null
  mode: string
  value: number | null
  display: string | null
  /**
   * Pitch-drop positions for a `mode === 'pitch'` row, in source order with
   * duplicates removed. Always null for frequency rows — the two modes never
   * share a column (see `CREATE_TERM_META_TABLE`).
   */
  pitchPositions: number[] | null
}

/**
 * Parse a Yomitan `index.json` object into DictMeta.
 * Accepts both `format` and legacy `version` field names.
 */
export function parseIndex(json: unknown): DictMeta {
  const obj = (json ?? {}) as Record<string, unknown>
  const title = typeof obj.title === 'string' ? obj.title : ''
  const revision = typeof obj.revision === 'string' ? obj.revision : String(obj.revision ?? '')
  const rawFormat = obj.format ?? obj.version
  const format = typeof rawFormat === 'number' ? rawFormat : Number(rawFormat ?? 0)
  const frequencyMode: FrequencyMode =
    obj.frequencyMode === 'occurrence-based' ? 'occurrence-based' : 'rank-based'
  return { title, revision, format, frequencyMode }
}

/** JMnedict is a names dictionary, so lookup should use it as a fallback. */
export function isNameDictionaryTitle(title: string): boolean {
  return /jmnedict/i.test(title)
}

/** Flatten a single glossary entry (string or structured object) to plain text. */
function normalizeGlossaryEntry(entry: unknown): string {
  if (typeof entry === 'string') return entry
  if (entry && typeof entry === 'object') {
    const obj = entry as Record<string, unknown>
    if (typeof obj.text === 'string') return obj.text
    if (Array.isArray(obj.content)) {
      return obj.content.map(normalizeGlossaryEntry).join(' ')
    }
    if (typeof obj.content === 'string') return obj.content
  }
  return ''
}

/** Joins normalized senses with newlines. */
function normalizeGlossary(glossary: unknown): string {
  if (!Array.isArray(glossary)) return ''
  return glossary
    .map(normalizeGlossaryEntry)
    .filter((s) => s.length > 0)
    .join('\n')
}

/**
 * Whether a raw term-bank entry is a well-formed Yomitan v3 tuple: the
 * 8-element [expression, reading, defTags, rules, score, glossary[], sequence,
 * termTags]. Shared by `parseTermBank` and `countTermBank` so the rows the
 * import counts and the rows it later inserts can never disagree.
 */
function isValidTermEntry(entry: unknown): boolean {
  if (!Array.isArray(entry) || entry.length !== 8) return false
  const [expression, reading, defTags, rules, score, , sequence, termTags] = entry
  if (typeof expression !== 'string' || typeof reading !== 'string') return false
  if (typeof defTags !== 'string') return false
  if (typeof rules !== 'string') return false
  if (typeof score !== 'number') return false
  if (typeof sequence !== 'number') return false
  return typeof termTags === 'string'
}

/**
 * Number of rows `parseTermBank` would return, without building any of them.
 *
 * The import needs a row total up front to size its progress bar and to hand
 * each bank a contiguous id range. Counting the raw bank avoids constructing
 * rows only to discard them, including an extra `normalizeGlossary` and
 * `JSON.stringify` per row.
 * per import. On jitendex (432,643 rows) skipping that construction cuts the
 * counting pass from 5,963 ms to 4,752 ms.
 */
export function countTermBank(json: unknown): number {
  if (!Array.isArray(json)) return 0
  let count = 0
  for (const entry of json) {
    if (isValidTermEntry(entry)) count += 1
  }
  return count
}

/**
 * Parse a Yomitan v3 term_bank_N.json array into TermRows.
 * Malformed entries (not arrays, wrong length, wrong field types) are skipped —
 * see `isValidTermEntry` for the tuple shape.
 */
export function parseTermBank(json: unknown): TermRow[] {
  if (!Array.isArray(json)) return []
  const rows: TermRow[] = []
  for (const entry of json) {
    if (!isValidTermEntry(entry)) continue
    const [expression, reading, defTags, rules, score, glossary, sequence, termTags] = entry
    rows.push({
      expression,
      reading,
      termTags,
      defTags,
      rules,
      score,
      glossary: normalizeGlossary(glossary),
      glossaryJson: JSON.stringify(Array.isArray(glossary) ? glossary : []),
      sequence
    })
  }
  return rows
}

/**
 * Parse a Yomitan v3 `kanji_bank_N.json` array into TermRows.
 *
 * Kanji dictionaries (KANJIDIC and friends) ship `kanji_bank_N.json` instead of
 * `term_bank_N.json`, and each entry is the 6-element tuple:
 * `[character, onyomi, kunyomi, tags, meanings[], stats{}]`. Their bank name
 * and entry shape require their own import path.
 *
 * Each character maps onto one `terms` row so kanji lookups flow through the
 * existing query path unchanged: `expression` is the character, `reading` stays
 * empty (a kanji has no single canonical reading, and a non-empty one here
 * would make it match reading-based lookups for one arbitrary reading), and the
 * on/kun readings become the glossary's first line so they stay visible in the
 * popup. `stats` is dropped — it is reference-book index numbers (Halpern,
 * Heisig, SKIP …), not something the popup shows.
 */
export function parseKanjiBank(json: unknown): TermRow[] {
  if (!Array.isArray(json)) return []
  const rows: TermRow[] = []
  for (const entry of json) {
    const glossaryEntries = kanjiGlossaryEntries(entry)
    if (glossaryEntries === null) continue
    const [character, , , tags] = entry as unknown[]
    rows.push({
      expression: character as string,
      reading: '',
      termTags: tags as string,
      defTags: '',
      rules: '',
      score: 0,
      glossary: glossaryEntries.join('\n'),
      glossaryJson: JSON.stringify(glossaryEntries),
      sequence: 0
    })
  }
  return rows
}

/**
 * The glossary lines one kanji-bank entry contributes, or null when the entry
 * is malformed or carries nothing worth showing. Shared by `parseKanjiBank` and
 * `countKanjiBank` so counted and inserted rows agree.
 */
function kanjiGlossaryEntries(entry: unknown): string[] | null {
  if (!Array.isArray(entry) || entry.length !== 6) return null
  const [character, onyomi, kunyomi, tags, meanings] = entry
  if (typeof character !== 'string' || character === '') return null
  if (typeof onyomi !== 'string' || typeof kunyomi !== 'string') return null
  if (typeof tags !== 'string') return null
  if (!Array.isArray(meanings)) return null
  const senses = meanings.filter((m): m is string => typeof m === 'string' && m.length > 0)
  const readingLine = [onyomi === '' ? '' : `音: ${onyomi}`, kunyomi === '' ? '' : `訓: ${kunyomi}`]
    .filter((part) => part !== '')
    .join('　')
  const glossaryEntries = readingLine === '' ? senses : [readingLine, ...senses]
  return glossaryEntries.length === 0 ? null : glossaryEntries
}

/** Number of rows `parseKanjiBank` would return, without building them. */
export function countKanjiBank(json: unknown): number {
  if (!Array.isArray(json)) return 0
  let count = 0
  for (const entry of json) {
    if (kanjiGlossaryEntries(entry) !== null) count += 1
  }
  return count
}

/** Extracts a finite number from a raw frequency `value`, or null if unparseable. */
function parseFreqValue(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  if (typeof raw === 'string' && raw.trim() !== '' && Number.isFinite(Number(raw))) {
    return Number(raw)
  }
  return null
}

/**
 * Pitch-drop positions from a `mode === 'pitch'` entry's `data.pitches`, or
 * null when the payload isn't the supported Yomitan shape. Only non-negative
 * integers count; a `pitches` element that isn't an object with such a
 * `position` is skipped, and a record left with no position at all is dropped
 * rather than stored as an empty accent (an unknown pitch is not "heiban").
 * Duplicates are removed while preserving source order.
 */
function parsePitchPositions(pitches: unknown): number[] | null {
  if (!Array.isArray(pitches)) return null
  const positions: number[] = []
  for (const pitch of pitches) {
    if (!pitch || typeof pitch !== 'object') continue
    const { position } = pitch as Record<string, unknown>
    if (typeof position !== 'number' || !Number.isInteger(position) || position < 0) continue
    if (!positions.includes(position)) positions.push(position)
  }
  return positions.length === 0 ? null : positions
}

/**
 * Parse a Yomitan v3 term_meta_bank_N.json array into TermMetaRows.
 * Each entry is expected to be the 3-element tuple: [expression, mode, data].
 * `mode === 'freq'` and `mode === 'pitch'` entries are handled; other modes are
 * skipped.
 *
 * For `freq`, `data` may be a bare number/numeric-string, a
 * `{ value, displayValue? }` object, or a `{ reading, frequency }` object where
 * `frequency` is itself a number or `{ value, displayValue? }`.
 *
 * For `pitch`, `data` must be a `{ reading, pitches: [{ position }] }` object —
 * see `parsePitchPositions`. The reading is required, because a pitch pattern
 * belongs to one reading of the expression, not to the expression as a whole.
 *
 * Malformed entries are skipped.
 */
export function parseTermMetaBank(json: unknown): TermMetaRow[] {
  if (!Array.isArray(json)) return []
  const rows: TermMetaRow[] = []
  for (const entry of json) {
    if (!Array.isArray(entry) || entry.length !== 3) continue
    const [expression, mode, data] = entry
    if (typeof expression !== 'string') continue

    if (mode === 'pitch') {
      if (!data || typeof data !== 'object') continue
      const obj = data as Record<string, unknown>
      if (typeof obj.reading !== 'string' || obj.reading === '') continue
      const pitchPositions = parsePitchPositions(obj.pitches)
      if (pitchPositions === null) continue
      rows.push({
        expression,
        reading: obj.reading,
        mode: 'pitch',
        value: null,
        display: null,
        pitchPositions
      })
      continue
    }

    if (mode !== 'freq') continue

    let reading: string | null = null
    let value: number | null = null
    let display: string | null = null

    if (typeof data === 'number' || typeof data === 'string') {
      value = parseFreqValue(data)
      if (value === null) continue
      display = String(data)
    } else if (data && typeof data === 'object') {
      const obj = data as Record<string, unknown>
      if (typeof obj.reading === 'string') {
        reading = obj.reading
        const freq = obj.frequency
        if (typeof freq === 'number' || typeof freq === 'string') {
          value = parseFreqValue(freq)
          if (value === null) continue
          display = String(freq)
        } else if (freq && typeof freq === 'object') {
          const freqObj = freq as Record<string, unknown>
          value = parseFreqValue(freqObj.value)
          if (value === null) continue
          display = typeof freqObj.displayValue === 'string' ? freqObj.displayValue : String(value)
        } else {
          continue
        }
      } else if ('value' in obj) {
        value = parseFreqValue(obj.value)
        if (value === null) continue
        display = typeof obj.displayValue === 'string' ? obj.displayValue : String(value)
      } else {
        continue
      }
    } else {
      continue
    }

    rows.push({ expression, reading, mode, value, display, pitchPositions: null })
  }
  return rows
}
