import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { unzipSync } from 'fflate'
import {
  parseIndex,
  parseTermBank,
  parseTermMetaBank,
  parseKanjiBank,
  countTermBank,
  countKanjiBank
} from '@src/main/services/dict/yomitanImport'
import { FIXTURES_DIR as FIXTURES } from '@test/paths'

describe('parseIndex', () => {
  it('parses the real index.json extracted from the yomitan-sample.zip fixture', () => {
    const zipBytes = readFileSync(path.join(FIXTURES, 'yomitan-sample.zip'))
    const entries = unzipSync(new Uint8Array(zipBytes))
    const indexJson = JSON.parse(new TextDecoder().decode(entries['index.json']))

    expect(indexJson).toEqual({
      title: 'yomitan-sample',
      format: 3,
      revision: 'jmdict4',
      sequenced: true
    })

    expect(parseIndex(indexJson)).toEqual({
      title: 'yomitan-sample',
      revision: 'jmdict4',
      format: 3,
      frequencyMode: 'rank-based'
    })
  })

  it('falls back to legacy `version` field when `format` is absent', () => {
    expect(parseIndex({ title: 'legacy', revision: 'r1', version: 2 })).toEqual({
      title: 'legacy',
      revision: 'r1',
      format: 2,
      frequencyMode: 'rank-based'
    })
  })

  it('reads an explicit occurrence-based `frequencyMode`', () => {
    expect(
      parseIndex({
        title: 'freq-dict',
        revision: 'r1',
        format: 3,
        frequencyMode: 'occurrence-based'
      })
    ).toMatchObject({ frequencyMode: 'occurrence-based' })
  })

  it('defaults to rank-based for an unrecognized `frequencyMode` value', () => {
    expect(
      parseIndex({ title: 'freq-dict', revision: 'r1', format: 3, frequencyMode: 'bogus' })
    ).toMatchObject({ frequencyMode: 'rank-based' })
  })
})

describe('parseTermBank', () => {
  it('parses the real term_bank_1.json fixture into TermRows', () => {
    const raw = readFileSync(path.join(FIXTURES, 'term_bank_1.json'), 'utf-8')
    const json = JSON.parse(raw)
    const rows = parseTermBank(json)

    expect(rows).toHaveLength(6)

    expect(rows[0]).toEqual({
      expression: '猫',
      reading: 'ねこ',
      termTags: '',
      defTags: 'n',
      rules: '',
      score: 1,
      glossary: 'cat',
      glossaryJson: '["cat"]',
      sequence: 1000200
    })

    expect(rows[2]).toEqual({
      expression: '食べる',
      reading: 'たべる',
      termTags: '',
      defTags: 'v1 vt',
      rules: 'v1',
      score: 1,
      glossary: 'to eat',
      glossaryJson: '["to eat"]',
      sequence: 1000220
    })

    // multi-gloss entry joins the glossary array into one text field, one sense per line
    expect(rows[4]).toEqual({
      expression: 'を',
      reading: 'を',
      termTags: '',
      defTags: 'prt',
      rules: '',
      score: 1,
      glossary:
        'indicates direct object of action\nindicates the area through which motion occurs\nindicates the point of departure',
      glossaryJson: JSON.stringify([
        'indicates direct object of action',
        'indicates the area through which motion occurs',
        'indicates the point of departure'
      ]),
      sequence: 1000240
    })
  })

  it('tolerates malformed entries (wrong-length tuple, non-array) alongside good ones', () => {
    const good = ['犬', 'いぬ', '', '', 1, ['dog'], 1000300, '']
    const badShort = ['短い', 'みじかい']
    const badNotArray = { not: 'an array' }
    const badStructuredGlossary = [
      '構造',
      'こうぞう',
      '',
      '',
      1,
      [{ type: 'text', text: 'structure' }],
      1000310,
      ''
    ]
    const badDefTags = ['非文字', 'ひもじ', 42, '', 1, ['bad'], 1000320, '']

    const rows = parseTermBank([good, badShort, badNotArray, badStructuredGlossary, badDefTags])

    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({
      expression: '犬',
      reading: 'いぬ',
      termTags: '',
      defTags: '',
      rules: '',
      score: 1,
      glossary: 'dog',
      glossaryJson: '["dog"]',
      sequence: 1000300
    })
    expect(rows[1].glossary).toBe('structure')
    expect(rows[1].glossaryJson).toBe(JSON.stringify([{ type: 'text', text: 'structure' }]))
  })

  it('returns an empty array for non-array input', () => {
    expect(parseTermBank(null)).toEqual([])
    expect(parseTermBank({ nope: true })).toEqual([])
  })
})

