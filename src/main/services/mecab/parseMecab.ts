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

const VERB_CONJUNCTION_SUFFIXES = new Set(['て', 'で', 'ば', 'たり', 'ちゃ', 'じゃ'])
// IPADIC tags these contractions 動詞,非自立; UniDic tags them 助動詞.
const CONTRACTION_VERB_LEMMAS = new Set([
  'ちゃう',
  'じゃう',
  'ちまう',
  'じまう',
  'てる',
  'でる',
  'とく',
  'どく'
])
// なさい after a 連用形 verb: IPADIC 動詞,非自立 なさる, UniDic 動詞,非自立可能 為さる.
const POLITE_IMPERATIVE_LEMMAS = new Set(['なさる', '為さる'])

const GRAMMAR_PARTICLES = new Set(['て', 'で', 'ば', 'ちゃ', 'じゃ', 'は', 'たり', 'だり'])

// Lone tokens the popup may join into a grammar span: te-form auxiliaries
// (読んで|いる) and adjective or copula parts (高く|なかっ|た, 静か|では|ありません).
// Lone verbs keep theirs for the stem of a split suffix (降り|そう), a lone
// imperative or UniDic volitional (書こう), and IPADIC's 自立 ある after て.
// IPADIC's only 名詞,特殊 is hearsay そう (行く|そう).
const isGrammarSpanPart = (m: Morpheme): boolean =>
  m.pos === '動詞' ||
  (m.pos === '名詞' && m.pos1 === '特殊') ||
  m.pos === '形容詞' ||
  m.pos === '助動詞' ||
  m.pos === '接尾辞' ||
  m.pos1 === '接尾' ||
  m.pos1 === '助動詞語幹' ||
  (m.pos === '助詞' && GRAMMAR_PARTICLES.has(m.surface))

const field = (value: string | undefined): string => (value && value !== '*' ? value : '')

// UniDic tags a sub-lemma after a hyphen (引く-他動詞, トム-Tom); dictionaries and
// known words use the bare headword. Morphemes keep the tag (そう-様態 vs そう-伝聞).
const stripLemmaTag = (lemma: string): string => {
  const hyphen = lemma.indexOf('-', 1)
  return hyphen === -1 ? lemma : lemma.slice(0, hyphen)
}

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

    const lemma = field(fields[map.lemma]) || surface
    const token: Token = {
      surface,
      reading: field(fields[map.reading]),
      lemma: flavor === 'unidic' ? stripLemmaTag(lemma) : lemma,
      pos: fields[map.pos] ?? '',
      startOffset
    }
    const pos1 = field(fields[1])
    const morpheme: Morpheme = {
      surface,
      lemma,
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
        (pos1 === '接尾' ||
          (pos1 === '非自立' && CONTRACTION_VERB_LEMMAS.has(token.lemma)) ||
          ((pos1 === '非自立' || pos1 === '非自立可能') &&
            POLITE_IMPERATIVE_LEMMAS.has(token.lemma) &&
            previous !== undefined &&
            continuativeVerbTokens.has(previous))))
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

  for (const [token, morphemes] of morphemesByToken) {
    if (morphemes.length > 1 || isGrammarSpanPart(morphemes[0])) token.morphemes = morphemes
  }
  return tokens
}
