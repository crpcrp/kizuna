import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { parseMecab } from '@src/main/services/mecab/parseMecab'
import { fixture } from '@test/paths'

const IPADIC_FIXTURE = readFileSync(fixture('mecab-ipadic.txt'), 'utf-8')
const UNIDIC_FIXTURE = readFileSync(fixture('mecab-unidic.txt'), 'utf-8')
const IPADIC_GOKUU_FIXTURE = readFileSync(fixture('mecab-ipadic-gokuu.txt'), 'utf-8')
const UNIDIC_GOKUU_FIXTURE = readFileSync(fixture('mecab-unidic-gokuu.txt'), 'utf-8')

describe('parseMecab — ipadic', () => {
  it('parses surface/reading/lemma/pos and running startOffset', () => {
    const tokens = parseMecab('ipadic', IPADIC_FIXTURE)

    expect(tokens).toEqual([
      { surface: '猫', reading: 'ネコ', lemma: '猫', pos: '名詞', startOffset: 0 },
      { surface: 'が', reading: 'ガ', lemma: 'が', pos: '助詞', startOffset: 1 },
      { surface: '魚', reading: 'サカナ', lemma: '魚', pos: '名詞', startOffset: 2 },
      { surface: 'を', reading: 'ヲ', lemma: 'を', pos: '助詞', startOffset: 3 },
      { surface: '食べます', reading: 'タベマス', lemma: '食べる', pos: '動詞', startOffset: 4 },
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
      { surface: '食べます', reading: 'タベマス', lemma: '食べる', pos: '動詞', startOffset: 4 },
      { surface: '。', reading: '', lemma: '。', pos: '補助記号', startOffset: 8 }
    ])
  })
})

describe('parseMecab — edge cases', () => {
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
        startOffset: 0
      },
      {
        surface: '生き返ったり',
        reading: 'イキカエッタリ',
        lemma: '生き返る',
        pos: '動詞',
        startOffset: 6
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
        startOffset: 0
      }
    ])
  })
})
