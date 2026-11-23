// Copied verbatim from Yomitan ext/js/language/ja/japanese-transforms.js at
// commit ce1b1bffa0e8819716317f3717932a7fe91e8d52.
// Copyright (C) 2024-2026  Yomitan Authors. GPL-3.0-or-later.

const shimauEnglishDescription =
  '1. Shows a sense of regret/surprise when you did have volition in doing something, but it turned out to be bad to do.\n' +
  '2. Shows perfective/punctual achievement. This shows that an action has been completed.\n' +
  '3. Shows unintentional action–“accidentally”.\n'

const passiveEnglishDescription =
  '1. Indicates an action received from an action performer.\n' +
  '2. Expresses respect for the subject of action performer.\n'

export const YOMITAN_TRANSFORM_DESCRIPTIONS = {
  '-ば':
    "1. Conditional form; shows that the previous stated condition's establishment is the condition for the latter stated condition to occur.\n" +
    '2. Shows a trigger for a latter stated perception or judgment.\n' +
    'Usage: Attach ば to the hypothetical form (仮定形) of verbs and i-adjectives.',
  '-ゃ': 'Contraction of -ば.',
  '-ちゃ':
    'Contraction of ～ては.\n' +
    '1. Explains how something always happens under the condition that it marks.\n' +
    '2. Expresses the repetition (of a series of) actions.\n' +
    "3. Indicates a hypothetical situation in which the speaker gives a (negative) evaluation about the other party's intentions.\n" +
    '4. Used in "Must Not" patterns like ～てはいけない.\n' +
    'Usage: Attach は after the て-form of verbs, contract ては into ちゃ.',
  '-ちゃう':
    'Contraction of -しまう.\n' +
    shimauEnglishDescription +
    'Usage: Attach しまう after the て-form of verbs, contract てしまう into ちゃう.',
  '-ちまう':
    'Contraction of -しまう.\n' +
    shimauEnglishDescription +
    'Usage: Attach しまう after the て-form of verbs, contract てしまう into ちまう.',
  '-なさい':
    'Polite imperative suffix.\n' +
    'Usage: Attach なさい after the continuative form (連用形) of verbs.',
  '-しまう': shimauEnglishDescription + 'Usage: Attach しまう after the て-form of verbs.',
  '-そう':
    'Appearing that; looking like.\n' +
    'Usage: Attach そう to the continuative form (連用形) of verbs, or to the stem of adjectives.',
  '-すぎる':
    'Shows something "is too..." or someone is doing something "too much".\n' +
    'Usage: Attach すぎる to the continuative form (連用形) of verbs, or to the stem of adjectives.',
  '-たい':
    '1. Expresses the feeling of desire or hope.\n' +
    '2. Used in ...たいと思います, an indirect way of saying what the speaker intends to do.\n' +
    'Usage: Attach たい to the continuative form (連用形) of verbs. たい itself conjugates as i-adjective.',
  '-たら':
    '1. Denotes the latter stated event is a continuation of the previous stated event.\n' +
    '2. Assumes that a matter has been completed or concluded.\n' +
    'Usage: Attach たら to the continuative form (連用形) of verbs after euphonic change form, かったら to the stem of i-adjectives.',
  '-て':
    'て-form.\n' +
    'It has a myriad of meanings. Primarily, it is a conjunctive particle that connects two clauses together.\n' +
    'Usage: Attach て to the continuative form (連用形) of verbs after euphonic change form, くて to the stem of i-adjectives.',
  '-たり':
    '1. Shows two actions occurring back and forth (when used with two verbs).\n' +
    '2. Shows examples of actions and states (when used with multiple verbs and adjectives).\n' +
    'Usage: Attach たり to the continuative form (連用形) of verbs after euphonic change form, かったり to the stem of i-adjectives',
  '-ん':
    'Negative form of verbs; a sound change of ぬ.\n' +
    'Usage: Attach ん to the irrealis form (未然形) of verbs.\n' +
    'する becomes せん',
  '-く': 'Adverbial form of i-adjectives.\n',
  '-ず':
    '1. Negative form of verbs.\n' +
    '2. Continuative form (連用形) of the particle ぬ (nu).\n' +
    'Usage: Attach ず to the irrealis form (未然形) of verbs.',
  '-ぬ':
    'Negative form of verbs.\n' +
    'Usage: Attach ぬ to the irrealis form (未然形) of verbs.\n' +
    'する becomes せぬ',
  'short causative':
    'Contraction of the causative form.\n' +
    'Describes the intention to make someone do something.\n' +
    'Usage: Attach す to the irrealis form (未然形) of godan verbs.\n' +
    'Attach さす to the dictionary form (終止形) of ichidan verbs.\n' +
    'する becomes さす, くる becomes こさす.\n' +
    'It itself conjugates as an godan verb.',
  '-がる':
    '1. Shows subject’s feelings contrast with what is thought/known about them.\n' +
    "2. Indicates subject's behavior (stands out).\n" +
    'Usage: Attach がる to the stem of i-adjectives. It itself conjugates as a godan verb.',
  causative:
    'Describes the intention to make someone do something.\n' +
    'Usage: Attach させる to the irrealis form (未然形) of ichidan verbs and くる.\n' +
    'Attach せる to the irrealis form (未然形) of godan verbs and する.\n' +
    'It itself conjugates as an ichidan verb.',
  imperative:
    '1. To give orders.\n' +
    '2. (As あれ) Represents the fact that it will never change no matter the circumstances.\n' +
    '3. Express a feeling of hope.',
  continuative:
    'Used to indicate actions that are (being) carried out.\n' +
    'Refers to 連用形, the part of the verb after conjugating with -ます and dropping ます.',
  negative:
    '1. Negative form of verbs.\n' +
    '2. Expresses a feeling of solicitation to the other party.\n' +
    'Usage: Attach ない to the irrealis form (未然形) of verbs, くない to the stem of i-adjectives. ない itself conjugates as i-adjective. ます becomes ません.',
  '-さ':
    'Nominalizing suffix of i-adjectives indicating nature, state, mind or degree.\n' +
    'Usage: Attach さ to the stem of i-adjectives.',
  passive:
    passiveEnglishDescription + 'Usage: Attach れる to the irrealis form (未然形) of godan verbs.',
  '-た':
    '1. Indicates a reality that has happened in the past.\n' +
    '2. Indicates the completion of an action.\n' +
    '3. Indicates the confirmation of a matter.\n' +
    "4. Indicates the speaker's confidence that the action will definitely be fulfilled.\n" +
    '5. Indicates the events that occur before the main clause are represented as relative past.\n' +
    '6. Indicates a mild imperative/command.\n' +
    'Usage: Attach た to the continuative form (連用形) of verbs after euphonic change form, かった to the stem of i-adjectives.',
  '-ます':
    'Polite conjugation of verbs and adjectives.\n' +
    'Usage: Attach ます to the continuative form (連用形) of verbs.',
  potential:
    'Indicates a state of being (naturally) capable of doing an action.\n' +
    'Usage: Attach (ら)れる to the irrealis form (未然形) of ichidan verbs.\n' +
    'Attach る to the imperative form (命令形) of godan verbs.\n' +
    'する becomes できる, くる becomes こ(ら)れる',
  'potential or passive':
    passiveEnglishDescription +
    '3. Indicates a state of being (naturally) capable of doing an action.\n' +
    'Usage: Attach られる to the irrealis form (未然形) of ichidan verbs.\n' +
    'する becomes せられる, くる becomes こられる',
  volitional:
    "1. Expresses speaker's will or intention.\n" +
    '2. Expresses an invitation to the other party.\n' +
    '3. (Used in …ようとする) Indicates being on the verge of initiating an action or transforming a state.\n' +
    '4. Indicates an inference of a matter.\n' +
    'Usage: Attach よう to the irrealis form (未然形) of ichidan verbs.\n' +
    'Attach う to the irrealis form (未然形) of godan verbs after -o euphonic change form.\n' +
    'Attach かろう to the stem of i-adjectives (4th meaning only).',
  '-おく':
    'To do certain things in advance in preparation (or in anticipation) of latter needs.\n' +
    'Usage: Attach おく to the て-form of verbs.\n' +
    'Attach でおく after ない negative form of verbs.\n' +
    'Contracts to とく・どく in speech.',
  '-いる':
    '1. Indicates an action continues or progresses to a point in time.\n' +
    '2. Indicates an action is completed and remains as is.\n' +
    '3. Indicates a state or condition that can be taken to be the result of undergoing some change.\n' +
    'Usage: Attach いる to the て-form of verbs. い can be dropped in speech.\n' +
    'Attach でいる after ない negative form of verbs.\n' +
    '(Slang) Attach おる to the て-form of verbs. Contracts to とる・でる in speech.'
} as const

export type YomitanTransformName = keyof typeof YOMITAN_TRANSFORM_DESCRIPTIONS
