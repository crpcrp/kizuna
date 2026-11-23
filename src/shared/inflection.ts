import type { Morpheme } from './token'
import {
  YOMITAN_TRANSFORM_DESCRIPTIONS,
  type YomitanTransformName
} from './yomitan/japaneseTransforms'

export type StemForm =
  | 'irrealis'
  | 'continuative'
  | 'onbin'
  | 'conditional'
  | 'imperative'
  | 'volitional'
  | 'adjective-stem'

export type GrammarStepKind =
  | 'polite'
  | 'negative'
  | 'past'
  | 'te'
  | 'conditional-ba'
  | 'conditional-tara'
  | 'volitional'
  | 'imperative'
  | 'desire'
  | 'passive-potential'
  | 'potential'
  | 'causative'
  | 'causative-passive'
  | 'progressive'
  | 'completion'
  | 'preparation'
  | 'resultative'
  | 'attempt'
  | 'direction'
  | 'giving'
  | 'receiving'
  | 'appearance'
  | 'hearsay'
  | 'conjecture'
  | 'adverbial'
  | 'nominal'
  | 'obligation'

export interface SourceRef {
  /** e.g. 'Yomitan japanese-transforms.js', 'UniDic manual'. */
  name: string
  url: string
}

export interface GrammarStep {
  kind: GrammarStepKind | { stem: StemForm }
  /** Kana in the subtitle that produced this step, e.g. 'られ' or the stem '書か'. */
  surface: string
  /** Short label: 'negative', 'passive / potential', 'irrealis stem (未然形)'. */
  label: string
  /** Meaning and formation, taken from `source`. */
  explanation: string
  source: SourceRef
  /** Colloquial contraction this step expands, e.g. 'てしまう' for ちゃう. */
  contractionOf?: string
}

export const YOMITAN_SOURCE: SourceRef = {
  name: 'Yomitan japanese-transforms.js',
  url: 'https://github.com/yomidevs/yomitan/blob/ce1b1bffa0e8819716317f3717932a7fe91e8d52/ext/js/language/ja/japanese-transforms.js'
}

const describe = (name: YomitanTransformName): string => YOMITAN_TRANSFORM_DESCRIPTIONS[name]

/** The "Usage: Attach … to the … form" tail of a Yomitan description. */
const usage = (name: YomitanTransformName): string => {
  const text = describe(name)
  return text.slice(text.indexOf('Usage:'))
}

interface StemInfo {
  label: string
  explanation: string
}

const STEMS: Record<StemForm, StemInfo> = {
  irrealis: {
    label: 'irrealis stem (未然形)',
    explanation: [usage('negative'), usage('passive'), usage('causative')].join('\n')
  },
  continuative: {
    label: 'continuative stem (連用形)',
    explanation: [describe('continuative'), usage('-ます'), usage('-たい')].join('\n')
  },
  onbin: {
    label: 'continuative stem, sound change (連用形)',
    explanation: [usage('-た'), usage('-て')].join('\n')
  },
  conditional: { label: 'hypothetical stem (仮定形)', explanation: usage('-ば') },
  imperative: { label: 'imperative (命令形)', explanation: describe('imperative') },
  volitional: { label: 'volitional stem (未然形)', explanation: usage('volitional') },
  'adjective-stem': {
    label: 'adjective stem (語幹)',
    explanation: [usage('-そう'), usage('-さ')].join('\n')
  }
}

// IPADIC and UniDic name the same forms differently; prefixes cover the variants.
const STEM_FORM_PREFIXES: [string, StemForm][] = [
  ['未然ウ接続', 'volitional'],
  ['意志推量形', 'volitional'],
  ['未然', 'irrealis'],
  ['連用タ接続', 'onbin'],
  ['連用形-イ音便', 'onbin'],
  ['連用形-撥音便', 'onbin'],
  ['連用形-促音便', 'onbin'],
  ['連用形-ウ音便', 'onbin'],
  ['連用', 'continuative'],
  ['仮定', 'conditional'],
  ['命令', 'imperative'],
  ['ガル接続', 'adjective-stem'],
  ['語幹', 'adjective-stem']
]

// Ichidan 未然形 and 連用形 are spelled alike and MeCab picks either; what follows decides.
const IRREALIS_SUFFIX_LEMMAS = new Set([
  'ない',
  'ん',
  'ず',
  'ぬ',
  'させる',
  'せる',
  'られる',
  'れる'
])
const isIchidan = (m: Morpheme): boolean => /^(?:[上下]?一段)/.test(m.conjugationType)

