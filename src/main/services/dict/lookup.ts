// The dictionary lookup entry point: owns the `terms`/`dictionaries` SQL and the
// order the lookup stages run in. Each stage lives in its own module —
// deinflect.ts (conjugation candidates), reading.ts (kana normalization),
// termMetadata.ts (frequency/pitch enrichment), ranking.ts (result ordering), and
// crossReference.ts (redirect resolution) — and none of them import back here.

import type { FrequencyMode, LookupResult } from '../../../shared/dictionary'
import type { LookupDb } from './lookupDb'
import { deinflect, stemToDictionaryForms } from './deinflect'
import { katakanaReading, normalizeReading } from './reading'
import { attachFrequencies, attachPitchAccents, frequencyModeForDict } from './termMetadata'
import { sortRankedResults, type RankedResult } from './ranking'
import { resolveCrossReferences } from './crossReference'

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
