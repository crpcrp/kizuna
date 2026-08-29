import { describe, expect, it } from 'vitest'

import { buildJlptKanjiInventory, type JlptKanjiSnapshot } from '@src/main/services/jlpt/kanji'

const snapshot = (entries: unknown[], overrides: Record<string, unknown> = {}): JlptKanjiSnapshot =>
  ({
    schemaVersion: 1,
    source: {
      name: 'OpenJLPT',
      version: '0.2.0',
      commit: 'c42fd9fa3777bfc1775446f7c418d549dfd6e4cf',
      license: 'CC-BY-SA-4.0'
    },
    inputRecordCount: entries.length,
    entries,
    ...overrides
  }) as JlptKanjiSnapshot

describe('buildJlptKanjiInventory', () => {
  it('normalizes, deduplicates, and sorts characters', () => {
    expect(
      buildJlptKanjiInventory(
        snapshot([
          ['猫', 'N3', null],
          [' は\u3099 ', 'N5', 10],
          ['猫', 'N5', 10]
        ])
      )
    ).toEqual({
      entries: [
        { character: 'ば', level: 'N5', frequency: 10 },
        { character: '猫', level: 'N5', frequency: 10 }
      ]
    })
  })

  it('keeps a later non-null rank and rejects conflicting ranks', () => {
    expect(
      buildJlptKanjiInventory(
        snapshot([
          ['日', 'N5', null],
          ['日', 'N4', 1]
        ])
      ).entries
    ).toEqual([{ character: '日', level: 'N5', frequency: 1 }])
    expect(() =>
      buildJlptKanjiInventory(
        snapshot([
          ['日', 'N5', 1],
          ['日', 'N4', 2]
        ])
      )
    ).toThrow('Conflicting frequency ranks')
  })

  it.each([
    [{ schemaVersion: 2 }, 'Invalid JLPT kanji snapshot'],
    [{ source: null }, 'Invalid JLPT kanji snapshot metadata'],
    [{ entries: [['日', 'N5']] }, 'Invalid JLPT kanji entry'],
    [{ entries: [['日', 'N6', 1]] }, 'Invalid JLPT kanji entry'],
    [{ entries: [['日', 'N5', 0]] }, 'Invalid JLPT kanji entry'],
    [{ entries: [['日', 'N5', 1.5]] }, 'Invalid JLPT kanji entry'],
    [{ entries: [['', 'N5', 1]] }, 'Invalid JLPT kanji character'],
    [{ entries: [['日本', 'N5', 1]] }, 'Invalid JLPT kanji character']
  ])('rejects corrupt snapshot data %j', (overrides, message) => {
    expect(() => buildJlptKanjiInventory(snapshot([['日', 'N5', 1]], overrides))).toThrow(message)
  })
})
