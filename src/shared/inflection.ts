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
  | 'outward-sign'
  | 'te-wa'
  | 'polite-imperative'
  | 'tari'
  | 'suru'
  | 'negative-conditional'
  | 'prohibitive'
  | 'concessive'
  | 'conditional-nara'
  | 'seeming'
  | 'negative-volitional'
  | 'assertion'

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

// Yomitan has no transforms for the copula or these て-form auxiliaries; their
// steps show a label and source only, since no explanation is written by hand.
export const COPULA_SOURCE: SourceRef = {
  name: 'Wiktionary: だ',
  url: 'https://en.wiktionary.org/wiki/%E3%81%A0'
}

export const AUXILIARY_VERBS_SOURCE: SourceRef = {
  name: 'Wikipedia: Japanese grammar',
  url: 'https://en.wikipedia.org/wiki/Japanese_grammar#Auxiliary_verbs'
}
export const HEARSAY_SOURCE: SourceRef = {
  name: 'Wiktionary: そう',
  url: 'https://en.wiktionary.org/wiki/%E3%81%9D%E3%81%86#Japanese'
}
export const ADJECTIVE_POLITE_SOURCE: SourceRef = {
  name: 'Wikipedia: Japanese grammar',
  url: 'https://en.wikipedia.org/wiki/Japanese_grammar#Polite_forms_of_adjectives'
}
export const SURU_SOURCE: SourceRef = {
  name: 'Wikipedia: Japanese grammar',
  url: 'https://en.wikipedia.org/wiki/Japanese_grammar#Word_class_system'
}
export const PROHIBITIVE_SOURCE: SourceRef = {
  name: 'Wiktionary: な',
  url: 'https://en.wiktionary.org/wiki/%E3%81%AA#Japanese'
}
export const CONCESSIVE_SOURCE: SourceRef = {
  name: 'Wiktionary: ても',
  url: 'https://en.wiktionary.org/wiki/%E3%81%A6%E3%82%82'
}
export const AGERU_SOURCE: SourceRef = {
  name: 'Wiktionary: あげる',
  url: 'https://en.wiktionary.org/wiki/%E3%81%82%E3%81%92%E3%82%8B'
}
export const KURERU_SOURCE: SourceRef = {
  name: 'Wiktionary: くれる',
  url: 'https://en.wiktionary.org/wiki/%E3%81%8F%E3%82%8C%E3%82%8B'
}
export const MORAU_SOURCE: SourceRef = {
  name: 'Wiktionary: もらう',
  url: 'https://en.wiktionary.org/wiki/%E3%82%82%E3%82%89%E3%81%86'
}
export const DEKIRU_SOURCE: SourceRef = {
  name: 'Wiktionary: できる',
  url: 'https://en.wiktionary.org/wiki/%E3%81%A7%E3%81%8D%E3%82%8B'
}
export const NARA_SOURCE: SourceRef = {
  name: 'Wiktionary: なら',
  url: 'https://en.wiktionary.org/wiki/%E3%81%AA%E3%82%89'
}
export const RASHII_SOURCE: SourceRef = {
  name: 'Wiktionary: らしい',
  url: 'https://en.wiktionary.org/wiki/%E3%82%89%E3%81%97%E3%81%84'
}
export const BESHI_SOURCE: SourceRef = {
  name: 'Wiktionary: べし',
  url: 'https://en.wiktionary.org/wiki/%E3%81%B9%E3%81%97'
}
export const MAI_SOURCE: SourceRef = {
  name: 'Wiktionary: まい',
  url: 'https://en.wiktionary.org/wiki/%E3%81%BE%E3%81%84'
}
export const JAN_SOURCE: SourceRef = {
  name: 'Wiktionary: じゃん',
  url: 'https://en.wiktionary.org/wiki/%E3%81%98%E3%82%83%E3%82%93'
}

interface TeAuxiliary {
  kind: GrammarStepKind
  label: string
  source: SourceRef
}

