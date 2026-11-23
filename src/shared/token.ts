import { isNonNegativeSafeInteger, isRecord } from './guards'

/** Which MeCab dictionary produced a token, since the feature-CSV layout differs. */
export type DictFlavor = 'ipadic' | 'unidic'

export interface Morpheme {
  surface: string
  lemma: string
  pos: string
  /** Subcategory, e.g. 接尾 / 非自立 / 非自立可能 / 接続助詞; '' when absent. */
  pos1: string
  /** Conjugation type (五段・ラ行 / 下一段-バ行); '' when absent. */
  conjugationType: string
  /** Conjugation form (連用タ接続 / 連用形-促音便); '' when absent. */
  conjugationForm: string
}

export interface Token {
  surface: string
  /** Kana reading; '' if unknown. */
  reading: string
  /** Dictionary/base form used for lookups; falls back to surface. */
  lemma: string

  pos: string
  /** Index of `surface` within the cue string, for span rendering. */
  startOffset: number
  /** MeCab rows merged into this token; present when there are two or more, or for a lone grammar part (adjective, auxiliary, suffix). */
  morphemes?: Morpheme[]
}

function isMorpheme(value: unknown): value is Morpheme {
  return (
    isRecord(value) &&
    typeof value.surface === 'string' &&
    typeof value.lemma === 'string' &&
    typeof value.pos === 'string' &&
    typeof value.pos1 === 'string' &&
    typeof value.conjugationType === 'string' &&
    typeof value.conjugationForm === 'string'
  )
}

export function isToken(value: unknown): value is Token {
  return (
    isRecord(value) &&
    typeof value.surface === 'string' &&
    typeof value.reading === 'string' &&
    typeof value.lemma === 'string' &&
    typeof value.pos === 'string' &&
    isNonNegativeSafeInteger(value.startOffset) &&
    (value.morphemes === undefined ||
      (Array.isArray(value.morphemes) && value.morphemes.every(isMorpheme)))
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
