import type { Morpheme, Token } from './token'
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
  | 'excess'
  | 'copula'

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

// Yomitan has no copula transform.
export const COPULA_SOURCE: SourceRef = {
  name: 'Wiktionary: だ',
  url: 'https://en.wiktionary.org/wiki/%E3%81%A0'
}

const COPULA_EXPLANATION =
  'Copula: states that the subject is the preceding noun or na-adjective.\n' +
  'Plain だ, polite です. Past だった / でした; negative ではない, contracted じゃない; ' +
  'polite negative ではありません.'

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

// UniDic tags ない after an adjective or copula as 形容詞,非自立可能 無い.
const isNegative = (m: Morpheme): boolean =>
  isAuxiliary(m, 'ない') || (m.pos === '形容詞' && (m.lemma === 'ない' || m.lemma === '無い'))

const isNominal = (m: Morpheme | undefined): boolean =>
  m?.pos === '名詞' || m?.pos === '形状詞' || m?.pos === '代名詞'

// IPADIC tags copula じゃ 助詞,副助詞; UniDic tags it 助動詞 だ.
const isCopula = (m: Morpheme): boolean =>
  isAuxiliary(m, 'だ', 'です') || (m.pos === '助詞' && m.pos1 === '副助詞' && m.surface === 'じゃ')

/** The copula plus the は and ある of ではある / じゃある, as one step. */
function copulaStep(
  morphemes: Morpheme[],
  index: number
): { steps: GrammarStep[]; consumed: number } {
  const m = morphemes[index]
  let surface = m.surface
  let consumed = 0
  const next = morphemes[index + 1]
  if (m.surface === 'で' && next?.pos === '助詞' && next.surface === 'は') {
    surface += next.surface
    consumed++
  }
  const after = morphemes[index + 1 + consumed]
  if (
    (surface === 'では' || surface === 'じゃ') &&
    after?.pos === '動詞' &&
    (after.lemma === 'ある' || after.lemma === '有る')
  ) {
    surface += after.surface
    consumed++
  }
  return {
    steps: [
      {
        kind: 'copula',
        surface,
        label: m.lemma === 'です' ? 'polite copula (です)' : 'copula (だ)',
        explanation: COPULA_EXPLANATION,
        source: COPULA_SOURCE,
        ...(surface.startsWith('じゃ') ? { contractionOf: 'では' } : {})
      }
    ],
    consumed
  }
}

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

  if (isNominal(previous) && isCopula(m)) return copulaStep(morphemes, index)
  if (isAuxiliary(m, 'ます')) return one(step('polite', m.surface, 'polite', '-ます'))
  if (isNegative(m)) {
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
  if (isAuxiliary(m, 'すぎる', '過ぎる'))
    return one(step('excess', m.surface, 'too much (すぎる)', '-すぎる'))
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

const adverbialStep = (): GrammarStep => step('adverbial', 'く', 'adverbial (く)', '-く')

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
  // Yomitan attaches くない, かった, くて, ければ to the adjective stem, so the
  // inflected ending joins the next step.
  let adjectiveEnding = ''
  if (head.pos === '形容詞' && form !== 'adjective-stem') {
    form = undefined
    const ending = /(?:く|かっ|けれ)$/.exec(head.surface)?.[0]
    if (ending && head.surface.length > ending.length) {
      steps.push(stemStep('adjective-stem', head.surface.slice(0, -ending.length)))
      adjectiveEnding = ending
    }
  }
  // UniDic keeps the volitional as one word (書こう); split off its う to match IPADIC.
  if (form === 'volitional' && rest.length === 0 && head.surface.endsWith('う')) {
    steps.push(stemStep(form, head.surface.slice(0, -1)))
    steps.push(step('volitional', 'う', 'volitional', 'volitional'))
  } else if (form) {
    steps.push(stemStep(form, head.surface))
  }

  for (let index = 1; index < morphemes.length; index++) {
    const { steps: found, consumed } = suffixSteps(morphemes, index)
    if (index === 1 && found[0]) {
      found[0] = { ...found[0], surface: adjectiveEnding + found[0].surface }
    } else if (index === 1 && adjectiveEnding === 'く') {
      steps.push(adverbialStep())
    }
    steps.push(...found)
    index += consumed
  }
  if (rest.length === 0 && adjectiveEnding === 'く') steps.push(adverbialStep())
  return steps
}

