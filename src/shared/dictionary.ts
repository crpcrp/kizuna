// Shared Yomitan dictionary DTOs, crossing main/preload/renderer. Pure data.

import type { JlptLevel } from './jlpt'

/** How a frequency dict's `term_meta` value should be ranked (see `sortByFrequency`). */
export type FrequencyMode = 'rank-based' | 'occurrence-based'

/**
 * Returns a positive weight when a Yomitan/JMdict term or definition tag marks
 * a common word. Keep this shared so lookup ranking and the popup's common-word
 * marker agree.
 */
export function priorityWeight(termTags: string, defTags = ''): number {
  const priorityTags = new Set([
    'P',
    'news1',
    'news2',
    'ichi1',
    'ichi2',
    'spec1',
    'spec2',
    'gai1',
    'gai2',
    '★'
  ])
  return `${termTags} ${defTags}`.split(/\s+/).some((tag) => priorityTags.has(tag)) ? 1 : 0
}

export interface ImportResult {
  dictId: number
  termCount: number
  metaCount: number
}

/**
 * Periodic progress push while a dictionary import is in flight (advisory —
 * the import worker posts these every `progressBatchSize` rows inserted).
 * `total` counts term/kanji rows and frequency rows together, so a
 * frequency-only dictionary still reports progress.
 */
export interface ImportProgress {
  done: number
  total: number
}

/** One resolved dictionary entry returned by `lookup`. */
export interface LookupResult {
  expression: string
  /** Caller-supplied surface candidate responsible for this result, when applicable. */
  matchedSurface?: string
  reading: string
  glossary: string
  dictTitle: string
  /** dictionaries.id this result came from — lets the popup scope a dictionary's own CSS to its own rows. */
  dictId: number
  /** True when this result comes from a dictionary shown only as a fallback. */
  fallbackOnly?: boolean
  /**
   * dictionaries.styles_css — a dictionary-bundled `styles.css` (Yomitan
   * dictionary format, added in yomidevs/yomitan#1080) that styles its own
   * structured-content glossary markup, or null if the dictionary didn't
   * ship one (or predates schema < 3).
   */
  stylesCss: string | null
  /** term_meta.value from the chosen frequency dict (lower = more common), or null if none/unset. */
  frequency: number | null
  /** term_meta.display for the matched frequency row, or null if none. */
  frequencyDisplay: string | null
  /**
   * Pitch-drop positions from the highest-priority enabled dictionary that
   * ships metadata for this expression/reading, or null when none does. Unlike
   * `frequency`, this ignores the separately selected frequency dictionary and
   * it takes no part in lookup ranking — it is enrichment only.
   */
  pitchAccent: number[] | null
  /** Community-sourced approximate JLPT vocabulary level, or null when no safe match exists. */
  jlptLevel: JlptLevel | null
  /** terms.def_tags, '' if null. */
  defTags: string
  /** terms.term_tags, '' if null. */
  termTags: string
  /** terms.score, 0 if null. */
  score: number
  /** terms.rules, '' if null. */
  rules: string
  /**
   * A same-dictionary cross-reference target used only to request word audio.
   * The displayed and mined headword remains `expression`.
   */
  audioExpression?: string
  /** Reading paired with `audioExpression`, when the resolved target has one. */
  audioReading?: string
  /**
   * terms.glossary_json — the raw Yomitan glossary array, JSON-encoded, or
   * null/undefined for rows imported before this field existed (schema < 2).
   * The popup renders this when present and falls back to splitting
   * `glossary` on newlines otherwise.
   */
  glossaryJson?: string | null
}

/**
 * Formats a lookup result's already-resolved pitch-drop positions for display
 * and export. Keeping this shared guarantees the popup and Anki receive the
 * same deterministic value without either path performing another lookup.
 */
export function pitchAccentValue(result: Pick<LookupResult, 'pitchAccent'>): string {
  return (result.pitchAccent ?? []).join(', ')
}

/** One row of `listDicts`, reflecting the `dictionaries` table. */
export interface DictInfo {
  id: number
  title: string
  revision: string
  enabled: boolean
  /** Name dictionaries are demoted below ordinary dictionary results. */
  fallbackOnly: boolean
  /**
   * Stable dictionary order (zero-based; lower appears first in the
   * Dictionaries UI). Lookup uses it only as its final tie-breaker.
   */
  priority: number
  /** Schema version this dict was imported under. */
  schemaVersion: number
  /**
   * True when this dict was imported under an older schema and lacks the
   * frequency/def-tag/newline-sense data newer features need — the Options UI
   * surfaces a "re-import" prompt for these. Computed as
   * `schemaVersion < CURRENT_DICT_SCHEMA_VERSION`.
   */
  needsReimport: boolean
}