describe('parseTermMetaBank', () => {
  it('parses a bare-number frequency value', () => {
    const rows = parseTermMetaBank([['猫', 'freq', 1234]])
    expect(rows).toEqual([
      {
        expression: '猫',
        reading: null,
        mode: 'freq',
        value: 1234,
        display: '1234',
        pitchPositions: null
      }
    ])
  })

  it('parses a numeric-string frequency value', () => {
    const rows = parseTermMetaBank([['猫', 'freq', '1234']])
    expect(rows).toEqual([
      {
        expression: '猫',
        reading: null,
        mode: 'freq',
        value: 1234,
        display: '1234',
        pitchPositions: null
      }
    ])
  })

  it('parses a { value, displayValue } object', () => {
    const rows = parseTermMetaBank([['猫', 'freq', { value: 57, displayValue: '57㋕' }]])
    expect(rows).toEqual([
      {
        expression: '猫',
        reading: null,
        mode: 'freq',
        value: 57,
        display: '57㋕',
        pitchPositions: null
      }
    ])

    const withoutDisplay = parseTermMetaBank([['猫', 'freq', { value: 57 }]])
    expect(withoutDisplay).toEqual([
      {
        expression: '猫',
        reading: null,
        mode: 'freq',
        value: 57,
        display: '57',
        pitchPositions: null
      }
    ])
  })

  it('parses a { reading, frequency } object with a bare-number frequency', () => {
    const rows = parseTermMetaBank([['猫', 'freq', { reading: 'ねこ', frequency: 42 }]])
    expect(rows).toEqual([
      {
        expression: '猫',
        reading: 'ねこ',
        mode: 'freq',
        value: 42,
        display: '42',
        pitchPositions: null
      }
    ])
  })

  it('parses a { reading, frequency } object with a nested { value, displayValue } frequency', () => {
    const rows = parseTermMetaBank([
      ['猫', 'freq', { reading: 'ねこ', frequency: { value: 42, displayValue: '42㋕' } }]
    ])
    expect(rows).toEqual([
      {
        expression: '猫',
        reading: 'ねこ',
        mode: 'freq',
        value: 42,
        display: '42㋕',
        pitchPositions: null
      }
    ])
  })

  it('parses a pitch entry with a single position, retaining its reading', () => {
    const rows = parseTermMetaBank([
      ['猫', 'pitch', { reading: 'ねこ', pitches: [{ position: 1 }] }]
    ])
    expect(rows).toEqual([
      {
        expression: '猫',
        reading: 'ねこ',
        mode: 'pitch',
        value: null,
        display: null,
        pitchPositions: [1]
      }
    ])
  })

  it('parses a pitch entry with several positions, keeping source order', () => {
    const rows = parseTermMetaBank([
      [
        '端',
        'pitch',
        { reading: 'はし', pitches: [{ position: 2, tags: ['名'] }, { position: 0 }] }
      ]
    ])
    expect(rows[0].pitchPositions).toEqual([2, 0])
  })

  it('de-duplicates repeated pitch positions', () => {
    const rows = parseTermMetaBank([
      ['橋', 'pitch', { reading: 'はし', pitches: [{ position: 2 }, { position: 2 }] }]
    ])
    expect(rows[0].pitchPositions).toEqual([2])
  })

  it('accepts a heiban (position 0) pitch', () => {
    const rows = parseTermMetaBank([
      ['言葉', 'pitch', { reading: 'ことば', pitches: [{ position: 0 }] }]
    ])
    expect(rows[0].pitchPositions).toEqual([0])
  })

  it('drops individual pitches that are not objects with a non-negative integer position', () => {
    const rows = parseTermMetaBank([
      [
        '猫',
        'pitch',
        {
          reading: 'ねこ',
          pitches: [
            { position: -1 },
            { position: 1.5 },
            { position: '1' },
            { devoice: [0] },
            null,
            'nope',
            { position: 1 }
          ]
        }
      ]
    ])
    expect(rows[0].pitchPositions).toEqual([1])
  })

  it('skips malformed pitch entries: no reading, no pitches, or no usable position', () => {
    const rows = parseTermMetaBank([
      ['猫', 'pitch', { pitches: [{ position: 1 }] }],
      ['猫', 'pitch', { reading: '', pitches: [{ position: 1 }] }],
      ['猫', 'pitch', { reading: 'ねこ' }],
      ['猫', 'pitch', { reading: 'ねこ', pitches: 'nope' }],
      ['猫', 'pitch', { reading: 'ねこ', pitches: [] }],
      ['猫', 'pitch', { reading: 'ねこ', pitches: [{ position: -2 }] }],
      ['猫', 'pitch', null],
      ['猫', 'pitch', 3]
    ])
    expect(rows).toEqual([])
  })

  it('skips modes that are neither freq nor pitch', () => {
    expect(parseTermMetaBank([['猫', 'ipa', { reading: 'ねこ', transcriptions: [] }]])).toEqual([])
  })

  it('skips malformed entries: wrong-length tuple, non-string expression, unparseable data', () => {
    const rows = parseTermMetaBank([
      ['短い'],
      [42, 'freq', 1],
      ['犬', 'freq', 'not-a-number'],
      ['犬', 'freq', {}],
      ['犬', 'freq', { reading: 'いぬ' }],
      ['犬', 'freq', { reading: 'いぬ', frequency: 'nope' }],
      ['犬', 'freq', null],
      'not-an-array'
    ])
    expect(rows).toEqual([])
  })

  it('returns an empty array for non-array input', () => {
    expect(parseTermMetaBank(null)).toEqual([])
    expect(parseTermMetaBank({ nope: true })).toEqual([])
  })
})

