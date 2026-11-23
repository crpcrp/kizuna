import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseMecab } from '@src/main/services/mecab/parseMecab'
import { fixture } from '@test/paths'
import type { Token } from '@src/shared/token'

const IPADIC_FIXTURE = readFileSync(fixture('mecab-ipadic.txt'), 'utf-8')
const UNIDIC_FIXTURE = readFileSync(fixture('mecab-unidic.txt'), 'utf-8')
const IPADIC_GOKUU_FIXTURE = readFileSync(fixture('mecab-ipadic-gokuu.txt'), 'utf-8')
const UNIDIC_GOKUU_FIXTURE = readFileSync(fixture('mecab-unidic-gokuu.txt'), 'utf-8')
const IPADIC_CONJUGATION_FIXTURE = readFileSync(fixture('mecab-ipadic-conjugation.txt'), 'utf-8')
const UNIDIC_CONJUGATION_FIXTURE = readFileSync(fixture('mecab-unidic-conjugation.txt'), 'utf-8')

const summarize = (tokens: Token[]): [string, string][] =>
  tokens.map((token) => [token.surface, token.lemma])

describe('parseMecab — ipadic', () => {
  it('parses surface/reading/lemma/pos and running startOffset', () => {
    const tokens = parseMecab('ipadic', IPADIC_FIXTURE)

    expect(tokens).toEqual([
      { surface: '猫', reading: 'ネコ', lemma: '猫', pos: '名詞', startOffset: 0 },
      { surface: 'が', reading: 'ガ', lemma: 'が', pos: '助詞', startOffset: 1 },
      { surface: '魚', reading: 'サカナ', lemma: '魚', pos: '名詞', startOffset: 2 },
      { surface: 'を', reading: 'ヲ', lemma: 'を', pos: '助詞', startOffset: 3 },
      {
        surface: '食べます',
        reading: 'タベマス',
        lemma: '食べる',
        pos: '動詞',
        startOffset: 4,
        morphemes: [
          {
            surface: '食べ',
            lemma: '食べる',
            pos: '動詞',
            pos1: '自立',
            conjugationType: '一段',
            conjugationForm: '連用形'
          },
          {
            surface: 'ます',
            lemma: 'ます',
            pos: '助動詞',
            pos1: '',
            conjugationType: '特殊・マス',
            conjugationForm: '基本形'
          }
        ]
      },
      { surface: '。', reading: '。', lemma: '。', pos: '記号', startOffset: 8 }
    ])
  })
})

describe('parseMecab — unidic', () => {
  it('parses surface/reading/lemma/pos using the wider UniDic column layout', () => {
    const tokens = parseMecab('unidic', UNIDIC_FIXTURE)

    expect(tokens).toEqual([
      { surface: '猫', reading: 'ネコ', lemma: '猫', pos: '名詞', startOffset: 0 },
      { surface: 'が', reading: 'ガ', lemma: 'が', pos: '助詞', startOffset: 1 },
      { surface: '魚', reading: 'サカナ', lemma: '魚', pos: '名詞', startOffset: 2 },
      { surface: 'を', reading: 'オ', lemma: 'を', pos: '助詞', startOffset: 3 },
      {
        surface: '食べます',
        reading: 'タベマス',
        lemma: '食べる',
        pos: '動詞',
        startOffset: 4,
        morphemes: [
          {
            surface: '食べ',
            lemma: '食べる',
            pos: '動詞',
            pos1: '一般',
            conjugationType: '下一段-バ行',
            conjugationForm: '連用形-一般'
          },
          {
            surface: 'ます',
            lemma: 'ます',
            pos: '助動詞',
            pos1: '',
            conjugationType: '助動詞-マス',
            conjugationForm: '終止形-一般'
          }
        ]
      },
      { surface: '。', reading: '', lemma: '。', pos: '補助記号', startOffset: 8 }
    ])
  })
})

