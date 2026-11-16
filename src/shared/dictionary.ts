import type { JlptLevel } from './jlpt'

/** Yomitan `term_meta` ranking mode. */
export type FrequencyMode = 'rank-based' | 'occurrence-based'

/** Yomitan/JMdict priority tags mark common words. */
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

/** `total` includes term/kanji and frequency rows, including frequency-only dictionaries. */
export interface ImportProgress {
  done: number
  total: number
}

export interface LookupResult {
  expression: string
  /** Caller-supplied surface candidate responsible for this result, when applicable. */
  matchedSurface?: string
  reading: string
  glossary: string
  dictTitle: string
  /** Dictionary ID used to scope bundled CSS to this dictionary's rows. */
  dictId: number

  fallbackOnly?: boolean
  /** Bundled Yomitan structured-content CSS; null when unavailable. */
  stylesCss: string | null
  /** term_meta.value from the chosen frequency dict (lower = more common), or null if none/unset. */
  frequency: number | null
  /** term_meta.display for the matched frequency row, or null if none. */
  frequencyDisplay: string | null
  /** Pitch drops from the highest-priority enabled dictionary; independent of frequency selection and ranking. */
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
  /** Same-dictionary audio cross-reference; display and mining still use `expression`. */
  audioExpression?: string
  /** Reading paired with `audioExpression`, when the resolved target has one. */
  audioReading?: string
  /** Raw Yomitan glossary JSON; when absent, split `glossary` on newlines. */
  glossaryJson?: string | null
}

export function pitchAccentValue(result: Pick<LookupResult, 'pitchAccent'>): string {
  return (result.pitchAccent ?? []).join(', ')
}

export interface DictInfo {
  id: number
  title: string
  revision: string
  enabled: boolean
  /** Name dictionaries are demoted below ordinary dictionary results. */
  fallbackOnly: boolean
  /** Zero-based UI order; used only as the final lookup tie-breaker. */
  priority: number

  schemaVersion: number
  /** Older schema data requires re-import before all dictionary features are available. */
  needsReimport: boolean
}