// IPADIC lemmas, then UniDic's kanji lemmas for the same auxiliaries.
const TE_FORM_AUXILIARY_LEMMAS = new Set([
  'いる',
  'おる',
  'しまう',
  'おく',
  'ある',
  'みる',
  'くる',
  'いく',
  'ゆく',
  'あげる',
  'さしあげる',
  'くれる',
  'くださる',
  'もらう',
  'いただく',
  '居る',
  '仕舞う',
  '置く',
  '有る',
  '見る',
  '来る',
  '行く',
  '上げる',
  '差し上げる',
  '呉れる',
  '下さる',
  '貰う',
  '頂く'
])
const TE_FORM_ENDINGS = new Set(['て', 'で', 'ちゃ', 'じゃ'])

const endsInTeForm = (token: Token): boolean => {
  const last = token.morphemes?.at(-1)
  return last?.pos === '助詞' && last.pos1 === '接続助詞' && TE_FORM_ENDINGS.has(last.surface)
}

const isTeFormAuxiliary = (token: Token): boolean => {
  const head = token.morphemes?.[0]
  return (
    head?.pos === '動詞' &&
    (head.pos1 === '非自立' || head.pos1 === '非自立可能') &&
    TE_FORM_AUXILIARY_LEMMAS.has(head.lemma)
  )
}

/** Joins auxiliary verbs that directly follow a て-form (読んで|いる) to the popup span. */
function extendTeFormAuxiliaries(cueTokens: Token[], span: Token[]): Token[] {
  const last = span.at(-1)
  let index = cueTokens.findIndex((token) => token.startOffset === last?.startOffset)
  if (index === -1) return span

  const extended = [...span]
  while (index + 1 < cueTokens.length) {
    const previous = cueTokens[index]
    const next = cueTokens[index + 1]
    const contiguous = next.startOffset === previous.startOffset + previous.surface.length
    if (!contiguous || !endsInTeForm(previous) || !isTeFormAuxiliary(next)) break
    extended.push(next)
    index++
  }
  return extended
}

// Dependent adjectives (UniDic 無い after じゃ) are suffixes, not heads.
const startsAdjectiveOrCopula = (token: Token): boolean => {
  const head = token.morphemes?.[0]
  if (head?.pos === '形容詞') return head.pos1 !== '非自立' && head.pos1 !== '非自立可能'
  return token.pos === '名詞' || token.pos === '形状詞' || token.pos === '代名詞'
}

const explainsSuffixes = (span: Token[]): boolean => {
  const explained = spanGrammarChain(span)
    .map((step) => step.surface)
    .join('')
  const surface = span.map((token) => token.surface).join('')
  return explained !== '' && (explained === surface || span[0].surface + explained === surface)
}

/**
 * Extends the popup span across auxiliary verbs after a て-form (読んで|いる) and
 * across the suffixes of an adjective or copula (高く|なかっ|た, 静か|じゃ|なかっ|た).
 */
export function extendGrammarSpan(cueTokens: Token[], span: Token[]): Token[] {
  const extended = extendTeFormAuxiliaries(cueTokens, span)
  if (!extended[0] || !startsAdjectiveOrCopula(extended[0])) return extended

  let index = cueTokens.findIndex((token) => token.startOffset === extended.at(-1)?.startOffset)
  if (index === -1) return extended
  while (index + 1 < cueTokens.length) {
    const previous = cueTokens[index]
    const next = cueTokens[index + 1]
    if (next.startOffset !== previous.startOffset + previous.surface.length) break
    if (!explainsSuffixes([...extended, next])) break
    extended.push(next)
    index++
  }
  return extended
}

const headMorpheme = (token: Token): Morpheme => ({
  surface: token.surface,
  lemma: token.lemma,
  pos: token.pos,
  pos1: '',
  conjugationType: '',
  conjugationForm: ''
})

/**
 * Grammar chain of a highlighted span; empty when a token after the head carries
 * no morphemes. An unconjugated head such as a noun before a copula needs none.
 */
export function spanGrammarChain(highlightedTokens: Token[]): GrammarStep[] {
  const [head, ...rest] = highlightedTokens
  if (!head || rest.some((token) => !token.morphemes)) return []
  return grammarChain(head.lemma, [
    ...(head.morphemes ?? [headMorpheme(head)]),
    ...rest.flatMap((token) => token.morphemes ?? [])
  ])
}

/**
 * Bump when `grammarChain` or `spanGrammarChain` changes its output, so stored
 * example databases built with the older analyzer are rebuilt.
 */
export const GRAMMAR_ANALYZER_VERSION = 2

/** Ordered suffix step kinds, stem excluded, e.g. `causative>passive-potential>negative>past`. */
export function grammarPatternKey(steps: GrammarStep[]): string {
  return steps.flatMap((step) => (typeof step.kind === 'string' ? [step.kind] : [])).join('>')
}
