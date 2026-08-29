import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  createKanjiSnapshot,
  deduplicateAndSortEntries,
  parseKanjiFile,
  projectKanjiRecords,
  serializeKanjiSnapshot
} from '@scripts/jlptKanji.mjs'
import { INPUTS, updateKanji } from '@scripts/update-jlpt-kanji.mjs'

type KanjiEntry = import('@scripts/jlptKanji.mjs').KanjiEntry

const record = (character: string, level = 'N5', freq: number | null | undefined = 1) => ({
  character,
  level,
  freq,
  meanings: ['ignored'],
  strokes: 1
})

describe('projectKanjiRecords', () => {
  it('projects valid records to character, level, and nullable frequency', () => {
    expect(projectKanjiRecords([record(' 日 ', 'N5', 1)], 'N5')).toEqual([['日', 'N5', 1]])
    expect(projectKanjiRecords([record('雨', 'N5', null)], 'N5')).toEqual([['雨', 'N5', null]])
    expect(projectKanjiRecords([{ character: '山', level: 'N5' }], 'N5')).toEqual([
      ['山', 'N5', null]
    ])
  })

  it('normalizes Unicode and rejects empty or multi-character expressions', () => {
    expect(projectKanjiRecords([record(' は\u3099 ', 'N5', 1)], 'N5')).toEqual([['ば', 'N5', 1]])
    expect(() => projectKanjiRecords([record(' ', 'N5', 1)], 'N5')).toThrow('empty character')
    expect(() => projectKanjiRecords([record('日本', 'N5', 1)], 'N5')).toThrow('one character')
  })

  it.each([
    [null, 'must be an object'],
    [{ character: 1, level: 'N5', freq: 1 }, 'no string character'],
    [{ character: '日', level: 'N4', freq: 1 }, 'expected N5'],
    [{ character: '日', level: 'N5', freq: '1' }, 'invalid frequency'],
    [{ character: '日', level: 'N5', freq: 0 }, 'invalid frequency'],
    [{ character: '日', level: 'N5', freq: 1.5 }, 'invalid frequency']
  ])('rejects malformed records %j', (invalid, message) => {
    expect(() => projectKanjiRecords([invalid], 'N5', 'n5.json')).toThrow(message)
  })

  it('rejects a non-array JSON file', () => {
    expect(() => parseKanjiFile('{}', 'N5', 'n5.json')).toThrow(
      'n5.json must contain an array of records'
    )
  })
})

describe('deduplicateAndSortEntries', () => {
  it('keeps the easiest level and first non-null frequency', () => {
    expect(
      deduplicateAndSortEntries([
        ['猫', 'N3', null],
        ['猫', 'N5', 42],
        ['猫', 'N5', null],
        ['犬', 'N4', null]
      ])
    ).toEqual([
      ['犬', 'N4', null],
      ['猫', 'N5', 42]
    ])
  })

  it('rejects conflicting non-null ranks', () => {
    expect(() =>
      deduplicateAndSortEntries([
        ['日', 'N5', 1],
        ['日', 'N4', 2]
      ])
    ).toThrow('Conflicting frequency ranks')
  })

  it('sorts independently of input order', () => {
    const entries: KanjiEntry[] = [
      ['犬', 'N4', 5],
      ['猫', 'N5', null],
      ['あ', 'N3', 10]
    ]
    expect(deduplicateAndSortEntries([...entries])).toEqual(
      deduplicateAndSortEntries([...entries].reverse())
    )
  })
})

describe('createKanjiSnapshot', () => {
  it('keeps only compact tuple fields in generated output', () => {
    const snapshot = createKanjiSnapshot([
      { level: 'N5', contents: JSON.stringify([record('日', 'N5', 1)]) }
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
      entries: [['日', 'N5', 1]]
    })
    const serialized = serializeKanjiSnapshot(snapshot)
    expect(serialized).not.toContain('meanings')
    expect(serialized).not.toContain('strokes')
  })

  it('produces the same snapshot for the same inputs in any file order', () => {
    const files = [
      { level: 'N5', contents: JSON.stringify([record('日', 'N5', 1)]) },
      { level: 'N4', contents: JSON.stringify([record('犬', 'N4', 5)]) }
    ] as const
    expect(createKanjiSnapshot([...files])).toEqual(createKanjiSnapshot([...files].reverse()))
  })
})

describe('updateKanji', () => {
  it('fails on an upstream hash mismatch before writing a snapshot', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kizuna-jlpt-kanji-'))
    try {
      const outputPath = join(root, 'kanji.json')
      await expect(
        updateKanji({
          outputPath,
          fetchImpl: async () => new Response('[]')
        })
      ).rejects.toThrow(`hash mismatch for ${INPUTS[0].path}`)
      await expect(readFile(outputPath)).rejects.toThrow()
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
