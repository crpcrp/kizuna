import { isNonNegativeSafeInteger, isRecord } from './guards'

/** Which MeCab dictionary produced a token, since the feature-CSV layout differs. */
export type DictFlavor = 'ipadic' | 'unidic'

export interface Token {
  surface: string
  /** Kana reading; '' if unknown. */
  reading: string
  /** Dictionary/base form used for lookups; falls back to surface. */
  lemma: string

  pos: string
  /** Index of `surface` within the cue string, for span rendering. */
  startOffset: number
}

export function isToken(value: unknown): value is Token {
  return (
    isRecord(value) &&
    typeof value.surface === 'string' &&
    typeof value.reading === 'string' &&
    typeof value.lemma === 'string' &&
    typeof value.pos === 'string' &&
    isNonNegativeSafeInteger(value.startOffset)
  )
}

/** IPADIC uses 記号 and UniDic uses 補助記号; neither counts toward unknown vocabulary. */
export function isSymbolToken(token: Pick<Token, 'surface' | 'pos'>): boolean {
  return (
    token.surface.trim() === '' ||
    token.pos.includes('記号') ||
    /^[\p{P}\p{S}]+$/u.test(token.surface)
  )
}

/** Particles and auxiliary verbs count as understood; conjunctions and interjections remain vocabulary. */
export function isGrammarToken(token: Pick<Token, 'pos'>): boolean {
  return token.pos.includes('助詞') || token.pos.includes('助動詞')
}
