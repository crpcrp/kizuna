import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { grammarChain, type GrammarStep } from '@src/shared/inflection'
import {
  YOMITAN_TRANSFORM_DESCRIPTIONS,
  type YomitanTransformName
} from '@src/shared/yomitan/japaneseTransforms'
import type { DictFlavor, Morpheme } from '@src/shared/token'
import { fixture } from '@test/paths'

const LEMMA_COLUMN: Record<DictFlavor, number> = { ipadic: 6, unidic: 7 }

// Every MeCab row of each fixture word, keyed by the word's surface.
function readWords(flavor: DictFlavor): Map<string, Morpheme[]> {
  const words = new Map<string, Morpheme[]>()
  const text = readFileSync(fixture(`mecab-${flavor}-grammar.txt`), 'utf-8')
  for (const block of text.split(/^EOS$/m)) {
    const morphemes = block
      .split(/\r?\n/)
      .filter((line) => line.includes('\t'))
      .map((line): Morpheme => {
        const [surface, features] = line.split('\t')
        const fields = features.split(',').map((value) => (value === '*' ? '' : value))
        return {
          surface,
          lemma: fields[LEMMA_COLUMN[flavor]] || surface,
          pos: fields[0],
          pos1: fields[1],
          conjugationType: fields[4],
          conjugationForm: fields[5]
        }
      })
    if (morphemes.length > 0) words.set(morphemes.map((m) => m.surface).join(''), morphemes)
  }
  return words
}

const WORDS: Record<DictFlavor, Map<string, Morpheme[]>> = {
  ipadic: readWords('ipadic'),
  unidic: readWords('unidic')
}

const chainOf = (flavor: DictFlavor, word: string): GrammarStep[] => {
  const morphemes = WORDS[flavor].get(word)
  if (!morphemes) throw new Error(`${word} is missing from the ${flavor} fixture`)
  return grammarChain(morphemes[0].lemma, morphemes)
}

const kindName = (step: GrammarStep): string =>
  typeof step.kind === 'string' ? step.kind : `stem:${step.kind.stem}`

/** [kind, surface, Yomitan transforms whose text explains it, contractionOf]. */
type Expected = [string, string, YomitanTransformName[]?, string?]

interface Case {
  word: string
  /** Chain Yomitan shows, read from its japanese-transforms test cases at the pinned commit. */
  yomitan: YomitanTransformName[] | null
  steps: Expected[]
  /** Why Kizuna intentionally differs from Yomitan's chain. */
  difference?: string
}