describe('parseMecab — edge cases', () => {
  it('aligns surfaces after whitespace omitted from MeCab output', () => {
    const stdout = [
      '猫\t名詞,一般,*,*,*,*,猫,ネコ,ネコ',
      '大丈夫\t名詞,形容動詞語幹,*,*,*,*,大丈夫,ダイジョウブ,ダイジョーブ',
      'EOS'
    ].join('\n')

    expect(parseMecab('ipadic', stdout, '猫 大丈夫')).toEqual([
      { surface: '猫', reading: 'ネコ', lemma: '猫', pos: '名詞', startOffset: 0 },
      { surface: '大丈夫', reading: 'ダイジョウブ', lemma: '大丈夫', pos: '名詞', startOffset: 2 }
    ])
  })

  it('falls back to surface for an unknown word (lemma "*")', () => {
    const tokens = parseMecab('ipadic', 'ほげ\t名詞,一般,*,*,*,*,*,*,*\nEOS\n')

    expect(tokens).toEqual([
      { surface: 'ほげ', reading: '', lemma: 'ほげ', pos: '名詞', startOffset: 0 }
    ])
  })

  it('returns [] for empty input or input with only EOS', () => {
    expect(parseMecab('ipadic', '')).toEqual([])
    expect(parseMecab('ipadic', 'EOS\n')).toEqual([])
  })
})

describe('parseMecab captured 悟空 output', () => {
  it('keeps IPADIC segmentation and fields', () => {
    expect(parseMecab('ipadic', IPADIC_GOKUU_FIXTURE)).toEqual([
      { surface: '悟', reading: 'サトル', lemma: '悟', pos: '名詞', startOffset: 0 },
      { surface: '空', reading: 'ソラ', lemma: '空', pos: '名詞', startOffset: 1 }
    ])
  })

  it('keeps UniDic surface, pronunciation lemma, and reading', () => {
    expect(parseMecab('unidic', UNIDIC_GOKUU_FIXTURE)).toEqual([
      { surface: '悟空', reading: 'ゴクー', lemma: 'ゴクウ', pos: '名詞', startOffset: 0 }
    ])
  })
})

describe('parseMecab — conjugation chains', () => {
  it('keeps inflections and compound verbs on their originating verb token', () => {
    const stdout = [
      '行き\t動詞,自立,*,*,五段・カ行促音便,連用形,行く,イキ,イキ',
      'たけれ\t助動詞,*,*,*,特殊・タイ,仮定形,たい,タケレ,タケレ',
      'ば\t助詞,接続助詞,*,*,*,*,ば,バ,バ',
      '生き\t動詞,自立,*,*,一段,連用形,生きる,イキ,イキ',
      '返っ\t動詞,自立,*,*,五段・ラ行,連用タ接続,返る,カエッ,カエッ',
      'たり\t助詞,接続助詞,*,*,*,*,たり,タリ,タリ',
      'EOS'
    ].join('\n')

    expect(parseMecab('ipadic', stdout)).toEqual([
      {
        surface: '行きたければ',
        reading: 'イキタケレバ',
        lemma: '行く',
        pos: '動詞',
        startOffset: 0,
        morphemes: expect.any(Array)
      },
      {
        surface: '生き返ったり',
        reading: 'イキカエッタリ',
        lemma: '生き返る',
        pos: '動詞',
        startOffset: 6,
        morphemes: expect.any(Array)
      }
    ])
  })

  it('does not merge adjacent verbs when the first is not continuative', () => {
    const stdout = [
      '見る\t動詞,自立,*,*,一段,基本形,見る,ミル,ミル',
      '食べる\t動詞,自立,*,*,一段,基本形,食べる,タベル,タベル',
      'EOS'
    ].join('\n')

    expect(parseMecab('ipadic', stdout)).toEqual([
      { surface: '見る', reading: 'ミル', lemma: '見る', pos: '動詞', startOffset: 0 },
      { surface: '食べる', reading: 'タベル', lemma: '食べる', pos: '動詞', startOffset: 2 }
    ])
  })

  it('does not attach an ordinary conjunction particle to a verb', () => {
    const stdout = [
      '見る\t動詞,自立,*,*,一段,基本形,見る,ミル,ミル',
      'から\t助詞,接続助詞,*,*,*,*,から,カラ,カラ',
      'EOS'
    ].join('\n')

    expect(parseMecab('ipadic', stdout)).toEqual([
      { surface: '見る', reading: 'ミル', lemma: '見る', pos: '動詞', startOffset: 0 },
      { surface: 'から', reading: 'カラ', lemma: 'から', pos: '助詞', startOffset: 2 }
    ])
  })

  it('keeps a UniDic compound inflection on the originating verb token', () => {
    const stdout = [
      '生き\t動詞,一般,*,*,上一段-カ行,連用形-一般,イク,生きる,生き,イキ,*,*,*,*,*,*,*',
      '返っ\t動詞,一般,*,*,五段-ラ行,連用形-促音便,カエル,返る,返っ,カエッ,*,*,*,*,*,*,*',
      'たり\t助詞,接続助詞,*,*,*,*,タリ,たり,たり,タリ,*,*,*,*,*,*,*',
      'EOS'
    ].join('\n')

    expect(parseMecab('unidic', stdout)).toEqual([
      {
        surface: '生き返ったり',
        reading: 'イキカエッタリ',
        lemma: '生き返る',
        pos: '動詞',
        startOffset: 0,
        morphemes: expect.any(Array)
      }
    ])
  })
})

