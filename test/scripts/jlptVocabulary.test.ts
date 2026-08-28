import { describe, expect, it } from 'vitest'

import {
  createVocabularySnapshot,
  deduplicateAndSortEntries,
  parseVocabularyFile,
  projectVocabularyRecords,
  serializeVocabularySnapshot
} from '@scripts/jlptVocabulary.mjs'

type VocabularyEntry = import('@scripts/jlptVocabulary.mjs').VocabularyEntry

const record = (word: string, reading: string, level = 'N5') => ({
  word,
  reading,
  level,
  meanings: ['ignored'],
  examples: [{ ja: 'ignored', en: 'ignored' }]
})

describe('projectVocabularyRecords', () => {
  it('projects valid records to expression, reading, and level tuples', () => {
    expect(projectVocabularyRecords([record(' 猫 ', ' ねこ ')], 'N5')).toEqual([
      ['猫', 'ねこ', 'N5']
    ])
  })

  it('normalizes Unicode to NFC and trims surrounding whitespace', () => {
    expect(projectVocabularyRecords([record(' は\u3099 ', ' か\u3099 ')], 'N5')).toEqual([
      ['ば', 'が', 'N5']
    ])
  })

  it.each([
    [null, 'must be an object'],
    [{ word: 1, reading: '', level: 'N5' }, 'no string word'],
    [{ word: ' ', reading: '', level: 'N5' }, 'empty word'],
    [{ word: '猫', reading: null, level: 'N5' }, 'no string reading'],
    [{ word: '猫', reading: ' ', level: 'N5' }, 'whitespace-only reading'],
    [{ word: '猫', reading: '', level: 'N4' }, 'expected N5']
  ])('rejects malformed or mismatched record %j', (invalid, message) => {
    expect(() => projectVocabularyRecords([invalid], 'N5', 'n5.json')).toThrow(message)
  })

  it('rejects a non-array JSON file', () => {
    expect(() => parseVocabularyFile('{}', 'N5', 'n5.json')).toThrow(
      'n5.json must contain an array of records'
    )
  })
})

describe('deduplicateAndSortEntries', () => {
  it('deduplicates exact triples while preserving readings and levels', () => {
    expect(
      deduplicateAndSortEntries([
        ['猫', 'ねこ', 'N3'],
        ['猫', 'ねこ', 'N3'],
        ['猫', 'ネコ', 'N3'],
        ['猫', 'ねこ', 'N5']
      ])
    ).toEqual([
      ['猫', 'ねこ', 'N5'],
      ['猫', 'ねこ', 'N3'],
      ['猫', 'ネコ', 'N3']
    ])
  })

  it('sorts independently of input order', () => {
    const entries: VocabularyEntry[] = [
      ['犬', '', 'N4'],
      ['猫', '', 'N5'],
      ['猫', '', 'N1'],
      ['あ', '', 'N3']
    ]
    expect(deduplicateAndSortEntries([...entries])).toEqual(
      deduplicateAndSortEntries([...entries].reverse())
    )
  })
})

describe('createVocabularySnapshot', () => {
  it('keeps only the compact tuple fields in generated output', () => {
    const snapshot = createVocabularySnapshot([
      { level: 'N5', contents: JSON.stringify([record('猫', 'ねこ')]) }
    ])

    expect(snapshot).toEqual({
      schemaVersion: 1,
      source: {
        name: 'OpenJLPT',
        version: '0.2.0',
        commit: 'c42fd9fa3777bfc1775446f7c418d549dfd6e4cf',
        license: 'CC-BY-SA-4.0'
      },
      inputRecordCount: 1,
      entries: [['猫', 'ねこ', 'N5']]
    })
    expect(serializeVocabularySnapshot(snapshot)).not.toContain('meanings')
    expect(serializeVocabularySnapshot(snapshot)).not.toContain('examples')
  })

  it('produces the same snapshot for the same inputs in any file order', () => {
    const files = [
      { level: 'N5', contents: JSON.stringify([record('猫', 'ねこ')]) },
      { level: 'N4', contents: JSON.stringify([record('犬', 'いぬ', 'N4')]) }
    ] as const
    expect(createVocabularySnapshot([...files])).toEqual(
      createVocabularySnapshot([...files].reverse())
    )
  })
})
