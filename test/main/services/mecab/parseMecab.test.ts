import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseMecab } from '@src/main/services/mecab/parseMecab'
import { fixture } from '@test/paths'
import { spanGrammarChain } from '@src/shared/inflection'
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

  it('keeps UniDic surface, pronunciation lemma, and kana reading', () => {
    expect(parseMecab('unidic', UNIDIC_GOKUU_FIXTURE)).toEqual([
      { surface: '悟空', reading: 'ゴクウ', lemma: 'ゴクウ', pos: '名詞', startOffset: 0 }
    ])
  })

  it('falls back to the UniDic 2.1.2 pronunciation, which has no kana column', () => {
    const stdout =
      '悟空\t名詞,固有名詞,人名,名,*,*,ゴクウ,ゴクウ,悟空,ゴクー,悟空,ゴクー,固,*,*,*,*\nEOS\n'
    expect(parseMecab('unidic', stdout)[0].reading).toBe('ゴクー')
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

    expect(parseMecab('ipadic', stdout)).toMatchObject([
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

    expect(parseMecab('ipadic', stdout)).toMatchObject([
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

  it('keeps the head lemma for IPADIC contracted てる and とく', () => {
    const stdout = [
      '読ん\t動詞,自立,*,*,五段・マ行,連用タ接続,読む,ヨン,ヨン',
      'でる\t動詞,非自立,*,*,一段,基本形,でる,デル,デル',
      'EOS',
      'やっ\t動詞,自立,*,*,五段・ラ行,連用タ接続,やる,ヤッ,ヤッ',
      'とく\t動詞,非自立,*,*,五段・カ行イ音便,基本形,とく,トク,トク',
      'EOS'
    ].join('\n')

    expect(summarize(parseMecab('ipadic', stdout))).toEqual([
      ['読んでる', '読む'],
      ['やっとく', 'やる']
    ])
  })

  it('merges the ちゃ of ては onto the verb', () => {
    const stdout = [
      '行か\t動詞,自立,*,*,五段・カ行促音便,未然形,行く,イカ,イカ',
      'なく\t助動詞,*,*,*,特殊・ナイ,連用テ接続,ない,ナク,ナク',
      'ちゃ\t助詞,接続助詞,*,*,*,*,ちゃ,チャ,チャ',
      'EOS'
    ].join('\n')

    expect(summarize(parseMecab('ipadic', stdout))).toEqual([['行かなくちゃ', '行く']])
  })

  it('keeps the じゃ of じゃいけない as ては rather than じゃう', () => {
    const stdout = [
      '飲ん\t動詞,自立,*,*,五段・マ行,連用タ接続,飲む,ノン,ノン',
      'じゃ\t助詞,接続助詞,*,*,*,*,じゃ,ジャ,ジャ',
      'いけ\t動詞,非自立,*,*,一段,未然形,いける,イケ,イケ',
      'ない\t助動詞,*,*,*,特殊・ナイ,基本形,ない,ナイ,ナイ',
      'EOS'
    ].join('\n')

    expect(summarize(parseMecab('ipadic', stdout))).toEqual([
      ['飲んじゃ', '飲む'],
      ['いけない', 'いける']
    ])
  })

  it('keeps the morpheme of a lone verb for its conjugation form', () => {
    const stdout = [
      '書こう\t動詞,一般,*,*,五段-カ行,意志推量形,カク,書く,書こう,カコー,書く,カク,和,*,*,*,*',
      'EOS'
    ].join('\n')

    expect(parseMecab('unidic', stdout)[0]?.morphemes).toEqual([
      {
        surface: '書こう',
        lemma: '書く',
        pos: '動詞',
        pos1: '一般',
        conjugationType: '五段-カ行',
        conjugationForm: '意志推量形'
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

describe('parseMecab — UniDic sub-lemma tags', () => {
  it('strips the tag from the token lemma and keeps it on the morpheme', () => {
    const stdout = [
      '引い\t動詞,一般,*,*,五段-カ行,連用形-イ音便,ヒク,引く-他動詞,引い,ヒイ,引く,ヒク,和,*,*,*,*',
      'ちゃっ\t助動詞,*,*,*,五段-ワア行,連用形-促音便,チャウ,ちゃう,ちゃっ,チャッ,ちゃう,チャウ,和,*,*,*,*',
      'た\t助動詞,*,*,*,助動詞-タ,終止形-一般,タ,た,た,タ,た,タ,和,*,*,*,*',
      'トム\t名詞,固有名詞,人名,一般,*,*,トム,トム-Tom,トム,トム,トム,トム,固,*,*,*,*',
      '-\t補助記号,一般,*,*,*,*,,-,-,,-,,記号,*,*,*,*',
      'EOS'
    ].join('\n')
    const tokens = parseMecab('unidic', stdout)

    expect(summarize(tokens)).toEqual([
      ['引いちゃった', '引く'],
      ['トム', 'トム'],
      ['-', '-']
    ])
    expect(tokens[0]?.morphemes?.[0]?.lemma).toBe('引く-他動詞')
  })

  it('keeps IPADIC lemmas unchanged', () => {
    const stdout = 'ジェイ-ポップ\t名詞,固有名詞,一般,*,*,*,ジェイ-ポップ,*,*\nEOS\n'
    expect(parseMecab('ipadic', stdout)[0]?.lemma).toBe('ジェイ-ポップ')
  })

  it('still tells appearance そう from hearsay そう', () => {
    const appearance = parseMecab(
      'unidic',
      [
        '降り\t動詞,一般,*,*,上一段-ラ行,連用形-一般,オリル,降りる,降り,オリ,降りる,オリル,和,*,*,*,*',
        'そう\t形状詞,助動詞語幹,*,*,*,*,ソウ,そう-様態,そう,ソー,そう,ソー,和,*,*,*,*',
        'EOS'
      ].join('\n')
    )
    const hearsay = parseMecab(
      'unidic',
      [
        '降りる\t動詞,一般,*,*,上一段-ラ行,終止形-一般,オリル,降りる,降りる,オリル,降りる,オリル,和,*,*,*,*',
        'そう\t形状詞,助動詞語幹,*,*,*,*,ソウ,そう-伝聞,そう,ソー,そう,ソー,和,*,*,*,*',
        'EOS'
      ].join('\n')
    )

    expect(appearance.map((token) => token.lemma)).toEqual(['降りる', 'そう'])
    expect(hearsay.map((token) => token.lemma)).toEqual(['降りる', 'そう'])
    expect(spanGrammarChain(appearance).map((step) => step.kind)).toContain('appearance')
    expect(spanGrammarChain(hearsay).map((step) => step.kind)).toEqual(['hearsay'])
  })

  it.each(['ipadic', 'unidic'] as const)(
    'keeps the head verb lemma before なさい — %s',
    (flavor) => {
      const [tabenasai] = readFileSync(fixture(`mecab-${flavor}-forms.txt`), 'utf-8').split(
        /^EOS$/m
      )

      expect(summarize(parseMecab(flavor, tabenasai))).toEqual([['食べなさい', '食べる']])
    }
  )
})
