// Phase 2 · Task E1 — dictionary lookup service.
// Composes a small Yomitan-style deinflection table with a `terms`/`dictionaries`
// query so a token's lemma (or reading) resolves to definitions, falling back to
// deinflected candidates when the surface form itself isn't a dictionary headword.

import type { DbLike } from './schema'
import { priorityWeight, type FrequencyMode, type LookupResult } from '../../../shared/dictionary'
import { resolveCrossReferences } from './crossReference'

/** One suffix-stripping deinflection rule: `surface` ending in `suffix` may be
 * reconstructed by replacing it with `replacement` (e.g. undoing a conjugation). */
interface DeinflectRule {
  suffix: string
  replacement: string
}

/**
 * Ordered, longest-suffix-first rule table. Order matters only in that longer/more
 * specific suffixes should be tried before shorter ones they contain (e.g. the
 * `ました` rule vs a hypothetical bare `た` rule) so the more specific candidate is
 * also produced; since we collect ALL matching candidates (not just the first
 * match), strict ordering isn't load-bearing here, but longest-first keeps the
 * candidate list's earlier entries the more plausible ones.
 */
const DEINFLECT_RULES: DeinflectRule[] = [
  // Polite forms (ます-stem verbs): 飲みました/飲みません/飲みます -> 飲む is NOT
  // reachable by simple suffix-replacement alone (stem+u isn't a fixed suffix
  // swap), so we approximate by stripping the polite suffix and appending 'う'
  // family endings via the stem. Since a true stem->dictionary-form mapping
  // needs conjugation-class knowledge we don't have, keep this pragmatic: strip
  // the polite suffix down to the ます-stem, then offer stem+u as a guess for
  // godan verbs whose stem ends in an i-row kana that maps to a u-row ending.
  { suffix: 'ました', replacement: '' },
  { suffix: 'ません', replacement: '' },
  { suffix: 'ます', replacement: '' },
  // Negative
  { suffix: 'ない', replacement: 'る' },
  // Potential / passive-causative overlap (both -られる/-れる undo to -る)
  { suffix: 'られる', replacement: 'る' },
  { suffix: 'れる', replacement: 'る' },
  // Want-to
  { suffix: 'たい', replacement: 'る' },
  // Past / te-form (ichidan: 食べた/食べて -> 食べる)
  { suffix: 'た', replacement: 'る' },
  { suffix: 'て', replacement: 'る' }
]

/** Godan ます-stem (ren'youkei) final kana -> dictionary-form (-u row) final kana. */
const STEM_TO_DICTIONARY_ENDING: Record<string, string> = {
  い: 'う',
  ち: 'つ',
  り: 'る',
  き: 'く',
  ぎ: 'ぐ',
  し: 'す',
  び: 'ぶ',
  み: 'む',
  に: 'ぬ'
}

/**
 * Godan mizenkei (a-row) stem final kana -> dictionary-form (-u row) final kana.
 * This is the stem that -れる/-られる (potential/passive) and -ない (negative)
 * attach to (e.g. 飲む -> 飲ま + れる/ない), which is a DIFFERENT base than the
 * ます-stem above (e.g. 飲む -> 飲み + ます) and therefore needs its own mapping.
 */
const MIZENKEI_TO_DICTIONARY_ENDING: Record<string, string> = {
  あ: 'う',
  か: 'く',
  が: 'ぐ',
  さ: 'す',
  た: 'つ',
  な: 'ぬ',
  ば: 'ぶ',
  ま: 'む',
  ら: 'る'
}

/**
 * Given a bare stem (conjugation suffix already stripped) and a stem-ending ->
 * dictionary-ending map, return dictionary-form candidates: the ichidan guess
 * (stem + る) and, if the stem's final kana is in the map, the godan guess (swap
 * final kana to its u-row counterpart).
 */
function stemToCandidates(stem: string, endingMap: Record<string, string>): string[] {
  if (stem.length === 0) return []
  const candidates = [`${stem}る`]
  const lastKana = stem[stem.length - 1]
  const godanEnding = endingMap[lastKana]
  if (godanEnding) {
    candidates.push(`${stem.slice(0, -1)}${godanEnding}`)
  }
  return candidates
}

/** Ren'youkei (ます-stem) -> dictionary-form candidates. See `STEM_TO_DICTIONARY_ENDING`. */
function stemToDictionaryForms(stem: string): string[] {
  return stemToCandidates(stem, STEM_TO_DICTIONARY_ENDING)
}

/** Mizenkei (a-row) stem -> dictionary-form candidates. See `MIZENKEI_TO_DICTIONARY_ENDING`. */
function stemToMizenkeiDictionaryForms(stem: string): string[] {
  return stemToCandidates(stem, MIZENKEI_TO_DICTIONARY_ENDING)
}

