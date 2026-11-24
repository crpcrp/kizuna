// MeCab emits surface\tfeatures and a final EOS; absent fields are '*'.
// IPADIC: POS 0, lemma 6, reading 7. UniDic: POS 0, lemma 7, reading 20 (kana spelling, ベンキョウ),
// falling back to 9 (pronunciation, ベンキョー) for UniDic 2.1.2, which has no column 20.
// Both: pos1 1, conjugation type 4, conjugation form 5.

import type { DictFlavor, Morpheme, Token } from '../../../shared/token'

interface FieldMap {
  pos: number
  lemma: number
  reading: number
  fallbackReading?: number
}

const FIELD_MAPS: Record<DictFlavor, FieldMap> = {
  ipadic: { pos: 0, lemma: 6, reading: 7 },
  unidic: { pos: 0, lemma: 7, reading: 20, fallbackReading: 9 }
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

const GRAMMAR_PARTICLES = new Set(['て', 'で', 'ば', 'ちゃ', 'じゃ', 'は', 'たり', 'だり', 'も'])

// Lone tokens the popup may join into a grammar span: te-form auxiliaries
// (読んで|いる) and adjective or copula parts (高く|なかっ|た, 静か|では|ありません).
// Lone verbs keep theirs for the stem of a split suffix (降り|そう), a lone
// imperative or UniDic volitional (書こう), and IPADIC's 自立 ある after て.
// Lone も and sentence-final な keep theirs for ても and prohibitive 書く|な.
// IPADIC's only 名詞,特殊 is hearsay そう (行く|そう).
const isGrammarSpanPart = (m: Morpheme): boolean =>
  m.pos === '動詞' ||
  (m.pos === '名詞' && m.pos1 === '特殊') ||
  m.pos === '形容詞' ||
  m.pos === '助動詞' ||
  m.pos === '接尾辞' ||
  m.pos1 === '接尾' ||
  m.pos1 === '助動詞語幹' ||
  (m.pos === '助詞' && GRAMMAR_PARTICLES.has(m.surface)) ||
  (m.pos === '助詞' && m.pos1 === '終助詞' && m.surface === 'な')

const field = (value: string | undefined): string => (value && value !== '*' ? value : '')

// UniDic tags a sub-lemma after a hyphen (引く-他動詞, トム-Tom); dictionaries and
// known words use the bare headword. Morphemes keep the tag (そう-様態 vs そう-伝聞).
const stripLemmaTag = (lemma: string): string => {
  const hyphen = lemma.indexOf('-', 1)
  return hyphen === -1 ? lemma : lemma.slice(0, hyphen)
}

const surfaceOf = (line: string | undefined): string => line?.slice(0, line.indexOf('\t')) ?? ''
const featuresOf = (line: string | undefined): string[] =>
  line?.slice(line.indexOf('\t') + 1).split(',') ?? []

const toKatakana = (kana: string): string =>
  kana.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))

// The ちゃう / じゃう form IPADIC lists for an ending it can split off as a filler or
// interjection: 遊んじゃ|う, やっちゃ|え, 飲んじゃ|い|たい.
const contractedCompletionForm = (next: string | undefined): string | undefined => {
  const [pos, , , , , form, lemma] = featuresOf(next)
  const surface = surfaceOf(next)
  if (surface === 'う' && pos === '感動詞') return '基本形'
  if (surface === 'え' && (pos === 'フィラー' || pos === '感動詞')) return '命令ｅ'
  if (surface === 'い' && lemma === 'いる' && form === '連用形') return '連用形'
  return undefined
}

/**
 * Rewrites two IPADIC misreadings as IPADIC tags them elsewhere: ていただけません as
 * て|い|た|だけ|ませ|ん ("was only …"), though だけ never takes ます, and じゃう as
 * じゃ (ては) plus an interjection.
 */
function repairIpadicLines(lines: string[]): string[] {
  const repaired: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const [te, i_, ta, dake, masu] = lines.slice(i - 1, i + 4)
    const [line, next] = [lines[i], lines[i + 1]]
    const surface = surfaceOf(line)
    const conjunctive = featuresOf(line)[1] === '接続助詞'
    const completionForm =
      conjunctive && /^[ちじ]ゃ$/.test(surface) ? contractedCompletionForm(next) : undefined
    if (
      i > 0 &&
      /^[てで]$/.test(surfaceOf(te)) &&
      featuresOf(te)[1] === '接続助詞' &&
      surfaceOf(i_) === 'い' &&
      featuresOf(i_)[6] === 'いる' &&
      surfaceOf(ta) === 'た' &&
      surfaceOf(dake) === 'だけ' &&
      featuresOf(dake)[1] === '副助詞' &&
      featuresOf(masu)[6] === 'ます'
    ) {
      repaired.push('いただけ\t動詞,自立,*,*,一段,連用形,いただける,イタダケ,イタダケ')
      i += 2
    } else if (completionForm) {
      const joined = surface + surfaceOf(next)
      const kana = toKatakana(joined)
      repaired.push(
        `${joined}\t動詞,非自立,*,*,五段・ワ行促音便,${completionForm},${surface}う,${kana},${kana}`
      )
      i++
    } else {
      repaired.push(line)
    }
  }
  return repaired
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

  const lines = stdout.split(/\r?\n/)
  for (const line of flavor === 'ipadic' ? repairIpadicLines(lines) : lines) {
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
      reading:
        field(fields[map.reading]) ||
        (map.fallbackReading === undefined ? '' : field(fields[map.fallbackReading])),
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
