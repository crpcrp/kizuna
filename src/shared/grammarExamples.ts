// Tatoeba example sentences for a grammar pattern, built locally from Tatoeba's exports.

export interface GrammarExample {
  japanese: string
  english: string
  /** Character span of the matching word inside `japanese`, for highlighting. */
  start: number
  end: number
  sameWord: boolean
  /** Tatoeba sentence id of the Japanese sentence, for the source link. */
  tatoebaId: number
}

export interface GrammarExamplePage {
  examples: GrammarExample[]
  total: number
  sameWordTotal: number
}

export const EMPTY_GRAMMAR_EXAMPLE_PAGE: GrammarExamplePage = {
  examples: [],
  total: 0,
  sameWordTotal: 0
}

/** The installed example database. */
export interface GrammarExamplesInfo {
  dictionaryId: 'ipadic' | 'unidic'
  /** ISO timestamp of the build. */
  builtAt: string
  /** Newest `Last-Modified` of the Tatoeba exports it was built from. */
  exportDate: string | null
  exampleCount: number
}

export interface GrammarExamplesStatus {
  state: 'not-installed' | 'downloading' | 'building' | 'ready' | 'out-of-date' | 'error'
  info?: GrammarExamplesInfo
  /** The compressed exports are cached, so a rebuild needs no network. */
  cached: boolean
  /** Bytes while downloading; percent (of 100) while building. */
  progress?: { done: number; total: number }
  error?: string
}

/** Tatoeba's sentence page; the main process opens only URLs built here. */
export function tatoebaSentenceUrl(id: number): string {
  return `https://tatoeba.org/en/sentences/show/${id}`
}

/** True when the pattern contains a step whose meaning the examples cannot disambiguate. */
export function patternHasAmbiguousPassive(patternKey: string): boolean {
  return patternKey.split('>').includes('passive-potential')
}
