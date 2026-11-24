import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { grammarChain, YOMITAN_SOURCE, type GrammarStep } from '@src/shared/inflection'
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
  const text = ['grammar', 'forms']
    .map((name) => readFileSync(fixture(`mecab-${flavor}-${name}.txt`), 'utf-8'))
    .join('')
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
      ['te-wa', 'ちゃ', ['-ちゃ'], 'ては']
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
  },
  {
    word: '書かず',
    yomitan: ['-ず'],
    steps: [
      ['stem:irrealis', '書か'],
      ['negative', 'ず', ['-ず']]
    ]
  },
  {
    word: '飲みたがる',
    yomitan: ['-たい', '-がる'],
    steps: [
      ['stem:continuative', '飲み'],
      ['desire', 'た', ['-たい']],
      ['outward-sign', 'がる', ['-がる']]
    ]
  },
  {
    word: '見ましょう',
    yomitan: ['-ます', 'volitional'],
    steps: [
      ['stem:continuative', '見'],
      ['polite', 'ましょ', ['-ます']],
      ['volitional', 'う', ['volitional']]
    ]
  },
  {
    word: '書いてます',
    yomitan: ['-て', '-いる', '-ます'],
    steps: [
      ['stem:onbin', '書い'],
      ['progressive', 'て', ['-いる'], 'ている'],
      ['polite', 'ます', ['-ます']]
    ],
    difference: 'The い of ています is dropped, so the て step is part of its contractionOf.'
  },
  {
    word: '書いてみる',
    yomitan: null,
    steps: [
      ['stem:onbin', '書い'],
      ['te', 'て', ['-て']],
      ['attempt', 'みる']
    ],
    difference: 'Yomitan has no -てみる transform; the step shows a label and source only.'
  },
  {
    word: '書いてくれた',
    yomitan: null,
    steps: [
      ['stem:onbin', '書い'],
      ['te', 'て', ['-て']],
      ['giving', 'くれ'],
      ['past', 'た', ['-た']]
    ],
    difference: 'Yomitan has no -てくれる transform; the step shows a label and source only.'
  },
  {
    word: '書いてもらう',
    yomitan: null,
    steps: [
      ['stem:onbin', '書い'],
      ['te', 'て', ['-て']],
      ['receiving', 'もらう']
    ],
    difference: 'Yomitan has no -てもらう transform; the step shows a label and source only.'
  },
  {
    word: '書いてある',
    yomitan: null,
    steps: [
      ['stem:onbin', '書い'],
      ['te', 'て', ['-て']],
      ['resultative', 'ある']
    ],
    difference: 'Yomitan has no -てある transform; the step shows a label and source only.'
  },
  {
    word: '学生だろう',
    yomitan: null,
    steps: [['conjecture', 'だろう']],
    difference: 'Yomitan has no copula transform.'
  },
  {
    word: '食べなさい',
    yomitan: ['-なさい'],
    steps: [
      ['stem:continuative', '食べ'],
      ['polite-imperative', 'なさい', ['-なさい']]
    ]
  },
  {
    word: '行ったり',
    yomitan: ['-たり'],
    steps: [
      ['stem:onbin', '行っ'],
      ['tari', 'たり', ['-たり']]
    ]
  },
  {
    word: '読んだり',
    yomitan: ['-たり'],
    steps: [
      ['stem:onbin', '読ん'],
      ['tari', 'だり', ['-たり']]
    ]
  },
  {
    word: '高かったり',
    yomitan: ['-たり'],
    steps: [
      ['stem:adjective-stem', '高'],
      ['tari', 'かったり', ['-たり']]
    ]
  },
  {
    word: '高そう',
    yomitan: ['-そう'],
    steps: [
      ['stem:adjective-stem', '高'],
      ['appearance', 'そう', ['-そう']]
    ]
  },
  {
    word: '行くそうだ',
    yomitan: null,
    steps: [
      ['hearsay', 'そう'],
      ['copula', 'だ']
    ],
    difference: 'Yomitan has no hearsay そう transform; the step shows a label and source only.'
  },
  {
    word: '高いそうです',
    yomitan: null,
    steps: [
      ['hearsay', 'そう'],
      ['copula', 'です']
    ],
    difference: 'Yomitan has no hearsay そう transform; the step shows a label and source only.'
  },
  {
    word: '高いです',
    yomitan: null,
    steps: [['polite', 'です']],
    difference: 'Yomitan has no adjective + です transform; the step shows a label and source only.'
  },
  {
    word: '高かったです',
    yomitan: null,
    steps: [
      ['stem:adjective-stem', '高'],
      ['past', 'かった', ['-た']],
      ['polite', 'です']
    ],
    difference: 'Yomitan has no adjective + です transform; the step shows a label and source only.'
  },
  {
    word: '勉強している',
    yomitan: null,
    steps: [
      ['suru', 'し'],
      ['te', 'て', ['-て']],
      ['progressive', 'いる', ['-いる']]
    ],
    difference:
      'Yomitan deinflects 勉強する as one verb; Kizuna explains する as a label-only step.'
  },
  {
    word: '勉強させられた',
    yomitan: null,
    steps: [
      ['suru', 'さ'],
      ['causative-passive', 'せられ', ['causative', 'potential or passive']],
      ['past', 'た', ['-た']]
    ],
    difference:
      'Yomitan deinflects 勉強する as one verb; Kizuna explains する as a label-only step.'
  },
  {
    word: '心配した',
    yomitan: null,
    steps: [
      ['suru', 'し'],
      ['past', 'た', ['-た']]
    ],
    difference:
      'Yomitan deinflects 心配する as one verb; Kizuna explains する as a label-only step.'
  },
  {
    word: '書きませんでした',
    yomitan: ['-ます', 'negative', '-た'],
    steps: [
      ['stem:continuative', '書き'],
      ['polite', 'ませ', ['-ます']],
      ['negative', 'ん', ['negative']],
      ['past', 'でした', ['-た']]
    ]
  },
  {
    word: '書きたいです',
    yomitan: null,
    steps: [
      ['stem:continuative', '書き'],
      ['desire', 'たい', ['-たい']],
      ['polite', 'です']
    ],
    difference: 'Yomitan has no adjective + です transform; the step shows a label and source only.'
  },
  {
    word: '書くでしょう',
    yomitan: null,
    steps: [['conjecture', 'でしょう']],
    difference: 'Yomitan has no でしょう transform; the step shows a label and source only.'
  },
  {
    word: '高いだろう',
    yomitan: null,
    steps: [['conjecture', 'だろう']],
    difference: 'Yomitan has no だろう transform; the step shows a label and source only.'
  },
  {
    word: '書かねば',
    yomitan: ['-ねば'],
    steps: [
      ['stem:irrealis', '書か'],
      ['negative-conditional', 'ねば', ['-ねば']]
    ]
  },
  {
    word: '書き終わった',
    yomitan: ['-た'],
    steps: [
      ['stem:onbin', '書き終わっ'],
      ['past', 'た', ['-た']]
    ]
  },
  {
    word: 'いらっしゃいます',
    yomitan: ['-ます'],
    steps: [
      ['stem:continuative', 'いらっしゃい'],
      ['polite', 'ます', ['-ます']]
    ]
  },
  {
    word: 'よかった',
    yomitan: ['-た'],
    steps: [
      ['stem:adjective-stem', 'よ'],
      ['past', 'かった', ['-た']]
    ]
  },
  {
    word: 'よさそう',
    yomitan: ['-そう'],
    steps: [
      ['stem:adjective-stem', 'よ'],
      ['appearance', 'さそう', ['-そう']]
    ]
  },
  {
    word: '高くありませんでした',
    yomitan: null,
    steps: [
      ['stem:adjective-stem', '高'],
      ['polite', 'くありませ'],
      ['negative', 'ん', ['negative']],
      ['past', 'でした', ['-た']]
    ],
    difference: 'Yomitan has no くありません rule; the polite step shows a label and source only.'
  },
  {
    word: '書いても',
    yomitan: null,
    steps: [
      ['stem:onbin', '書い'],
      ['te', 'て', ['-て']],
      ['concessive', 'も']
    ],
    difference: 'Yomitan has no -ても transform; the step shows a label and source only.'
  },
  {
    word: '高くても',
    yomitan: null,
    steps: [
      ['stem:adjective-stem', '高'],
      ['te', 'くて', ['-て']],
      ['concessive', 'も']
    ],
    difference: 'Yomitan has no -ても transform; the step shows a label and source only.'
  },
  {
    word: '書くな',
    yomitan: null,
    steps: [['prohibitive', 'な']],
    difference: 'Yomitan has no prohibitive な transform; the step shows a label and source only.'
  },
  {
    word: '書いちゃおう',
    yomitan: ['-ちゃう', 'volitional'],
    steps: [
      ['stem:onbin', '書い'],
      ['completion', 'ちゃお', ['-ちゃう'], 'てしまう'],
      ['volitional', 'う', ['volitional']]
    ]
  },
  {
    word: '書くそうだ',
    yomitan: null,
    steps: [
      ['hearsay', 'そう'],
      ['copula', 'だ']
    ],
    difference: 'Yomitan has no hearsay そう transform; the step shows a label and source only.'
  },
  {
    word: '書きゃ',
    yomitan: ['-ば', '-ゃ'],
    steps: [
      ['stem:conditional', '書'],
      ['conditional-ba', 'きゃ', ['-ば'], 'けば']
    ],
    difference: "Yomitan's -ゃ contraction step is Kizuna's contractionOf on the ば step."
  },
  {
    word: '待ちゃ',
    yomitan: ['-ば', '-ゃ'],
    steps: [
      ['stem:conditional', '待'],
      ['conditional-ba', 'ちゃ', ['-ば'], 'てば']
    ],
    difference: "Yomitan's -ゃ contraction step is Kizuna's contractionOf on the ば step."
  },
  {
    word: '高けりゃ',
    yomitan: ['-ば', '-ゃ'],
    steps: [
      ['stem:adjective-stem', '高'],
      ['conditional-ba', 'けりゃ', ['-ば'], 'ければ']
    ],
    difference: "Yomitan's -ゃ contraction step is Kizuna's contractionOf on the ば step."
  },
  {
    word: '書かせりゃ',
    yomitan: ['causative', '-ば', '-ゃ'],
    steps: [
      ['stem:irrealis', '書か'],
      ['causative', 'せ', ['causative']],
      ['conditional-ba', 'りゃ', ['-ば'], 'れば']
    ],
    difference: "Yomitan's -ゃ contraction step is Kizuna's contractionOf on the ば step."
  },
  {
    word: '書きたけりゃ',
    yomitan: ['-たい', '-ば', '-ゃ'],
    steps: [
      ['stem:continuative', '書き'],
      ['desire', 'た', ['-たい']],
      ['conditional-ba', 'けりゃ', ['-ば'], 'ければ']
    ],
    difference: "Yomitan's -ゃ contraction step is Kizuna's contractionOf on the ば step."
  },
  {
    word: '書かなけりゃ',
    yomitan: ['negative', '-ば', '-ゃ'],
    steps: [
      ['stem:irrealis', '書か'],
      ['negative', 'な', ['negative']],
      ['conditional-ba', 'けりゃ', ['-ば'], 'ければ']
    ],
    difference: "Yomitan's -ゃ contraction step is Kizuna's contractionOf on the ば step."
  },
  {
    word: '学生ではなく',
    yomitan: null,
    steps: [
      ['copula', 'では'],
      ['negative', 'なく', ['negative']]
    ],
    difference: 'Yomitan has no copula transform.'
  },
  {
    word: '学生ではありません',
    yomitan: null,
    steps: [
      ['copula', 'ではあり'],
      ['polite', 'ませ', ['-ます']],
      ['negative', 'ん', ['negative']]
    ],
    difference: 'Yomitan has no copula transform.'
  },
  {
    word: '勉強できない',
    yomitan: null,
    steps: [
      ['potential', 'でき'],
      ['negative', 'ない', ['negative']]
    ],
    difference:
      'Yomitan deinflects 勉強できる as one verb; Kizuna explains できる as a label-only step.'
  },
  {
    word: '書いてもらえる',
    yomitan: null,
    steps: [
      ['stem:onbin', '書い'],
      ['te', 'て', ['-て']],
      ['receiving', 'もらえる']
    ],
    difference: 'Yomitan has no -てもらう transform; the step shows a label and source only.'
  },
  {
    word: '書いていただけます',
    yomitan: null,
    steps: [
      ['stem:onbin', '書い'],
      ['te', 'て', ['-て']],
      ['receiving', 'いただけ'],
      ['polite', 'ます', ['-ます']]
    ],
    difference: 'Yomitan has no -ていただく transform; the step shows a label and source only.'
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

  it('labels the する of a verbal noun by its conjugation form', () => {
    expect(chainOf('ipadic', '勉強させられた')[0].label).toBe('する (irrealis)')
    expect(chainOf('ipadic', '勉強している')[0].label).toBe('する (continuative)')
  })

  it('labels できる after a verbal noun as the potential of する', () => {
    expect(chainOf('ipadic', '勉強できない')[0].label).toBe('potential (できる, irrealis)')
    expect(chainOf('unidic', '書いてもらえる')[2].label).toBe('receiving, potential (もらえる)')
  })

  it('does not read a locative で before は as a copula', () => {
    const morphemes = WORDS.ipadic.get('学校では') ?? []
    expect(morphemes).toHaveLength(3)
    expect(grammarChain('学校', morphemes)).toEqual([])
  })

  it('labels the sound change of an onbin stem', () => {
    expect(chainOf('ipadic', '読んだ')[0].label).toBe('continuative stem, ん sound change (連用形)')
  })

  it('reads IPADIC ら抜き as potential; UniDic keeps it in one morpheme', () => {
    expect(chainOf('ipadic', '食べれる').map(kindName)).toEqual(['stem:irrealis', 'potential'])
    expect(chainOf('unidic', '食べれる').map((s) => [kindName(s), s.surface])).toEqual([
      ['potential', '食べれる']
    ])
  })

  // IPADIC lists 読める as a verb of its own, so only UniDic shows the potential.
  it('reads a UniDic godan potential as potential', () => {
    expect(chainOf('unidic', '読めなかった').map(kindName)).toEqual([
      'potential',
      'negative',
      'past'
    ])
    expect(chainOf('ipadic', '読めなかった').map(kindName)).toEqual([
      'stem:irrealis',
      'negative',
      'past'
    ])
  })

  it('does not read IPADIC explanatory ん after a dictionary form as negative', () => {
    const morpheme = (surface: string, lemma: string, type: string, form: string): Morpheme => ({
      surface,
      lemma,
      pos: surface === '書く' ? '動詞' : '助動詞',
      pos1: surface === '書く' ? '自立' : '',
      conjugationType: type,
      conjugationForm: form
    })
    const chain = grammarChain('書く', [
      morpheme('書く', '書く', '五段・カ行イ音便', '基本形'),
      morpheme('ん', 'ん', '不変化型', '基本形'),
      morpheme('でし', 'です', '特殊・デス', '連用形'),
      morpheme('た', 'た', '特殊・タ', '基本形')
    ])
    expect(chain.map(kindName)).not.toContain('negative')
  })

  it('reads ませんでしたら as a たら conditional', () => {
    const [stem, polite, negative, desu, past] = WORDS.ipadic.get('書きませんでした') ?? []
    const tara: Morpheme = { ...past, surface: 'たら', conjugationForm: '仮定形' }
    expect(grammarChain('書く', [stem, polite, negative, desu, tara]).at(-1)).toMatchObject({
      kind: 'conditional-tara',
      surface: 'でしたら'
    })
  })

  it('explains an IPADIC compound lemmatised with its suffix verb', () => {
    const morphemes = WORDS.ipadic.get('書きすぎる') ?? []
    expect(grammarChain('書きすぎる', morphemes).map(kindName)).toEqual([
      'stem:continuative',
      'excess'
    ])
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
      // Steps Yomitan does not cover show a label only rather than hand-written text.
      if (step.source === YOMITAN_SOURCE) expect(step.explanation).not.toBe('')
      else expect(step.explanation).toBe('')
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

  it('reads the IPADIC short causative す, where UniDic lemmatises 書かす', () => {
    const [stem, causative, passive] = WORDS.ipadic.get('書かされる') ?? []
    expect(stem).toBeDefined()
    expect(grammarChain('書く', [stem, causative, passive]).map(kindName)).toEqual([
      'stem:irrealis',
      'causative-passive'
    ])
  })

  it('returns no steps for a stem with nothing explained after it', () => {
    const [stem] = WORDS.ipadic.get('書いた') ?? []
    expect(grammarChain('書く', [stem])).toEqual([])
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