// Kizuna lists steps left to right and adds the stem step; Yomitan lists only suffixes.
const CASES: Case[] = [
  {
    word: '書きます',
    yomitan: ['-ます'],
    steps: [
      ['stem:continuative', '書き'],
      ['polite', 'ます', ['-ます']]
    ]
  },
  {
    word: '書きません',
    yomitan: ['-ます', 'negative'],
    steps: [
      ['stem:continuative', '書き'],
      ['polite', 'ませ', ['-ます']],
      ['negative', 'ん', ['negative']]
    ]
  },
  {
    word: '書きました',
    yomitan: ['-ます', '-た'],
    steps: [
      ['stem:continuative', '書き'],
      ['polite', 'まし', ['-ます']],
      ['past', 'た', ['-た']]
    ]
  },
  {
    word: '書かない',
    yomitan: ['negative'],
    steps: [
      ['stem:irrealis', '書か'],
      ['negative', 'ない', ['negative']]
    ]
  },
  {
    word: '書かなかった',
    yomitan: ['negative', '-た'],
    steps: [
      ['stem:irrealis', '書か'],
      ['negative', 'なかっ', ['negative']],
      ['past', 'た', ['-た']]
    ]
  },
  {
    word: '書いた',
    yomitan: ['-た'],
    steps: [
      ['stem:onbin', '書い'],
      ['past', 'た', ['-た']]
    ]
  },
  {
    word: '書いて',
    yomitan: ['-て'],
    steps: [
      ['stem:onbin', '書い'],
      ['te', 'て', ['-て']]
    ]
  },
  {
    word: '読んだ',
    yomitan: ['-た'],
    steps: [
      ['stem:onbin', '読ん'],
      ['past', 'だ', ['-た']]
    ]
  },
  {
    word: '書けば',
    yomitan: ['-ば'],
    steps: [
      ['stem:conditional', '書け'],
      ['conditional-ba', 'ば', ['-ば']]
    ]
  },
  {
    word: '書いたら',
    yomitan: ['-たら'],
    steps: [
      ['stem:onbin', '書い'],
      ['conditional-tara', 'たら', ['-たら']]
    ]
  },
  {
    word: '書こう',
    yomitan: ['volitional'],
    steps: [
      ['stem:volitional', '書こ'],
      ['volitional', 'う', ['volitional']]
    ]
  },
  {
    word: '食べよう',
    yomitan: ['volitional'],
    steps: [
      ['stem:volitional', '食べよ'],
      ['volitional', 'う', ['volitional']]
    ]
  },
  {
    word: '書きたい',
    yomitan: ['-たい'],
    steps: [
      ['stem:continuative', '書き'],
      ['desire', 'たい', ['-たい']]
    ]
  },
  {
    word: '書かれる',
    yomitan: ['passive'],
    steps: [
      ['stem:irrealis', '書か'],
      ['passive-potential', 'れる', ['potential or passive']]
    ],
    difference: 'Godan れる is also the potential in older usage; Kizuna never picks one reading.'
  },
  {
    word: '食べられる',
    yomitan: ['potential or passive'],
    steps: [
      ['stem:irrealis', '食べ'],
      ['passive-potential', 'られる', ['potential or passive']]
    ]
  },
  {
    word: '書かせる',
    yomitan: ['causative'],
    steps: [
      ['stem:irrealis', '書か'],
      ['causative', 'せる', ['causative']]
    ]
  },
  {
    word: '食べさせる',
    yomitan: ['causative'],
    steps: [
      ['stem:irrealis', '食べ'],
      ['causative', 'させる', ['causative']]
    ]
  },
  {
    word: '食べさせられる',
    yomitan: ['causative', 'potential or passive'],
    steps: [
      ['stem:irrealis', '食べ'],
      ['causative-passive', 'させられる', ['causative', 'potential or passive']]
    ]
  },
  {
    word: '食べさせられなかった',
    yomitan: ['causative', 'potential or passive', 'negative', '-た'],
    steps: [
      ['stem:irrealis', '食べ'],
      ['causative-passive', 'させられ', ['causative', 'potential or passive']],
      ['negative', 'なかっ', ['negative']],
      ['past', 'た', ['-た']]
    ]
  },
  {
    word: '行っちゃった',
    yomitan: ['-ちゃう', '-た'],
    steps: [
      ['stem:onbin', '行っ'],
      ['completion', 'ちゃっ', ['-ちゃう'], 'てしまう'],
      ['past', 'た', ['-た']]
    ]
  },
  {
    word: '書かなきゃ',
    yomitan: ['negative', '-ば', '-ゃ'],
    steps: [
      ['stem:irrealis', '書か'],
      ['negative', 'な', ['negative']],
      ['conditional-ba', 'きゃ', ['-ば'], 'ければ']
    ],
    difference: "Yomitan's -ゃ contraction step is Kizuna's contractionOf on the ば step."
  },
  {
    word: '書かなくちゃ',
    yomitan: null,
    steps: [
      ['stem:irrealis', '書か'],
      ['negative', 'なく', ['negative']],
      ['te', 'ちゃ', ['-ちゃ'], 'ては']
    ],
    difference: "Yomitan's -ちゃ rules only follow verb stems, so it shows no chain."
  },
  {
    word: '書かん',
    yomitan: ['-ん'],
    steps: [
      ['stem:irrealis', '書か'],
      ['negative', 'ん', ['-ん'], 'ぬ']
    ]
  },
  {
    word: '書いてる',
    yomitan: ['-て', '-いる'],
    steps: [
      ['stem:onbin', '書い'],
      ['progressive', 'てる', ['-いる'], 'ている']
    ],
    difference: 'MeCab keeps てる as one morpheme, so the て step is part of its contractionOf.'
  },
  {
    word: '書いている',
    yomitan: ['-て', '-いる'],
    steps: [
      ['stem:onbin', '書い'],
      ['te', 'て', ['-て']],
      ['progressive', 'いる', ['-いる']]
    ]
  },
  {
    word: '書いとく',
    yomitan: ['-て', '-おく'],
    steps: [
      ['stem:onbin', '書い'],
      ['preparation', 'とく', ['-おく'], 'ておく']
    ],
    difference: 'MeCab keeps とく as one morpheme, so the て step is part of its contractionOf.'
  },
  {
    word: '書いておく',
    yomitan: ['-て', '-おく'],
    steps: [
      ['stem:onbin', '書い'],
      ['te', 'て', ['-て']],
      ['preparation', 'おく', ['-おく']]
    ]
  },
  {
    word: '書いてしまう',
    yomitan: ['-て', '-しまう'],
    steps: [
      ['stem:onbin', '書い'],
      ['te', 'て', ['-て']],
      ['completion', 'しまう', ['-しまう']]
    ]
  },
  {
    word: '書きそう',
    yomitan: ['-そう'],
    steps: [
      ['stem:continuative', '書き'],
      ['appearance', 'そう', ['-そう']]
    ]
  },
  {
    word: '美味しそう',
    yomitan: ['-そう'],
    steps: [
      ['stem:adjective-stem', '美味し'],
      ['appearance', 'そう', ['-そう']]
    ]
  },
  {
    word: '美味しさ',
    yomitan: ['-さ'],
    steps: [
      ['stem:adjective-stem', '美味し'],
      ['nominal', 'さ', ['-さ']]
    ]
  }
]

