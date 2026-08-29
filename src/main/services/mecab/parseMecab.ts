// MeCab's default output is `surface\tfeature,feature,...` per line,
// terminated by a line reading `EOS`. The feature CSV layout differs by
// dictionary flavor, so the field indices for lemma/reading/pos are chosen
// per `DictFlavor` (pinned against the captured fixtures in
// test/fixtures/mecab-{ipadic,unidic}.txt):
//
// - IPADIC (9 feature columns): pos = idx 0, lemma (原形) = idx 6, reading
//   (読み) = idx 7.
// - UniDic (17 feature columns): pos = idx 0, lemma (dictionary form) =
//   idx 7, reading = idx 9 (`pron`, the surface pronunciation — preferred
//   over `lForm` at idx 6, which is the lemma's own reading).
//
// Unknown words mark absent fields as `*`; those fall back to the surface
// form (lemma) or an empty string (reading).

import type { DictFlavor, Token } from '../../../shared/token'

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

/**
 * Parses MeCab's raw stdout for a single cue into `Token[]`, using the
 * feature-column layout for `flavor`. Blank lines and the trailing `EOS`
 * marker are skipped. When `sourceText` is supplied, each surface is aligned
 * against it because MeCab omits ordinary whitespace from its output. Newline
 * characters are removed before alignment because token offsets refer to the
 * continuous analysis text, not display line breaks.
 */
export function parseMecab(flavor: DictFlavor, stdout: string, sourceText?: string): Token[] {
  const map = FIELD_MAPS[flavor]
  const tokens: Token[] = []
  const suffixedTokens = new Set<Token>()
  const continuativeVerbTokens = new Set<Token>()
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

    const rawLemma = fields[map.lemma]
    const rawReading = fields[map.reading]

    const token = {
      surface,
      reading: rawReading && rawReading !== '*' ? rawReading : '',
      lemma: rawLemma && rawLemma !== '*' ? rawLemma : surface,
      pos: fields[map.pos] ?? '',
      startOffset
    }

    const previous = tokens.at(-1)
    const contiguous = previous !== undefined && previousSurfaceEnd === startOffset
    const isConjugationSuffix =
      token.pos === '助動詞' ||
      (token.pos === '助詞' &&
        fields[1] === '接続助詞' &&
        VERB_CONJUNCTION_SUFFIXES.has(token.surface))
    const extendsVerb =
      contiguous &&
      previous?.pos === '動詞' &&
      (isConjugationSuffix ||
        (token.pos === '動詞' &&
          continuativeVerbTokens.has(previous) &&
          !suffixedTokens.has(previous)))
    if (previous && extendsVerb) {
      if (token.pos === '動詞') previous.lemma = previous.surface + token.lemma
      previous.surface += token.surface
      previous.reading += token.reading
      if (isConjugationSuffix) suffixedTokens.add(previous)
      if (token.pos === '動詞' && fields[5]?.startsWith('連用'))
        continuativeVerbTokens.add(previous)
      else continuativeVerbTokens.delete(previous)
    } else {
      tokens.push(token)
      if (token.pos === '動詞' && fields[5]?.startsWith('連用')) continuativeVerbTokens.add(token)
    }

    outputOffset += surface.length
    previousSurfaceEnd = startOffset + surface.length
  }

  return tokens
}
