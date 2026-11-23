// MeCab emits surface\tfeatures and a final EOS; absent fields are '*'.
// IPADIC: POS 0, lemma 6, reading 7. UniDic: POS 0, lemma 7, reading 9 (surface pron, not lemma lForm).
// Both: pos1 1, conjugation type 4, conjugation form 5.

import type { DictFlavor, Morpheme, Token } from '../../../shared/token'

interface FieldMap {
  pos: number
  lemma: number
  reading: number
}

const FIELD_MAPS: Record<DictFlavor, FieldMap> = {
  ipadic: { pos: 0, lemma: 6, reading: 7 },
  unidic: { pos: 0, lemma: 7, reading: 9 }
}

const VERB_CONJUNCTION_SUFFIXES = new Set(['て', 'で', 'ば', 'たり'])
// IPADIC tags these contractions 動詞,非自立; UniDic tags them 助動詞.
const CONTRACTION_VERB_LEMMAS = new Set(['ちゃう', 'じゃう', 'ちまう', 'じまう'])

const isDependentVerb = (m: Morpheme): boolean =>
  m.pos === '動詞' && (m.pos1 === '非自立' || m.pos1 === '非自立可能')

const field = (value: string | undefined): string => (value && value !== '*' ? value : '')

// MeCab omits whitespace; align surfaces to the analysis text, whose offsets exclude display newlines.
export function parseMecab(flavor: DictFlavor, stdout: string, sourceText?: string): Token[] {
  const map = FIELD_MAPS[flavor]
  const tokens: Token[] = []
  const suffixedTokens = new Set<Token>()
  const continuativeVerbTokens = new Set<Token>()
  const morphemesByToken = new Map<Token, Morpheme[]>()
  const alignmentText = sourceText?.replace(/[\r\n]/g, '')
  let outputOffset = 0
  let alignmentOffset = 0
  let previousSurfaceEnd: number | undefined

  for (const line of stdout.split(/\r?\n/)) {
    if (line === '' || line === 'EOS') continue

    const tabIndex = line.indexOf('\t')
    if (tabIndex === -1) continue

    const surface = line.slice(0, tabIndex)
    const fields = line.slice(tabIndex + 1).split(',')

    const matchedOffset = alignmentText?.indexOf(surface, alignmentOffset)
    const startOffset =
      matchedOffset === undefined || matchedOffset < 0 ? outputOffset : matchedOffset
    if (alignmentText !== undefined) {
      alignmentOffset =
        matchedOffset !== undefined && matchedOffset >= 0
          ? matchedOffset + surface.length
          : Math.max(alignmentOffset, startOffset + surface.length)
    }

    const token: Token = {
      surface,
      reading: field(fields[map.reading]),
      lemma: field(fields[map.lemma]) || surface,
      pos: fields[map.pos] ?? '',
      startOffset
    }
    const pos1 = field(fields[1])
    const morpheme: Morpheme = {
      surface,
      lemma: token.lemma,
      pos: token.pos,
      pos1,
      conjugationType: field(fields[4]),
      conjugationForm: field(fields[5])
    }

    const previous = tokens.at(-1)
    const contiguous = previous !== undefined && previousSurfaceEnd === startOffset
    const isConjugationSuffix =
      token.pos === '助動詞' ||
      (token.pos === '助詞' &&
        pos1 === '接続助詞' &&
        VERB_CONJUNCTION_SUFFIXES.has(token.surface)) ||
      (token.pos === '動詞' &&
        (pos1 === '接尾' || (pos1 === '非自立' && CONTRACTION_VERB_LEMMAS.has(token.lemma))))
    const extendsVerb =
      contiguous &&
      previous?.pos === '動詞' &&
      (isConjugationSuffix ||
        (token.pos === '動詞' &&
          continuativeVerbTokens.has(previous) &&
          !suffixedTokens.has(previous)))
    if (previous && extendsVerb) {
      if (!isConjugationSuffix) previous.lemma = previous.surface + token.lemma
      previous.surface += token.surface
      previous.reading += token.reading
      morphemesByToken.get(previous)?.push(morpheme)
      if (isConjugationSuffix) suffixedTokens.add(previous)
      if (token.pos === '動詞' && fields[5]?.startsWith('連用'))
        continuativeVerbTokens.add(previous)
      else continuativeVerbTokens.delete(previous)
    } else {
      tokens.push(token)
      morphemesByToken.set(token, [morpheme])
      if (token.pos === '動詞' && fields[5]?.startsWith('連用')) continuativeVerbTokens.add(token)
    }

    outputOffset += surface.length
    previousSurfaceEnd = startOffset + surface.length
  }

  // A lone 非自立 verb may be a te-form auxiliary (読んで|いる) that the popup joins to its verb.
  for (const [token, morphemes] of morphemesByToken) {
    if (morphemes.length > 1 || isDependentVerb(morphemes[0])) token.morphemes = morphemes
  }
  return tokens
}