function stemFormOf(head: Morpheme, next: Morpheme | undefined): StemForm | undefined {
  const form = STEM_FORM_PREFIXES.find(([prefix]) => head.conjugationForm.startsWith(prefix))?.[1]
  if ((form === 'irrealis' || form === 'continuative') && isIchidan(head) && next) {
    return IRREALIS_SUFFIX_LEMMAS.has(next.lemma) ? 'irrealis' : 'continuative'
  }
  return form
}

function stemStep(form: StemForm, surface: string): GrammarStep {
  const info = STEMS[form]
  const sound = form === 'onbin' ? /[いんっう]$/.exec(surface)?.[0] : undefined
  return {
    kind: { stem: form },
    surface,
    label: sound ? `continuative stem, ${sound} sound change (連用形)` : info.label,
    explanation: info.explanation,
    source: YOMITAN_SOURCE
  }
}

function step(
  kind: GrammarStepKind,
  surface: string,
  label: string,
  transform: YomitanTransformName,
  contractionOf?: string
): GrammarStep {
  return {
    kind,
    surface,
    label,
    explanation: describe(transform),
    source: YOMITAN_SOURCE,
    ...(contractionOf ? { contractionOf } : {})
  }
}

// IPADIC tags these 動詞,接尾 or 動詞,非自立; UniDic tags most of them 助動詞.
const isAuxiliary = (m: Morpheme, ...lemmas: string[]): boolean =>
  lemmas.includes(m.lemma) &&
  (m.pos === '助動詞' || (m.pos === '動詞' && ['接尾', '非自立', '非自立可能'].includes(m.pos1)))

const isConjunctive = (m: Morpheme, ...lemmas: string[]): boolean =>
  m.pos === '助詞' && m.pos1 === '接続助詞' && lemmas.includes(m.lemma)

const voiced = (surface: string): boolean => /^[でど]/.test(surface)

