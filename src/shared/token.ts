/** Which MeCab dictionary produced a token, since the feature-CSV layout differs. */
export type DictFlavor = 'ipadic' | 'unidic'

/** A single MeCab-segmented word within a subtitle cue. */
export interface Token {
  /** As it appears in the cue. */
  surface: string
  /** Kana reading; '' if unknown. */
  reading: string
  /** Dictionary/base form used for lookups; falls back to surface. */
  lemma: string
  /** Coarse part-of-speech. */
  pos: string
  /** Index of `surface` within the cue string, for span rendering. */
  startOffset: number
}

/**
 * Whether a token is punctuation/a writing symbol rather than a word — e.g.
 * '(', '?', '。', '「'. Both dict flavors' POS for these contains '記号'
 * (ipadic: top-level '記号'; unidic: '補助記号'), so a substring check covers
 * both. These tokens have nothing to "know", so callers should never count
 * them among a viewer's unknown vocabulary.
 */
export function isSymbolToken(token: Pick<Token, 'surface' | 'pos'>): boolean {
  return (
    token.surface.trim() === '' ||
    token.pos.includes('記号') ||
    /^[\p{P}\p{S}]+$/u.test(token.surface)
  )
}

/**
 * Whether a token is a grammatical function word — a particle ('助詞', which
 * also matches subtypes like '格助詞'/'接続助詞') or an auxiliary verb
 * ('助動詞') — in either dict flavor's POS string. Learners never mine these
 * as vocabulary, so callers treat them as well-known everywhere: no underline by default
 * in subtitles, counted as understood in the subtitle report, excluded from
 * its top-unknown list. Deliberately NOT included: 接続詞 (conjunctions),
 * 感動詞 (interjections), and ultra-common verbs like する — those are real
 * vocabulary; revisit with a curated stop-list only if the top-unknown list
 * stays noisy after this.
 */
export function isGrammarToken(token: Pick<Token, 'pos'>): boolean {
  return token.pos.includes('助詞') || token.pos.includes('助動詞')
}
