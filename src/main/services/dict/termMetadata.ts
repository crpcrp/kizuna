// Reads `term_meta` and attaches frequency and pitch-accent data to results the
// lookup queries already produced. Enrichment only: nothing here decides which
// entries appear, and ranking lives in ranking.ts.

import type { FrequencyMode, LookupResult } from '../../../shared/dictionary'
import type { LookupDb } from './lookupDb'
import { normalizeReading } from './reading'

interface TermMetaFreqRow {
  expression: string
  reading: string | null
  value: number | null
  display: string | null
}

/** Max `expression` placeholders per `term_meta` query, to stay below SQLite's parameter limit. */
const FREQ_CHUNK_SIZE = 400

function selectFreqByExpressions(count: number): string {
  const placeholders = Array.from({ length: count }, () => '?').join(', ')
  return `
SELECT expression, reading, value, display
FROM term_meta
WHERE dict_id = ? AND mode = 'freq' AND expression IN (${placeholders})
`
}

interface FreqValue {
  value: number | null
  display: string | null
}

/**
 * For each result, look up its frequency value/display in `term_meta` for
 * `freqDictId`, preferring a reading-scoped row over a reading-agnostic one.
 * Issues one `expression IN (...)` query per up-to-`FREQ_CHUNK_SIZE` unique
 * expressions (not one query per result), so duplicate expressions across
 * results and large result sets don't cause N+1 querying. Results with no
 * matching row keep frequency/frequencyDisplay as null. Returns a new array
 * (does not mutate `results` or its entries).
 */
export function attachFrequencies(
  db: LookupDb,
  results: LookupResult[],
  freqDictId: number
): LookupResult[] {
  const uniqueExpressions = Array.from(new Set(results.map((r) => r.expression)))

  // Exact reading match wins; generic (reading-agnostic) entry is fallback.
  const exactByExpressionReading = new Map<string, FreqValue>()
  const genericByExpression = new Map<string, FreqValue>()

  for (let i = 0; i < uniqueExpressions.length; i += FREQ_CHUNK_SIZE) {
    const chunk = uniqueExpressions.slice(i, i + FREQ_CHUNK_SIZE)
    const rows = db
      .prepare(selectFreqByExpressions(chunk.length))
      .all(freqDictId, ...chunk) as TermMetaFreqRow[]
    for (const row of rows) {
      const value: FreqValue = { value: row.value, display: row.display }
      if (row.reading === null) {
        if (!genericByExpression.has(row.expression)) genericByExpression.set(row.expression, value)
      } else {
        const key = `${row.expression}\u0000${row.reading}`
        if (!exactByExpressionReading.has(key)) exactByExpressionReading.set(key, value)
      }
    }
  }

  return results.map((result) => {
    const exactKey = `${result.expression}\u0000${result.reading}`
    const match =
      exactByExpressionReading.get(exactKey) ?? genericByExpression.get(result.expression)
    return {
      ...result,
      frequency: match?.value ?? null,
      frequencyDisplay: match?.display ?? null
    }
  })
}

interface TermMetaPitchRow {
  expression: string
  reading: string | null
  pitch_positions: string | null
}

/**
 * Pitch dictionaries commonly ship only term metadata, so their `dict_id` is
 * absent from the displayed term results. Constrain the query to *enabled*
 * dictionaries rather than those results' dictionaries; the subquery still
 * binds the leading `idx_term_meta_expr` column without making a pitch-only
 * dictionary invisible.
 */
function selectPitchByExpressions(expressionCount: number): string {
  const placeholders = Array.from({ length: expressionCount }, () => '?').join(', ')
  return `
SELECT expression, reading, pitch_positions
FROM term_meta
WHERE dict_id IN (SELECT id FROM dictionaries WHERE enabled = 1)
  AND mode = 'pitch'
  AND expression IN (${placeholders})
ORDER BY
  (SELECT priority FROM dictionaries WHERE id = term_meta.dict_id) ASC,
  term_meta.dict_id ASC,
  term_meta.id ASC
`
}

/** Decodes a stored `term_meta.pitch_positions` JSON array, or null if unusable. */
function parseStoredPitchPositions(raw: string | null): number[] | null {
  if (typeof raw !== 'string') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!Array.isArray(parsed)) return null
  const positions = parsed.filter(
    (value): value is number => typeof value === 'number' && Number.isInteger(value) && value >= 0
  )
  return positions.length === 0 ? null : positions
}

/**
 * For each result, attach pitch-drop positions from the first enabled pitch
 * dictionary in dictionary priority order, preferring a row whose normalized
 * reading matches the result's over a reading-agnostic one. Pitch dictionaries
 * commonly contain metadata but no term rows, so limiting this to the result's
 * own dictionary would make their data unreachable.
 *
 * Mirrors `attachFrequencies`' batching — one query per up-to-`FREQ_CHUNK_SIZE`
 * unique expressions, covering every dictionary at once, never one per result
 * or per dictionary. Results with no matching row keep `pitchAccent: null`.
 * Returns a new array (does not mutate `results`).
 */
export function attachPitchAccents(db: LookupDb, results: LookupResult[]): LookupResult[] {
  const uniqueExpressions = Array.from(new Set(results.map((r) => r.expression)))
  if (uniqueExpressions.length === 0) return results

  const exactByExpressionReading = new Map<string, number[]>()
  const genericByExpression = new Map<string, number[]>()

  for (let i = 0; i < uniqueExpressions.length; i += FREQ_CHUNK_SIZE) {
    const chunk = uniqueExpressions.slice(i, i + FREQ_CHUNK_SIZE)
    const rows = db
      .prepare(selectPitchByExpressions(chunk.length))
      .all(...chunk) as TermMetaPitchRow[]
    for (const row of rows) {
      const positions = parseStoredPitchPositions(row.pitch_positions)
      if (positions === null) continue
      if (row.reading === null || row.reading === '') {
        if (!genericByExpression.has(row.expression))
          genericByExpression.set(row.expression, positions)
      } else {
        const key = `${row.expression}\u0000${normalizeReading(row.reading)}`
        if (!exactByExpressionReading.has(key)) exactByExpressionReading.set(key, positions)
      }
    }
  }

  return results.map((result) => {
    const match =
      exactByExpressionReading.get(
        `${result.expression}\u0000${normalizeReading(result.reading)}`
      ) ?? genericByExpression.get(result.expression)
    return { ...result, pitchAccent: match ?? null }
  })
}

interface DictFrequencyModeRow {
  frequency_mode: string | null
}

/**
 * Looks up `dictionaries.frequency_mode` for `freqDictId`, defaulting to
 * 'rank-based' if the dict row is missing or holds an unrecognized value
 * (mirrors `parseIndex`'s default in yomitanImport.ts).
 */
export function frequencyModeForDict(db: LookupDb, freqDictId: number): FrequencyMode {
  const row = db
    .prepare('SELECT frequency_mode FROM dictionaries WHERE id = ?')
    .all(freqDictId)[0] as DictFrequencyModeRow | undefined
  return row?.frequency_mode === 'occurrence-based' ? 'occurrence-based' : 'rank-based'
}