describe('parseMecab — conjugation fixtures', () => {
  it('merges IPADIC 動詞,接尾 and contraction verbs onto the head verb', () => {
    const tokens = parseMecab('ipadic', IPADIC_CONJUGATION_FIXTURE)

    expect(summarize(tokens)).toEqual([
      ['食べさせられなかった', '食べる'],
      ['書かれる', '書く'],
      ['行っちゃった', '行く'],
      ['書きました', '書く']
    ])
    expect(tokens[0]?.morphemes?.map((m) => [m.surface, m.lemma, m.pos1])).toEqual([
      ['食べ', '食べる', '自立'],
      ['させ', 'させる', '接尾'],
      ['られ', 'られる', '接尾'],
      ['なかっ', 'ない', ''],
      ['た', 'た', '']
    ])
    expect(tokens[2]?.morphemes?.[1]).toEqual({
      surface: 'ちゃっ',
      lemma: 'ちゃう',
      pos: '動詞',
      pos1: '非自立',
      conjugationType: '五段・ワ行促音便',
      conjugationForm: '連用タ接続'
    })
  })

  it('merges UniDic auxiliaries and records their conjugation fields', () => {
    const tokens = parseMecab('unidic', UNIDIC_CONJUGATION_FIXTURE)

    expect(summarize(tokens)).toEqual([
      ['食べさせられなかった', '食べる'],
      ['書かれる', '書く'],
      ['行っちゃった', '行く'],
      ['書きました', '書く']
    ])
    expect(tokens[2]?.morphemes).toEqual([
      {
        surface: '行っ',
        lemma: '行く',
        pos: '動詞',
        pos1: '非自立可能',
        conjugationType: '五段-カ行',
        conjugationForm: '連用形-促音便'
      },
      {
        surface: 'ちゃっ',
        lemma: 'ちゃう',
        pos: '助動詞',
        pos1: '',
        conjugationType: '五段-ワア行',
        conjugationForm: '連用形-促音便'
      },
      {
        surface: 'た',
        lemma: 'た',
        pos: '助動詞',
        pos1: '',
        conjugationType: '助動詞-タ',
        conjugationForm: '終止形-一般'
      }
    ])
  })

  it('omits morphemes on unmerged tokens', () => {
    const tokens = parseMecab('ipadic', IPADIC_FIXTURE)

    expect(tokens.filter((token) => 'morphemes' in token).map((token) => token.surface)).toEqual([
      '食べます'
    ])
  })
})