describe('parseKanjiBank', () => {
  // A real KANJIDIC_english entry, trimmed to the fields the importer reads.
  const KANJIDIC_ENTRY = [
    '亜',
    'ア',
    'つ.ぐ',
    'jouyou',
    ['Asia', 'rank next', 'come after', '-ous'],
    { grade: '8', strokes: '7', jlpt: '1' }
  ]

  it('maps a kanji entry onto a term row with its readings as the first glossary line', () => {
    expect(parseKanjiBank([KANJIDIC_ENTRY])).toEqual([
      {
        expression: '亜',
        reading: '',
        termTags: 'jouyou',
        defTags: '',
        rules: '',
        score: 0,
        glossary: '音: ア　訓: つ.ぐ\nAsia\nrank next\ncome after\n-ous',
        glossaryJson: JSON.stringify([
          '音: ア　訓: つ.ぐ',
          'Asia',
          'rank next',
          'come after',
          '-ous'
        ]),
        sequence: 0
      }
    ])
  })

  it('omits the reading line entirely when a kanji has neither on nor kun readings', () => {
    const rows = parseKanjiBank([['々', '', '', '', ['repetition mark'], {}]])
    expect(rows).toHaveLength(1)
    expect(rows[0].glossary).toBe('repetition mark')
    expect(JSON.parse(rows[0].glossaryJson)).toEqual(['repetition mark'])
  })

  it('keeps a kanji that has readings but no meanings', () => {
    const rows = parseKanjiBank([['唖', 'ア アク', 'おし', '', [], {}]])
    expect(rows).toHaveLength(1)
    expect(rows[0].glossary).toBe('音: ア アク　訓: おし')
  })

  it('skips malformed entries: wrong length, empty character, wrong field types', () => {
    expect(
      parseKanjiBank([
        ['亜', 'ア', 'つ.ぐ', 'jouyou', ['Asia']],
        ['', 'ア', 'つ.ぐ', 'jouyou', ['Asia'], {}],
        [42, 'ア', 'つ.ぐ', 'jouyou', ['Asia'], {}],
        ['亜', 1, 'つ.ぐ', 'jouyou', ['Asia'], {}],
        ['亜', 'ア', 'つ.ぐ', 5, ['Asia'], {}],
        ['亜', 'ア', 'つ.ぐ', 'jouyou', 'not-an-array', {}],
        ['亜', '', '', 'jouyou', [], {}],
        'not-an-array'
      ])
    ).toEqual([])
  })

  it('returns an empty array for non-array input', () => {
    expect(parseKanjiBank(null)).toEqual([])
    expect(parseKanjiBank({ nope: true })).toEqual([])
  })
})

describe('countTermBank / countKanjiBank', () => {
  // The import counts rows in one pass and builds them in another; if the two
  // ever disagreed, banks would be handed overlapping id ranges.
  it('countTermBank agrees with parseTermBank across valid and malformed entries', () => {
    const bank = [
      ['犬', 'いぬ', '', '', 1, ['dog'], 1, ''],
      ['猫', 'ねこ', '', '', 1, ['cat'], 2, ''],
      ['短い'],
      [42, 'ねこ', '', '', 1, ['cat'], 2, ''],
      ['鳥', 'とり', '', '', 'not-a-number', ['bird'], 3, ''],
      'not-an-array'
    ]
    expect(countTermBank(bank)).toBe(parseTermBank(bank).length)
    expect(countTermBank(bank)).toBe(2)
  })

  it('countKanjiBank agrees with parseKanjiBank across valid and malformed entries', () => {
    const bank = [
      ['亜', 'ア', 'つ.ぐ', 'jouyou', ['Asia'], {}],
      ['々', '', '', '', ['repetition mark'], {}],
      ['', 'ア', '', '', ['nope'], {}],
      ['亜', '', '', 'jouyou', [], {}],
      'not-an-array'
    ]
    expect(countKanjiBank(bank)).toBe(parseKanjiBank(bank).length)
    expect(countKanjiBank(bank)).toBe(2)
  })

  it('both return 0 for non-array input', () => {
    expect(countTermBank(null)).toBe(0)
    expect(countKanjiBank({ nope: true })).toBe(0)
  })
})
