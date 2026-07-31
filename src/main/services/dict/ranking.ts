// Orders lookup results once the query stage has collected them and metadata has
// been attached. Pure comparison logic over already-fetched rows, so a change to
// ranking never touches the SQL or the enrichment queries.

import { priorityWeight, type FrequencyMode, type LookupResult } from '../../../shared/dictionary'

/**
 * A lookup result plus the match-quality facts only the query stage knows.
 * `matchGroup` is assigned by `lookup`: caller candidates are already
 * longest-first, so lower groups are better matches.
 */
export interface RankedResult {
  result: LookupResult
  matchGroup: number
  exactWrittenMatch: boolean
  dictionaryOrder: number
  stableOrder: number
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

/**
 * Orders collected lookup rows by fallback status, match group, then (when both
 * entries have it) frequency, exact written form, priority tags, remaining
 * frequency presence, score, and finally stable dictionary order.
 */
export function sortRankedResults(results: RankedResult[], mode: FrequencyMode): LookupResult[] {
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