describe.each(['ipadic', 'unidic'] as const)('grammarChain — %s', (flavor) => {
  it.each(CASES)('$word', ({ word, steps }) => {
    const chain = chainOf(flavor, word)

    expect(chain.map((step) => [kindName(step), step.surface, step.contractionOf])).toEqual(
      steps.map(([kind, surface, , contractionOf]) => [kind, surface, contractionOf])
    )
    steps.forEach(([, , transforms], index) => {
      if (transforms) {
        expect(chain[index].explanation).toBe(
          transforms.map((name) => YOMITAN_TRANSFORM_DESCRIPTIONS[name]).join('\n')
        )
      }
    })
  })
})

describe('grammarChain', () => {
  it('matches the Yomitan chain except for documented differences', () => {
    for (const { word, yomitan, steps, difference } of CASES) {
      if (difference) continue
      expect(
        steps.flatMap(([, , transforms]) => transforms ?? []),
        word
      ).toEqual(yomitan)
    }
  })

  it('produces identical chains for IPADIC and UniDic', () => {
    for (const { word } of CASES) {
      expect(chainOf('unidic', word), word).toEqual(chainOf('ipadic', word))
    }
  })

  it('labels the sound change of an onbin stem', () => {
    expect(chainOf('ipadic', '読んだ')[0].label).toBe('continuative stem, ん sound change (連用形)')
  })

  it('reads IPADIC ら抜き as potential; UniDic hides it in one morpheme', () => {
    expect(chainOf('ipadic', '食べれる').map(kindName)).toEqual(['stem:irrealis', 'potential'])
    expect(chainOf('unidic', '食べれる')).toEqual([])
  })

  it('cites a source for every step', () => {
    const imperative: Morpheme = {
      surface: '書け',
      lemma: '書く',
      pos: '動詞',
      pos1: '自立',
      conjugationType: '五段・カ行イ音便',
      conjugationForm: '命令ｅ'
    }
    const chains = [
      ...CASES.flatMap(({ word }) => [chainOf('ipadic', word), chainOf('unidic', word)]),
      grammarChain('書く', [imperative])
    ]
    for (const step of chains.flat()) {
      expect(step.source.name).not.toBe('')
      expect(step.source.url).toMatch(/^https:\/\//)
      expect(step.explanation).not.toBe('')
    }
    expect(chains.at(-1)?.map(kindName)).toEqual(['stem:imperative'])
  })

  it('skips an unrecognised morpheme without aborting the chain', () => {
    const [stem, polite, past] = WORDS.ipadic.get('書きました') ?? []
    const unknown: Morpheme = {
      ...polite,
      surface: 'ぞ',
      lemma: 'ぞ',
      conjugationType: '',
      conjugationForm: ''
    }

    expect(grammarChain('書く', [stem, polite, unknown, past]).map(kindName)).toEqual([
      'stem:continuative',
      'polite',
      'past'
    ])
  })

  it('returns no steps for an unconjugated word', () => {
    const plain: Morpheme = {
      surface: '書く',
      lemma: '書く',
      pos: '動詞',
      pos1: '自立',
      conjugationType: '五段・カ行イ音便',
      conjugationForm: '基本形'
    }
    expect(grammarChain('書く', [plain])).toEqual([])
    expect(grammarChain('書く', [])).toEqual([])
  })
})
