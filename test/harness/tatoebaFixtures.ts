// The committed Tatoeba-format sample (test/fixtures/tatoeba, synthetic sentences)
// and canned IPADIC output for its Japanese sentences, so builds need no MeCab.

import * as fs from 'node:fs'
import { join } from 'node:path'
import { parseMecab } from '@src/main/services/mecab/parseMecab'
import { TATOEBA_EXPORTS, type SourceFile } from '@src/main/services/grammarExamples/download'
import type { Token } from '@src/shared/token'
import { fixture } from '@test/paths'

const NOUN = (surface: string, reading: string): string =>
  `${surface}\t名詞,一般,*,*,*,*,${surface},${reading},${reading}`
const WO = 'を\t助詞,格助詞,一般,*,*,*,を,ヲ,ヲ'
const KAKA = '書か\t動詞,自立,*,*,五段・カ行イ音便,未然形,書く,カカ,カカ'
const NAKAT = 'なかっ\t助動詞,*,*,*,特殊・ナイ,連用タ接続,ない,ナカッ,ナカッ'
const TA = 'た\t助動詞,*,*,*,特殊・タ,基本形,た,タ,タ'
const YON = '読ん\t動詞,自立,*,*,五段・マ行,連用タ接続,読む,ヨン,ヨン'
const PERIOD = '。\t記号,句点,*,*,*,*,。,。,。'

const IPADIC_OUTPUT: Record<string, string[]> = {
  '手紙を書かなかった。': [NOUN('手紙', 'テガミ'), WO, KAKA, NAKAT, TA, PERIOD],
  '書かなかった。': [KAKA, NAKAT, TA, PERIOD],
  '読まなかった。': ['読ま\t動詞,自立,*,*,五段・マ行,未然形,読む,ヨマ,ヨマ', NAKAT, TA, PERIOD],
  // らしい has no grammar step, so 書かないらしい is skipped but 読んだ is kept.
  '書かないらしいが、読んだ。': [
    KAKA,
    'ない\t助動詞,*,*,*,特殊・ナイ,基本形,ない,ナイ,ナイ',
    'らしい\t助動詞,*,*,*,形容詞・イ段,基本形,らしい,ラシイ,ラシイ',
    'が\t助詞,接続助詞,*,*,*,*,が,ガ,ガ',
    '、\t記号,読点,*,*,*,*,、,、,、',
    YON,
    'だ\t助動詞,*,*,*,特殊・タ,基本形,だ,ダ,ダ',
    PERIOD
  ],
  '本です。': [NOUN('本', 'ホン'), 'です\t助動詞,*,*,*,特殊・デス,基本形,です,デス,デス', PERIOD],
  '本を読んでいる。': [
    NOUN('本', 'ホン'),
    WO,
    YON,
    'で\t助詞,接続助詞,*,*,*,*,で,デ,デ',
    'いる\t動詞,非自立,*,*,一段,基本形,いる,イル,イル',
    PERIOD
  ]
}

/** Tokenizes the sample's Japanese sentences as IPADIC would. */
export async function fakeTatoebaTokenize(texts: string[]): Promise<Token[][]> {
  return texts.map((text) => {
    const lines = IPADIC_OUTPUT[text]
    if (!lines) throw new Error(`No canned MeCab output for ${text}`)
    return parseMecab('ipadic', `${lines.join('\n')}\nEOS\n`, text)
  })
}

export const SAMPLE_LAST_MODIFIED = 'Sat, 21 Nov 2026 06:30:12 GMT'

/** Copies the sample into `downloadsDir` as a complete download cache. */
export function writeTatoebaCache(downloadsDir: string): SourceFile[] {
  fs.mkdirSync(downloadsDir, { recursive: true })
  const sources = TATOEBA_EXPORTS.map((file) => {
    fs.copyFileSync(fixture('tatoeba', file.name), join(downloadsDir, file.name))
    return {
      name: file.name,
      url: file.url,
      size: fs.statSync(join(downloadsDir, file.name)).size,
      lastModified: SAMPLE_LAST_MODIFIED
    }
  })
  fs.writeFileSync(join(downloadsDir, 'sources.json'), JSON.stringify(sources))
  return sources
}