/** Steps for `morphemes[index]`; `consumed` counts extra morphemes the steps cover. */
function suffixSteps(
  morphemes: Morpheme[],
  index: number
): { steps: GrammarStep[]; consumed: number } {
  const m = morphemes[index]
  const previous = morphemes[index - 1]
  const next = morphemes[index + 1]
  const one = (s: GrammarStep): { steps: GrammarStep[]; consumed: number } => ({
    steps: [s],
    consumed: 0
  })

  if (isAuxiliary(m, 'ます')) return one(step('polite', m.surface, 'polite', '-ます'))
  if (isAuxiliary(m, 'ない')) {
    // なきゃ / なけりゃ: IPADIC 仮定縮約, UniDic 仮定形-融合.
    if (m.conjugationForm.startsWith('仮定縮約') || m.conjugationForm === '仮定形-融合') {
      return {
        steps: [
          step('negative', m.surface.slice(0, 1), 'negative', 'negative'),
          step('conditional-ba', m.surface.slice(1), 'conditional (ば)', '-ば', 'ければ')
        ],
        consumed: 0
      }
    }
    return one(step('negative', m.surface, 'negative', 'negative'))
  }
  // IPADIC lemma ん, UniDic lemma ず; ません is the plain polite negative.
  if (m.surface === 'ん' && isAuxiliary(m, 'ん', 'ず')) {
    return one(
      previous && isAuxiliary(previous, 'ます')
        ? step('negative', m.surface, 'negative', 'negative')
        : step('negative', m.surface, 'negative (ん)', '-ん', 'ぬ')
    )
  }
  // IPADIC lemmatises past だ as だ, sharing it with the copula but not its 特殊・タ type.
  if (isAuxiliary(m, 'た') || (isAuxiliary(m, 'だ') && m.conjugationType === '特殊・タ')) {
    return one(
      m.conjugationForm.startsWith('仮定')
        ? step('conditional-tara', m.surface, 'conditional (たら)', '-たら')
        : step('past', m.surface, 'past', '-た')
    )
  }
  if (m.pos === '助詞' && m.pos1 === '接続助詞' && /^[ちじ]ゃ$/.test(m.surface)) {
    return one(
      step('te', m.surface, 'て-form + は', '-ちゃ', m.surface === 'ちゃ' ? 'ては' : 'では')
    )
  }
  if (isConjunctive(m, 'て', 'で')) return one(step('te', m.surface, 'て-form', '-て'))
  if (isConjunctive(m, 'ば'))
    return one(step('conditional-ba', m.surface, 'conditional (ば)', '-ば'))
  if (isAuxiliary(m, 'う', 'よう'))
    return one(step('volitional', m.surface, 'volitional', 'volitional'))
  if (isAuxiliary(m, 'たい')) return one(step('desire', m.surface, 'desire (たい)', '-たい'))
  if (isAuxiliary(m, 'させる', 'せる')) {
    if (next && isAuxiliary(next, 'られる', 'れる')) {
      // No single Yomitan transform; Yomitan chains causative then potential or passive.
      return {
        steps: [
          {
            kind: 'causative-passive',
            surface: m.surface + next.surface,
            label: 'causative-passive',
            explanation: `${describe('causative')}\n${describe('potential or passive')}`,
            source: YOMITAN_SOURCE
          }
        ],
        consumed: 1
      }
    }
    return one(step('causative', m.surface, 'causative', 'causative'))
  }
  if (isAuxiliary(m, 'られる', 'れる')) {
    // IPADIC splits ら抜き 食べれる into an ichidan (or カ変) stem plus れる.
    const raNuki = m.lemma === 'れる' && previous && /^(?:一段|カ変)/.test(previous.conjugationType)
    return one(
      raNuki
        ? step('potential', m.surface, 'potential', 'potential')
        : step('passive-potential', m.surface, 'passive / potential', 'potential or passive')
    )
  }
  if (isAuxiliary(m, 'ちゃう', 'じゃう')) {
    return one(
      step(
        'completion',
        m.surface,
        'completion (しまう)',
        '-ちゃう',
        voiced(m.surface) ? 'でしまう' : 'てしまう'
      )
    )
  }
  if (isAuxiliary(m, 'ちまう', 'じまう')) {
    return one(
      step(
        'completion',
        m.surface,
        'completion (しまう)',
        '-ちまう',
        voiced(m.surface) ? 'でしまう' : 'てしまう'
      )
    )
  }
  if (isAuxiliary(m, 'てる', 'でる')) {
    return one(
      step(
        'progressive',
        m.surface,
        'progressive / state (いる)',
        '-いる',
        voiced(m.surface) ? 'でいる' : 'ている'
      )
    )
  }
  if (isAuxiliary(m, 'とく', 'どく')) {
    return one(
      step(
        'preparation',
        m.surface,
        'in advance (おく)',
        '-おく',
        voiced(m.surface) ? 'でおく' : 'ておく'
      )
    )
  }
  const afterTe = previous !== undefined && isConjunctive(previous, 'て', 'で')
  if (afterTe && isAuxiliary(m, 'いる', '居る')) {
    return one(step('progressive', m.surface, 'progressive / state (いる)', '-いる'))
  }
  if (afterTe && isAuxiliary(m, 'おく', '置く')) {
    return one(step('preparation', m.surface, 'in advance (おく)', '-おく'))
  }
  if (afterTe && isAuxiliary(m, 'しまう', '仕舞う')) {
    return one(step('completion', m.surface, 'completion (しまう)', '-しまう'))
  }
  // IPADIC 名詞,接尾 そう; UniDic lemma そう-様態 (hearsay is そう-伝聞).
  if (m.lemma === 'そう-様態' || (m.lemma === 'そう' && m.pos === '名詞' && m.pos1 === '接尾')) {
    return one(step('appearance', m.surface, 'appearance (そう)', '-そう'))
  }
  // IPADIC 名詞,接尾 さ; UniDic 接尾辞,名詞的 さ.
  if (m.lemma === 'さ' && (m.pos1 === '接尾' || m.pos === '接尾辞')) {
    return one(step('nominal', m.surface, 'nominalizer (さ)', '-さ'))
  }
  return { steps: [], consumed: 0 }
}

/**
 * Ordered, surface-aligned grammar steps of a conjugated word, starting with the
 * head word's stem. `dictionaryForm` is the head word's lemma; an unconjugated
 * word yields no steps.
 */
export function grammarChain(dictionaryForm: string, morphemes: Morpheme[]): GrammarStep[] {
  const [head, ...rest] = morphemes
  if (!head || morphemes.map((m) => m.surface).join('') === dictionaryForm) return []

  const steps: GrammarStep[] = []
  let form = stemFormOf(head, rest[0])
  // Adjective conjugation beyond the stem belongs to #567.
  if (head.pos === '形容詞' && form !== 'adjective-stem') form = undefined
  // UniDic keeps the volitional as one word (書こう); split off its う to match IPADIC.
  if (form === 'volitional' && rest.length === 0 && head.surface.endsWith('う')) {
    steps.push(stemStep(form, head.surface.slice(0, -1)))
    steps.push(step('volitional', 'う', 'volitional', 'volitional'))
  } else if (form) {
    steps.push(stemStep(form, head.surface))
  }

  for (let index = 1; index < morphemes.length; index++) {
    const { steps: found, consumed } = suffixSteps(morphemes, index)
    steps.push(...found)
    index += consumed
  }
  return steps
}