// IPADIC lemmas, then UniDic's kanji lemmas for the same auxiliaries.
const TE_AUXILIARY_STEPS: [string[], TeAuxiliary][] = [
  [
    ['ある', '有る'],
    { kind: 'resultative', label: 'resultative (ある)', source: AUXILIARY_VERBS_SOURCE }
  ],
  [['みる', '見る'], { kind: 'attempt', label: 'try (みる)', source: AUXILIARY_VERBS_SOURCE }],
  [
    ['くる', '来る'],
    { kind: 'direction', label: 'direction (くる)', source: AUXILIARY_VERBS_SOURCE }
  ],
  [
    ['いく', 'ゆく', '行く'],
    { kind: 'direction', label: 'direction (いく)', source: AUXILIARY_VERBS_SOURCE }
  ],
  [['あげる', '上げる'], { kind: 'giving', label: 'giving (あげる)', source: AGERU_SOURCE }],
  [
    ['さしあげる', '差し上げる'],
    { kind: 'giving', label: 'giving (さしあげる)', source: AGERU_SOURCE }
  ],
  [['くれる', '呉れる'], { kind: 'giving', label: 'giving (くれる)', source: KURERU_SOURCE }],
  [['くださる', '下さる'], { kind: 'giving', label: 'giving (くださる)', source: KURERU_SOURCE }],
  [['もらう', '貰う'], { kind: 'receiving', label: 'receiving (もらう)', source: MORAU_SOURCE }],
  [['いただく', '頂く'], { kind: 'receiving', label: 'receiving (いただく)', source: MORAU_SOURCE }]
]

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

// Ichidan 未然形 and 連用形 are spelled alike, as are kanji 来 (こ / き), and MeCab
// picks either; what follows decides.
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
const hasAmbiguousStem = (m: Morpheme): boolean =>
  /^(?:[上下]?一段)/.test(m.conjugationType) ||
  (/^カ(?:変|行変格)/.test(m.conjugationType) && m.surface.endsWith('来'))