/**
 * Returns plausible dictionary-form (lemma) candidates for a conjugated surface
 * form, by undoing one common conjugation step at a time. Pure string
 * suffix-stripping — no morphological analysis, so false-positive candidates are
 * expected and should simply miss in the DB lookup. Always includes `surface`
 * itself as the first candidate (identity), since a token may already be a
 * dictionary headword and not need deinflection at all.
 */
export function deinflect(surface: string): string[] {
  const candidates = new Set<string>([surface])

  for (const rule of DEINFLECT_RULES) {
    if (!surface.endsWith(rule.suffix)) continue
    const stem = surface.slice(0, surface.length - rule.suffix.length)
    if (rule.suffix === 'ました' || rule.suffix === 'ません' || rule.suffix === 'ます') {
      for (const candidate of stemToDictionaryForms(stem)) {
        candidates.add(candidate)
      }
    } else if (rule.suffix === 'ない' || rule.suffix === 'られる' || rule.suffix === 'れる') {
      for (const candidate of stemToMizenkeiDictionaryForms(stem)) {
        candidates.add(candidate)
      }
    } else {
      candidates.add(`${stem}${rule.replacement}`)
    }
  }

  return Array.from(candidates)
}

/** Structural subset of better-sqlite3's `Database` `lookup` needs: read-only. */
export interface LookupDb extends DbLike {
  prepare(sql: string): {
    all(...params: unknown[]): unknown[]
  }
}

interface TermJoinRow {
  expression: string
  reading: string
  glossary: string
  glossary_json: string | null
  title: string
  dict_id: number
  fallback_only: number
  styles_css: string | null
  def_tags: string | null
  term_tags: string | null
  rules: string | null
  score: number | null
}

/**
 * Dictionary order is `dictionaries.priority` ascending, then `dictionaries.id`
 * ascending for legacy rows with equal stored order. It is the final lookup
 * tie-breaker, not an override of match quality, priority tags, frequency, or score.
 */
const SELECT_BY_EXPRESSION = `
SELECT terms.expression AS expression, terms.reading AS reading,
       terms.glossary AS glossary, terms.glossary_json AS glossary_json,
       dictionaries.title AS title, dictionaries.id AS dict_id,
       dictionaries.fallback_only AS fallback_only,
       dictionaries.styles_css AS styles_css,
       terms.def_tags AS def_tags, terms.term_tags AS term_tags,
       terms.rules AS rules, terms.score AS score
FROM terms
JOIN dictionaries ON terms.dict_id = dictionaries.id
WHERE dictionaries.enabled = 1 AND (terms.expression = ? OR terms.reading IN (?, ?))
ORDER BY dictionaries.priority ASC, dictionaries.id ASC
`

const SELECT_BY_EXPRESSION_ONLY = `
SELECT terms.expression AS expression, terms.reading AS reading,
       terms.glossary AS glossary, terms.glossary_json AS glossary_json,
       dictionaries.title AS title, dictionaries.id AS dict_id,
       dictionaries.fallback_only AS fallback_only,
       dictionaries.styles_css AS styles_css,
       terms.def_tags AS def_tags, terms.term_tags AS term_tags,
       terms.rules AS rules, terms.score AS score
FROM terms
JOIN dictionaries ON terms.dict_id = dictionaries.id
WHERE dictionaries.enabled = 1 AND terms.expression = ?
ORDER BY dictionaries.priority ASC, dictionaries.id ASC
`

function toResults(rows: unknown[]): LookupResult[] {
  return (rows as TermJoinRow[]).map((row) => ({
    expression: row.expression,
    reading: row.reading,
    glossary: row.glossary,
    glossaryJson: row.glossary_json ?? null,
    dictTitle: row.title,
    dictId: row.dict_id,
    fallbackOnly: row.fallback_only === 1,
    stylesCss: row.styles_css ?? null,
    frequency: null,
    frequencyDisplay: null,
    pitchAccent: null,
    defTags: row.def_tags ?? '',
    termTags: row.term_tags ?? '',
    score: row.score ?? 0,
    rules: row.rules ?? ''
  }))
}

/** Converts full-width katakana to hiragana so MeCab and Yomitan readings compare equally. */
export function normalizeReading(reading: string): string {
  return reading.replace(/[ァ-ヶ]/g, (char) => String.fromCodePoint(char.codePointAt(0)! - 0x60))
}

function katakanaReading(reading: string): string {
  return normalizeReading(reading).replace(/[ぁ-ゖ]/g, (char) =>
    String.fromCodePoint(char.codePointAt(0)! + 0x60)
  )
}

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

/**
 * Stable sort of `results` by frequency. Rank dictionaries use lower values
 * first, while occurrence dictionaries use higher values first. Lookup itself
 * applies match-group and form relevance before this frequency comparison.
 *
 * Entries with frequency === null keep their original relative order and sort
 * after scored entries. Returns a new array; does not mutate `results`.
 */
