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

// Dictionary priority/id is the final tie-breaker, never an override of match quality.
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
    jlptLevel: null,
    defTags: row.def_tags ?? '',
    termTags: row.term_tags ?? '',
    score: row.score ?? 0,
    rules: row.rules ?? ''
  }))
}

// Keep all matching compounds longest-first, then the lemma ahead of shorter prefixes.
// Deinflection is a fallback only when those candidates yield nothing.
export function lookup(
  db: LookupDb,
  query: { lemma: string; reading?: string; surface?: string; longestMatchCandidates?: string[] },
  options?: { freqDictId?: number | null; sortMode?: FrequencyMode }
): LookupResult[] {
  const seen = new Set<string>()
  const results: RankedResult[] = []
  let stableOrder = 0

  // Prepare once per lookup to avoid recompiling SQL for every candidate.
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
  // The lemma must beat intra-token prefixes such as 生き for 生き返った.
  const surfaceLength = query.surface?.length
  const firstPrefix =
    surfaceLength === undefined
      ? -1
      : candidates.findIndex((candidate) => candidate.length < surfaceLength)
  const directGroup = firstPrefix === -1 ? candidates.length : firstPrefix
  for (const [index, candidate] of candidates.entries()) {
    // A kana surface can have a kanji headword (よかろう -> 良かろう); query its reading
    // here so the full surface still leads over shorter reading-only matches.
    const matchGroup = index < directGroup ? index : index + 1
    collect(
      byExpression.all(candidate, normalizeReading(candidate), katakanaReading(candidate)),
      matchGroup,
      candidate,
      candidate
    )
    // そう attaches to the ren'youkei (何とかなりそう -> 何とかなる); a longer
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
  // Retain the clicked surface so highlighting uses its subtitle span, not the headword.
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

  // Pitch enriches results without affecting their rank.
  return attachPitchAccents(db, resolveCrossReferences(db, sorted))
}