function stemFormOf(head: Morpheme, next: Morpheme | undefined): StemForm | undefined {
  const form = STEM_FORM_PREFIXES.find(([prefix]) => head.conjugationForm.startsWith(prefix))?.[1]
  if ((form === 'irrealis' || form === 'continuative') && hasAmbiguousStem(head) && next) {
    return IRREALIS_SUFFIX_LEMMAS.has(next.lemma) ? 'irrealis' : 'continuative'
  }
  // UniDic tags the い of いらっしゃい|ます and ござい|ます as an イ音便 too.
  if (form === 'onbin' && next?.lemma === 'ます') return 'continuative'
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

/** A step Yomitan has no transform for: a label and source only. */
const labelStep = (
  kind: GrammarStepKind,
  surface: string,
  label: string,
  source: SourceRef
): GrammarStep => ({ kind, surface, label, explanation: '', source })

const SURU_LEMMAS = new Set(['する', '為る'])
const DEKIRU_LEMMAS = new Set(['できる', '出来る'])
const SURU_FORM_NAMES: Partial<Record<StemForm, string>> = {
  irrealis: 'irrealis',
  continuative: 'continuative',
  conditional: 'hypothetical',
  imperative: 'imperative',
  volitional: 'volitional'
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

// たい, ない and らしい conjugate as i-adjectives.
const isAdjectival = (m: Morpheme | undefined): boolean =>
  m !== undefined && (m.pos === '形容詞' || isNegative(m) || isAuxiliary(m, 'たい', 'らしい'))

/** Whether `morphemes[index]` ends an i-adjective: 高い, 高かっ|た, 高く|ない, 書き|たい. */
function endsAdjective(morphemes: Morpheme[], index: number): boolean {
  const m = morphemes[index]
  return isAdjectival(m) || (isAuxiliary(m, 'た') && isAdjectival(morphemes[index - 1]))
}

// IPADIC tags copula じゃ 助詞,副助詞; UniDic tags it 助動詞 だ. UniDic also reads
// adverbial に (静かに) as だ, where IPADIC has a particle.
const isCopula = (m: Morpheme): boolean =>
  (isAuxiliary(m, 'だ', 'です') && m.surface !== 'に') ||
  (m.pos === '助詞' && m.pos1 === '副助詞' && m.surface === 'じゃ')

const isAru = (m: Morpheme | undefined): boolean =>
  m?.pos === '動詞' && (m.lemma === 'ある' || m.lemma === '有る')

// Both dictionaries tag the で of 学生ではなく / ではありません a case particle.
function isCaseParticleCopula(morphemes: Morpheme[], index: number): boolean {
  const [m, next, after] = morphemes.slice(index, index + 3)
  return (
    m.pos === '助詞' &&
    m.pos1 === '格助詞' &&
    m.surface === 'で' &&
    next?.pos === '助詞' &&
    next.surface === 'は' &&
    after !== undefined &&
    (isNegative(after) || isAru(after))
  )
}

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
  if ((surface === 'では' || surface === 'じゃ') && isAru(after)) {
    surface += after.surface
    consumed++
  }
  if (consumed === 0) {
    const conjecture = conjectureStep(morphemes, index)
    if (conjecture) return conjecture
  }
  return {
    steps: [
      {
        kind: 'copula',
        surface,
        label: m.lemma === 'です' ? 'polite copula (です)' : 'copula (だ)',
        explanation: '',
        source: COPULA_SOURCE,
        ...(surface.startsWith('じゃ') ? { contractionOf: 'では' } : {})
      }
    ],
    consumed
  }
}

/** でしょう / だろう: IPADIC でしょ|う, UniDic one 意志推量形 morpheme. */
function conjectureStep(
  morphemes: Morpheme[],
  index: number
): { steps: GrammarStep[]; consumed: number } | undefined {
  const m = morphemes[index]
  const next = morphemes[index + 1]
  if (!isAuxiliary(m, 'だ', 'です') || m.conjugationType === '特殊・タ') return undefined
  const split =
    m.conjugationForm.startsWith('未然') && next !== undefined && isAuxiliary(next, 'う')
  if (!split && m.conjugationForm !== '意志推量形') return undefined
  const surface = split ? m.surface + next.surface : m.surface
  const label = m.lemma === 'です' ? 'conjecture (でしょう)' : 'conjecture (だろう)'
  return {
    steps: [labelStep('conjecture', surface, label, COPULA_SOURCE)],
    consumed: split ? 1 : 0
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

  // IPADIC lemmatises past だら as だ too, but types it 特殊・タ.
  if (isCopula(m) && m.conjugationType !== '特殊・タ' && m.conjugationForm.startsWith('仮定')) {
    return one(labelStep('conditional-nara', m.surface, 'conditional (なら)', NARA_SOURCE))
  }
  // べき is attributive, so a copula may follow it (行くべきだ).
  const takesCopula = isNominal(previous) || (previous && isAuxiliary(previous, 'べし'))
  if (takesCopula && (isCopula(m) || isCaseParticleCopula(morphemes, index))) {
    return copulaStep(morphemes, index)
  }
  if (isAuxiliary(m, 'らしい')) {
    return one(labelStep('seeming', m.surface, 'apparently / -like (らしい)', RASHII_SOURCE))
  }
  if (isAuxiliary(m, 'べし')) {
    return one(labelStep('obligation', m.surface, 'should (べき)', BESHI_SOURCE))
  }
  if (isAuxiliary(m, 'まい')) {
    return one(
      labelStep('negative-volitional', m.surface, 'negative volitional (まい)', MAI_SOURCE)
    )
  }
  // IPADIC tags じゃん 助動詞; UniDic 助詞,終助詞.
  if (m.surface === 'じゃん' && (m.pos === '助動詞' || m.pos1 === '終助詞')) {
    return one({
      ...labelStep('assertion', m.surface, "isn't it (じゃん)", JAN_SOURCE),
      contractionOf: 'じゃないか'
    })
  }
  const conjecture = conjectureStep(morphemes, index)
  if (conjecture) return conjecture
  // ません|でし|た: Yomitan reads でした as the past of ません.
  if (
    isAuxiliary(m, 'です') &&
    previous?.surface === 'ん' &&
    isAuxiliary(previous, 'ん', 'ず') &&
    next !== undefined &&
    isAuxiliary(next, 'た')
  ) {
    const surface = m.surface + next.surface
    const conditional = next.conjugationForm.startsWith('仮定')
    return {
      steps: [
        conditional
          ? step('conditional-tara', surface, 'conditional (たら)', '-たら')
          : step('past', surface, 'past', '-た')
      ],
      consumed: 1
    }
  }
  // 高く|あり|ませ|ん: the polite negative of an i-adjective.
  if (
    isAru(m) &&
    previous?.surface.endsWith('く') &&
    isAdjectival(previous) &&
    next !== undefined &&
    isAuxiliary(next, 'ます')
  ) {
    return {
      steps: [
        labelStep('polite', m.surface + next.surface, 'polite (あります)', ADJECTIVE_POLITE_SOURCE)
      ],
      consumed: 1
    }
  }
  if (isAuxiliary(m, 'です') && endsAdjective(morphemes, index - 1)) {
    return one(labelStep('polite', m.surface, 'polite (です)', ADJECTIVE_POLITE_SOURCE))
  }
  // A verbal noun's する (勉強|し|た); the noun is the span head.
  if (index === 1 && isNominal(previous) && m.pos === '動詞' && SURU_LEMMAS.has(m.lemma)) {
    const form = stemFormOf(m, next)
    const name = form && SURU_FORM_NAMES[form]
    return one(labelStep('suru', m.surface, name ? `する (${name})` : 'する', SURU_SOURCE))
  }
  // できる, the potential of する, after a verbal noun (勉強|でき|ない).
  if (index === 1 && isNominal(previous) && m.pos === '動詞' && DEKIRU_LEMMAS.has(m.lemma)) {
    const form = stemFormOf(m, next)
    const name = form && SURU_FORM_NAMES[form]
    const label = name ? `potential (できる, ${name})` : 'potential (できる)'
    return one(labelStep('potential', m.surface, label, DEKIRU_SOURCE))
  }
  if (isAuxiliary(m, 'ます')) return one(step('polite', m.surface, 'polite', '-ます'))
  if (isNegative(m)) return one(step('negative', m.surface, 'negative', 'negative'))
  // IPADIC lemma ん, UniDic lemma ず; ません is the plain polite negative.
  // IPADIC can read explanatory ん after a dictionary form (書くんでした) as negative ん.
  if (m.surface === 'ん' && isAuxiliary(m, 'ん', 'ず') && !isDictionaryForm(previous)) {
    return one(
      previous && isAuxiliary(previous, 'ます')
        ? step('negative', m.surface, 'negative', 'negative')
        : step('negative', m.surface, 'negative (ん)', '-ん', 'ぬ')
    )
  }
  if (
    m.surface === 'ね' &&
    isAuxiliary(m, 'ぬ', 'ず') &&
    next !== undefined &&
    isConjunctive(next, 'ば')
  ) {
    return {
      steps: [step('negative-conditional', 'ねば', 'negative conditional (ねば)', '-ねば')],
      consumed: 1
    }
  }
  // IPADIC lemmatises ず as ぬ; UniDic lemmatises both as ず.
  if ((m.surface === 'ず' || m.surface === 'ぬ') && isAuxiliary(m, 'ぬ', 'ず')) {
    return one(
      step('negative', m.surface, `negative (${m.surface})`, m.surface === 'ず' ? '-ず' : '-ぬ')
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
      step('te-wa', m.surface, 'て-form + は', '-ちゃ', m.surface === 'ちゃ' ? 'ては' : 'では')
    )
  }
  // Contracted ています / ていた / ていない read as て|ます, で|た, で|ない (知ってます, 飲んでた).
  if (
    isConjunctive(m, 'て', 'で') &&
    !isAdjectival(previous) &&
    next &&
    (isAuxiliary(next, 'ます', 'た') || isNegative(next))
  ) {
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
  if (isConjunctive(m, 'て', 'で')) return one(step('te', m.surface, 'て-form', '-て'))
  if (
    m.pos === '助詞' &&
    m.surface === 'も' &&
    previous !== undefined &&
    isConjunctive(previous, 'て', 'で')
  ) {
    return one(labelStep('concessive', 'も', 'even if (ても)', CONCESSIVE_SOURCE))
  }
  if (
    m.pos === '助詞' &&
    m.pos1 === '終助詞' &&
    m.surface === 'な' &&
    index === morphemes.length - 1 &&
    previous?.pos === '動詞' &&
    /^(?:基本形|終止形)/.test(previous.conjugationForm)
  ) {
    return one(labelStep('prohibitive', 'な', 'prohibitive (な)', PROHIBITIVE_SOURCE))
  }
  if (isConjunctive(m, 'ば'))
    return one(step('conditional-ba', m.surface, 'conditional (ば)', '-ば'))
  if (isAuxiliary(m, 'う', 'よう'))
    return one(step('volitional', m.surface, 'volitional', 'volitional'))
  if (isAuxiliary(m, 'なさる', '為さる')) {
    return one(step('polite-imperative', m.surface, 'polite imperative (なさい)', '-なさい'))
  }
  // IPADIC: 助詞,並立助詞 たり / だり, or 助動詞 たり after an adjective; UniDic: 助詞,副助詞 たり.
  if (
    (m.lemma === 'たり' || m.lemma === 'だり') &&
    (m.pos === '助詞' || m.pos === '助動詞') &&
    !isNominal(previous)
  ) {
    return one(step('tari', m.surface, 'listing actions (たり)', '-たり'))
  }
  if (isAuxiliary(m, 'すぎる', '過ぎる'))
    return one(step('excess', m.surface, 'too much (すぎる)', '-すぎる'))
  if (isAuxiliary(m, 'たい')) return one(step('desire', m.surface, 'desire (たい)', '-たい'))
  // UniDic keeps たがる as one morpheme; IPADIC splits it into た (たい) and がる.
  if (isAuxiliary(m, 'たがる') && m.surface.startsWith('た')) {
    return {
      steps: [
        step('desire', 'た', 'desire (たい)', '-たい'),
        step('outward-sign', m.surface.slice(1), 'outward sign (がる)', '-がる')
      ],
      consumed: 0
    }
  }
  // UniDic tags がる after an adjective stem 接尾辞,動詞的.
  if (isAuxiliary(m, 'がる') || (m.lemma === 'がる' && m.pos === '接尾辞')) {
    return one(step('outward-sign', m.surface, 'outward sign (がる)', '-がる'))
  }
  // IPADIC tags the short causative す / さす (書かされる) 動詞,接尾.
  const shortCausative = isAuxiliary(m, 'す', 'さす')
  if (shortCausative || isAuxiliary(m, 'させる', 'せる')) {
    const transform = shortCausative ? 'short causative' : 'causative'
    if (next && isAuxiliary(next, 'られる', 'れる')) {
      // No single Yomitan transform; Yomitan chains causative then potential or passive.
      return {
        steps: [
          {
            kind: 'causative-passive',
            surface: m.surface + next.surface,
            label: 'causative-passive',
            explanation: `${describe(transform)}\n${describe('potential or passive')}`,
            source: YOMITAN_SOURCE
          }
        ],
        consumed: 1
      }
    }
    return one(step('causative', m.surface, 'causative', transform))
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
  // UniDic lemmatises the ちゃ / じゃ of ては / では as て; no auxiliary follows those.
  const afterTe =
    previous !== undefined &&
    isConjunctive(previous, 'て', 'で') &&
    /^[てで]$/.test(previous.surface)
  if (afterTe && isAuxiliary(m, 'いる', '居る', 'おる')) {
    return one(step('progressive', m.surface, 'progressive / state (いる)', '-いる'))
  }
  if (afterTe && isAuxiliary(m, 'おく', '置く')) {
    return one(step('preparation', m.surface, 'in advance (おく)', '-おく'))
  }
  if (afterTe && isAuxiliary(m, 'しまう', '仕舞う')) {
    return one(step('completion', m.surface, 'completion (しまう)', '-しまう'))
  }
  const receiving = afterTe ? receivingPotential(m) : undefined
  if (receiving) {
    return one(
      labelStep('receiving', m.surface, `receiving, potential (${receiving})`, MORAU_SOURCE)
    )
  }
  const teAuxiliary =
    afterTe && isTeAuxiliaryMorpheme(m)
      ? TE_AUXILIARY_STEPS.find(([lemmas]) => lemmas.includes(m.lemma))?.[1]
      : undefined
  if (teAuxiliary) {
    return one({
      kind: teAuxiliary.kind,
      surface: m.surface,
      label: teAuxiliary.label,
      explanation: '',
      source: teAuxiliary.source
    })
  }
  // UniDic tags hearsay そう-伝聞 and appearance そう-様態. IPADIC tags both 名詞,接尾 after
  // an adjective; hearsay follows a dictionary form (高いそう), appearance a stem (高そう).
  const ipadicSou = m.lemma === 'そう' && m.pos === '名詞' && ['接尾', '特殊'].includes(m.pos1)
  // UniDic also tags it そう-様態 after a dictionary form, which it may call 連体形 (書く|そう|だ).
  const afterDictionaryForm = isDictionaryForm(previous)
  if (
    m.lemma === 'そう-伝聞' ||
    (m.lemma === 'そう-様態' && afterDictionaryForm) ||
    (ipadicSou && afterDictionaryForm)
  ) {
    return one(labelStep('hearsay', m.surface, 'hearsay (そう)', HEARSAY_SOURCE))
  }
  if (m.lemma === 'そう-様態' || (ipadicSou && m.pos1 === '接尾')) {
    return one(step('appearance', m.surface, 'appearance (そう)', '-そう'))
  }
  // IPADIC 名詞,接尾 さ; UniDic 接尾辞,名詞的 さ.
  if (m.lemma === 'さ' && (m.pos1 === '接尾' || m.pos === '接尾辞')) {
    // よ|さ|そう: the さ inserted before appearance そう after よい and ない.
    if (next?.lemma === 'そう') {
      return { steps: [step('appearance', 'さそう', 'appearance (そう)', '-そう')], consumed: 1 }
    }
    return one(step('nominal', m.surface, 'nominalizer (さ)', '-さ'))
  }
  return { steps: [], consumed: 0 }
}

// 基本形 is IPADIC's; UniDic splits it into 終止形 and 連体形.
const isDictionaryForm = (m: Morpheme | undefined): boolean =>
  /^(?:基本形|終止形|連体形)/.test(m?.conjugationForm ?? '')

const adverbialStep = (): GrammarStep => step('adverbial', 'く', 'adverbial (く)', '-く')
const volitionalStep = (): GrammarStep => step('volitional', 'う', 'volitional', 'volitional')

/** Joins a compound verb's later verbs (書き|終わっ|た) into its head, which the token lemma names. */
function joinCompoundVerb(morphemes: Morpheme[]): Morpheme[] {
  const joined = [...morphemes]
  while (
    joined[0].pos === '動詞' &&
    joined[0].conjugationForm.startsWith('連用') &&
    joined[1]?.pos === '動詞' &&
    suffixSteps(joined, 1).steps.length === 0
  ) {
    const [first, second] = joined
    joined.splice(0, 2, { ...second, surface: first.surface + second.surface })
  }
  return joined
}

// UniDic lemmatises a potential as its base verb but conjugates it as ichidan:
// 読め|る (読む) and ら抜き 食べれ|る (食べる, 下一段-ラ行). IPADIC lists 読める as its own verb.
const isPotentialVerb = (m: Morpheme): boolean =>
  m.pos === '動詞' &&
  m.conjugationType.startsWith('下一段') &&
  (!m.lemma.endsWith('る') || (m.conjugationType === '下一段-ラ行' && !m.lemma.endsWith('れる')))

// What a contracted ば ending stands for: 書きゃ ← 書けば, 読めりゃ ← 読めれば, 言や ← 言えば.
const UNCONTRACTED_BA: Record<string, string> = {
  きゃ: 'けば',
  ぎゃ: 'げば',
  しゃ: 'せば',
  ちゃ: 'てば',
  にゃ: 'ねば',
  びゃ: 'べば',
  みゃ: 'めば',
  りゃ: 'れば',
  や: 'えば'
}

/**
 * Splits a contracted ば (書きゃ, 高けりゃ, 書かせりゃ; IPADIC 仮定縮約, UniDic 仮定形-融合)
 * off the last of `steps`, which ends with `m`.
 */
function splitContractedBa(m: Morpheme, steps: GrammarStep[]): GrammarStep[] {
  if (!m.conjugationForm.startsWith('仮定縮約') && m.conjugationForm !== '仮定形-融合') return steps
  const adjectival = isAdjectival(m)
  const part = (adjectival ? /(?:けりゃ|きゃ)$/ : /(?:[きぎしちにびみり]ゃ|や)$/).exec(
    m.surface
  )?.[0]
  const last = steps.at(-1)
  if (!part || !last?.surface.endsWith(part) || last.surface === part) return steps
  const contractionOf = adjectival ? 'ければ' : UNCONTRACTED_BA[part]
  return [
    ...steps.slice(0, -1),
    { ...last, surface: last.surface.slice(0, -part.length) },
    step('conditional-ba', part, 'conditional (ば)', '-ば', contractionOf)
  ]
}

/**
 * Ordered, surface-aligned grammar steps of a conjugated word, starting with the
 * head word's stem. `dictionaryForm` is the head word's lemma; an unconjugated
 * word yields no steps.
 */
export function grammarChain(dictionaryForm: string, allMorphemes: Morpheme[]): GrammarStep[] {
  if (!allMorphemes[0]) return []
  // IPADIC lemmatises a verb with its suffix verb (書きすぎる) as one word; it is still explained.
  if (allMorphemes.length === 1 && allMorphemes[0].surface === dictionaryForm) return []
  const morphemes = joinCompoundVerb(allMorphemes)
  const [head, ...rest] = morphemes

  const steps: GrammarStep[] = []
  let form = stemFormOf(head, rest[0])
  if (isPotentialVerb(head)) {
    form = undefined
    steps.push(
      ...splitContractedBa(head, [step('potential', head.surface, 'potential', 'potential')])
    )
  }
  // Yomitan attaches くない, かった, くて, ければ to the adjective stem, so the
  // inflected ending joins the next step.
  let adjectiveEnding = ''
  // UniDic よさ|そう, なさ|そう; IPADIC splits off the さ.
  if (head.conjugationForm === '語幹-サ' && head.surface.endsWith('さ') && rest.length > 0) {
    steps.push(stemStep('adjective-stem', head.surface.slice(0, -1)))
    adjectiveEnding = 'さ'
    form = undefined
  } else if (head.pos === '形容詞' && form !== 'adjective-stem') {
    form = undefined
    const contracted = splitContractedBa(head, [stemStep('adjective-stem', head.surface)])
    if (contracted.length > 1) steps.push(...contracted)
    const ending = /(?:く|かっ|けれ)$/.exec(head.surface)?.[0]
    if (ending && head.surface.length > ending.length) {
      steps.push(stemStep('adjective-stem', head.surface.slice(0, -ending.length)))
      adjectiveEnding = ending
    }
  }
  // UniDic keeps the volitional as one word (書こう); split off its う to match IPADIC.
  if (form === 'volitional' && rest.length === 0 && head.surface.endsWith('う')) {
    steps.push(stemStep(form, head.surface.slice(0, -1)))
    steps.push(volitionalStep())
  } else if (form) {
    steps.push(...splitContractedBa(head, [stemStep(form, head.surface)]))
  }

  for (let index = 1; index < morphemes.length; index++) {
    const m = morphemes[index]
    const result = suffixSteps(morphemes, index)
    const consumed = result.consumed
    const found = consumed === 0 ? splitContractedBa(m, result.steps) : result.steps
    // UniDic keeps a volitional ending in one morpheme (ましょう, ちゃおう); split off its う to match IPADIC.
    const last = found.at(-1)
    if (
      consumed === 0 &&
      last?.surface === m.surface &&
      last.kind !== 'conjecture' &&
      m.conjugationForm === '意志推量形' &&
      m.surface.endsWith('う')
    ) {
      found.splice(-1, 1, { ...last, surface: m.surface.slice(0, -1) }, volitionalStep())
    }
    if (index === 1 && found[0]) {
      found[0] = { ...found[0], surface: adjectiveEnding + found[0].surface }
    } else if (index === 1 && adjectiveEnding === 'く') {
      steps.push(adverbialStep())
    }
    steps.push(...found)
    index += consumed
  }
  if (rest.length === 0 && adjectiveEnding === 'く') steps.push(adverbialStep())
  // A stem with nothing explained after it (UniDic 行っ before たり) says nothing.
  const onlyStems = steps.every((s) => typeof s.kind === 'object')
  if (onlyStems && !(steps.length === 1 && form === 'imperative')) return []
  return steps
}

// IPADIC lists もらえる and いただける (自立) as verbs; UniDic reads them as potentials of 貰う and 頂く.
const RECEIVING_POTENTIALS: Record<string, string> = {
  もらう: 'もらえる',
  貰う: 'もらえる',
  いただく: 'いただける',
  頂く: 'いただける'
}

function receivingPotential(m: Morpheme): string | undefined {
  if (m.pos !== '動詞') return undefined
  if (m.lemma === 'もらえる' || m.lemma === 'いただける') return m.lemma
  return isPotentialVerb(m) ? RECEIVING_POTENTIALS[m.lemma] : undefined
}

// IPADIC tags ある after a て-form 動詞,自立.
function isTeAuxiliaryMorpheme(m: Morpheme): boolean {
  if (receivingPotential(m)) return true
  return (
    m.pos === '動詞' &&
    (m.pos1 === '非自立' || m.pos1 === '非自立可能' || m.lemma === 'ある') &&
    TE_FORM_AUXILIARY_LEMMAS.has(m.lemma) &&
    !isPotentialVerb(m)
  )
}

const TE_FORM_AUXILIARY_LEMMAS = new Set([
  'いる',
  'おる',
  'しまう',
  'おく',
  '居る',
  '仕舞う',
  '置く',
  ...TE_AUXILIARY_STEPS.flatMap(([lemmas]) => lemmas)
])
const TE_FORM_ENDINGS = new Set(['て', 'で'])

const endsInTeForm = (token: Token): boolean => {
  const last = token.morphemes?.at(-1)
  return last?.pos === '助詞' && last.pos1 === '接続助詞' && TE_FORM_ENDINGS.has(last.surface)
}

const isTeFormAuxiliary = (token: Token): boolean => {
  const head = token.morphemes?.[0]
  return head !== undefined && isTeAuxiliaryMorpheme(head)
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

// Verbs extend across split suffixes too (UniDic 食べたく|ない, 行かなく|ちゃ, 降り|そう).
// UniDic tags 良い and 無い 非自立可能 even standing alone (よかっ|た, なかっ|た).
const startsSuffixedWord = (token: Token): boolean => {
  const head = token.morphemes?.[0]
  if (head?.pos === '形容詞') return true
  // IPADIC tags explanatory ん / の (んじゃない) 名詞,非自立.
  if (token.lemma === 'ん' || token.lemma === 'の') return false
  return ['動詞', '名詞', '形状詞', '代名詞'].includes(token.pos)
}

const isDictionaryFormHead = (token: Token): boolean => isDictionaryForm(token.morphemes?.[0])

/**
 * Whether `steps` cover every kana of `span`. A noun or na-adjective head
 * (学生|だった) and a dictionary-form head (行く|そう|だ) have no stem step.
 */
export function explainsSpan(span: Token[], steps: GrammarStep[]): boolean {
  const explained = steps.map((step) => step.surface).join('')
  const surface = span.map((token) => token.surface).join('')
  if (explained === '') return false
  const head = span[0]
  if (['名詞', '形状詞', '代名詞'].includes(head.pos)) {
    return explained === surface || head.surface + explained === surface
  }
  // A merged token (書くでしょう) starts with its dictionary-form morpheme.
  const bareHead = isDictionaryFormHead(head) ? (head.morphemes?.[0]?.surface ?? '') : ''
  return explained === surface || (bareHead !== '' && bareHead + explained === surface)
}

const explainsSuffixes = (span: Token[]): boolean => explainsSpan(span, spanGrammarChain(span))

/**
 * Extends the popup span across auxiliary verbs after a て-form (読んで|いる) and
 * across the split suffixes of a verb, adjective or copula (高く|なかっ|た, 静か|じゃ|なかっ|た).
 */
export function extendGrammarSpan(cueTokens: Token[], span: Token[]): Token[] {
  const extended = extendTeFormAuxiliaries(cueTokens, span)
  if (!extended[0] || !startsSuffixedWord(extended[0])) return extended

  let index = cueTokens.findIndex((token) => token.startOffset === extended.at(-1)?.startOffset)
  if (index === -1) return extended
  const contiguous = (at: number): boolean =>
    at < cueTokens.length &&
    cueTokens[at].startOffset === cueTokens[at - 1].startOffset + cueTokens[at - 1].surface.length
  // Longest run first: IPADIC splits でしょ|う after an adjective, and both
  // dictionaries split 学生|で|は|なく into lone tokens.
  const runAt = (start: number): Token[] => {
    for (let size = 3; size > 0; size--) {
      const run = cueTokens.slice(start, start + size)
      const joined = run.length === size && run.every((_, i) => contiguous(start + i))
      if (joined && explainsSuffixes([...extended, ...run])) return run
    }
    return []
  }
  while (contiguous(index + 1)) {
    const added = runAt(index + 1)
    if (added.length === 0) break
    extended.push(...added)
    index += added.length
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
export const GRAMMAR_ANALYZER_VERSION = 8

/** Ordered suffix step kinds, stem excluded, e.g. `causative>passive-potential>negative>past`. */
export function grammarPatternKey(steps: GrammarStep[]): string {
  return steps.flatMap((step) => (typeof step.kind === 'string' ? [step.kind] : [])).join('>')
}