export function sortByFrequency(results: LookupResult[], mode: FrequencyMode): LookupResult[] {
  const decorated = results.map((result, index) => ({ result, index }))

  decorated.sort((a, b) => {
    const lengthDiff = b.result.expression.length - a.result.expression.length
    if (lengthDiff !== 0) return lengthDiff

    const aFreq = a.result.frequency
    const bFreq = b.result.frequency
    if (aFreq === null && bFreq === null) return a.index - b.index
    if (aFreq === null) return 1
    if (bFreq === null) return -1
    const diff = mode === 'rank-based' ? aFreq - bFreq : bFreq - aFreq
    return diff !== 0 ? diff : a.index - b.index
  })

  return decorated.map((d) => d.result)
}

interface RankedResult {
  result: LookupResult
  /** Caller candidates are already longest-first; this remains internal. */
  matchGroup: number
  exactWrittenMatch: boolean
  dictionaryOrder: number
  stableOrder: number
}

function sortRankedResults(results: RankedResult[], mode: FrequencyMode): LookupResult[] {
  return [...results]
    .sort((a, b) => {
      const fallbackDiff =
        Number(a.result.fallbackOnly ?? false) - Number(b.result.fallbackOnly ?? false)
      if (fallbackDiff !== 0) return fallbackDiff

      const groupDiff = a.matchGroup - b.matchGroup
      if (groupDiff !== 0) return groupDiff

      // When both entries have corpus data, frequency identifies the intended
      // word more reliably than an exact written-form match. Keep written form
      // first when either entry lacks frequency: uncommon valid headwords must
      // not be buried merely because the frequency dictionary does not know them.
      const aFreq = a.result.frequency
      const bFreq = b.result.frequency
      if (aFreq !== null && bFreq !== null) {
        const frequencyDiff = mode === 'rank-based' ? aFreq - bFreq : bFreq - aFreq
        if (frequencyDiff !== 0) return frequencyDiff
      }

      const writtenDiff = Number(b.exactWrittenMatch) - Number(a.exactWrittenMatch)
      if (writtenDiff !== 0) return writtenDiff

      const priorityDiff =
        priorityWeight(b.result.termTags, b.result.defTags) -
        priorityWeight(a.result.termTags, a.result.defTags)
      if (priorityDiff !== 0) return priorityDiff

      // Only mixed null/non-null pairs reach here: both scored pairs were
      // decided above, and exact written form already settled the rest.
      if (aFreq === null && bFreq !== null) return 1
      if (aFreq !== null && bFreq === null) return -1

      const scoreDiff = b.result.score - a.result.score
      if (scoreDiff !== 0) return scoreDiff

      const dictionaryDiff = a.dictionaryOrder - b.dictionaryOrder
      return dictionaryDiff !== 0 ? dictionaryDiff : a.stableOrder - b.stableOrder
    })
    .map(({ result }) => result)
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

/**
 * Resolve a token to dictionary entries.
 *
 * If `query.longestMatchCandidates` is given (caller-supplied, longest-first —
 * see `buildLongestMatchCandidates` in state/wordLookup.ts), EVERY candidate that
 * hits `terms.expression` contributes its rows, longest candidate first — not
 * just the first one that hits. This lets a single MeCab token (e.g. 閻魔, split
 * apart from a sibling token 大王) resolve to the longer compound headword
 * (閻魔大王) a Yomitan-style dictionary indexes it under, while *also* still
 * surfacing the shorter compound/single-token headword (閻魔) below it when the
 * dictionary has both — the longest match leads, but it doesn't hide the rest.
 *
 * After whole-surface and compound candidates are tried, a direct match on
 * `query.lemma` itself (OR'd with `query.reading` if provided) is tried. It is
 * ranked ahead of intra-token prefix candidates, but behind longer candidates —
 * this is the "1-token" case `buildLongestMatchCandidates` deliberately
 * excludes. Only if
 * NONE of the above produced anything does `deinflect(query.lemma)` kick in,
 * trying each candidate in turn against `terms.expression` and stopping at (and
 * returning) the first one that hits — deinflection is a grammatical fallback,
 * not another "match length" to blend in.
 *
 * Duplicate rows (same dictionary id + expression + reading, which happens
 * when a candidate coincides with `query.lemma`) are collapsed, keeping the
 * first occurrence's position. Results are otherwise ordered by
 * match quality, then (when both entries have it) frequency, exact written form,
 * priority tags, remaining frequency presence, score, then stable dictionary order,
 * filtered to enabled dictionaries only. Dictionary order is stored as
 * `dictionaries.priority` ascending and breaks any equal stored values by id.
 * If `options.freqDictId` is given, the selected frequency dictionary provides
 * the frequency term above, using `options.sortMode` if given, otherwise its own
 * `frequency_mode` (see `frequencyModeForDict`). Each result's own dictionary
 * additionally supplies its `pitchAccent`, which is enrichment only and never
 * affects the order above (see `attachPitchAccents`).
 */
export function lookup(
  db: LookupDb,
  query: { lemma: string; reading?: string; surface?: string; longestMatchCandidates?: string[] },
  options?: { freqDictId?: number | null; sortMode?: FrequencyMode }
): LookupResult[] {
  const seen = new Set<string>()
  const results: RankedResult[] = []
  let stableOrder = 0

  // Both statements are re-run once per candidate branch below; compiling each
  // one once per lookup keeps the SQL and parameters identical while avoiding
  // repeated `prepare` calls. Deliberately scoped to this call — no cross-call cache.
  const byExpression = db.prepare(SELECT_BY_EXPRESSION)
  const byExpressionOnly = db.prepare(SELECT_BY_EXPRESSION_ONLY)

  const collect = (
    rows: unknown[],
    matchGroup: number,
    exactExpression: string | null,
    matchedSurface?: string
  ): void => {
    for (const result of toResults(rows)) {
      const key = `${result.dictId}:${result.expression}:${result.reading}`
      if (seen.has(key)) continue
      seen.add(key)
      results.push({
        result: matchedSurface === undefined ? result : { ...result, matchedSurface },
        matchGroup,
        exactWrittenMatch: exactExpression === result.expression,
        // SQL returns stable dictionary order; keep it internal to lookup results.
        dictionaryOrder: stableOrder,
        stableOrder: stableOrder++
      })
    }
  }

  const candidates = query.longestMatchCandidates ?? []
  // The first candidate shorter than the clicked surface is an intra-token
  // prefix. Compound and whole-surface candidates must still lead, while the
  // token's own lemma should beat prefixes such as 生き for 生き返った.
  const surfaceLength = query.surface?.length
  const firstPrefix =
    surfaceLength === undefined
      ? -1
      : candidates.findIndex((candidate) => candidate.length < surfaceLength)
  const directGroup = firstPrefix === -1 ? candidates.length : firstPrefix
  for (const [index, candidate] of candidates.entries()) {
    // A subtitle surface can be kana while a dictionary indexes its written
    // headword in kanji (よかろう -> 良かろう). Querying the candidate reading here
    // preserves longest-candidate ordering, so the full surface leads over a
    // shorter reading-only match such as よか.
    const matchGroup = index < directGroup ? index : index + 1
    collect(
      byExpression.all(candidate, normalizeReading(candidate), katakanaReading(candidate)),
      matchGroup,
      candidate,
      candidate
    )
    // `そう` attaches to a verb's ren'youkei (何とかなりそう -> 何とかなる).
    // Resolve only candidates ending exactly in the auxiliary: a longer
    // candidate such as 何とかなりそうね must not claim the shorter phrase.
    if (candidate.endsWith('そう')) {
      const stem = candidate.slice(0, -'そう'.length)
      for (const lemma of stemToDictionaryForms(stem)) {
        collect(byExpressionOnly.all(lemma), matchGroup, lemma, candidate)
      }
    }
  }

  const direct = query.reading
    ? byExpression.all(query.lemma, normalizeReading(query.reading), katakanaReading(query.reading))
    : byExpressionOnly.all(query.lemma)
  // A direct lemma result describes the clicked inflected surface too.  Keep
  // that surface provenance so the renderer can highlight the exact subtitle
  // span instead of trying to reconstruct it from the dictionary headword.
  collect(
    direct,
    directGroup,
    query.lemma,
    query.surface !== query.lemma ? query.surface : undefined
  )

  if (results.length === 0) {
    for (const candidate of deinflect(query.lemma)) {
      if (candidate === query.lemma) continue
      const rows = byExpressionOnly.all(candidate)
      if (rows.length > 0) {
        collect(rows, candidates.length + 2, candidate)
        break
      }
    }
  }

  if (results.length === 0) return []

  const freqDictId = options?.freqDictId
  const mode =
    options?.sortMode ?? (freqDictId == null ? 'rank-based' : frequencyModeForDict(db, freqDictId))
  const sorted =
    freqDictId !== null && freqDictId !== undefined
      ? (() => {
          const withFreq = attachFrequencies(
            db,
            results.map(({ result }) => result),
            freqDictId
          )
          return sortRankedResults(
            results.map((ranked, index) => ({ ...ranked, result: withFreq[index] })),
            mode
          )
        })()
      : sortRankedResults(results, mode)

  // Pitch is attached after ranking, on purpose: it enriches the results the
  // existing ordering already chose and never participates in that ordering.
  return attachPitchAccents(db, resolveCrossReferences(db, sorted))
}
