import { describe, expect, it } from 'vitest'
import { JLPT_LEVELS, type JlptLevel } from '@src/shared/jlpt'
import type { KnowledgeDetails, KnowledgeLevel } from '@src/shared/knowledge'
import type { CoverageSlice } from '@src/shared/jlptCoverage'
import type { JlptVocabularySnapshot } from '@src/main/services/jlpt/classifier'
import {
  aggregateJlptCoverage,
  buildJlptCoverageInventory,
  type JlptCoverageInventory
} from '@src/main/services/jlpt/coverage'
import { masteredCount, percent, studiedCount } from '@src/shared/jlptCoverage'

const SOURCE = {
  name: 'OpenJLPT',
  version: 'test-version',
  commit: 'snapshot-test',
  license: 'CC-BY-SA-4.0'
}

function snapshot(entries: Array<[string, string, JlptLevel]>): JlptVocabularySnapshot {
  return { schemaVersion: 1, source: SOURCE, inputRecordCount: entries.length, entries }
}

function details(
  level: KnowledgeLevel,
  sourceKinds: KnowledgeDetails['sourceKinds']
): KnowledgeDetails {
  return { level, sourceKinds, sources: [] }
}

function expectSliceInvariant(slice: CoverageSlice): void {
  expect(Object.values(slice.buckets).reduce((sum, count) => sum + count, 0)).toBe(slice.total)
  expect(Object.values(slice.provenance).reduce((sum, count) => sum + count, 0)).toBe(
    slice.total - slice.buckets.unknown
  )
}

describe('buildJlptCoverageInventory', () => {
  it('normalizes expressions, ignores readings, and keeps the easiest conflicting level', () => {
    const inventory = buildJlptCoverageInventory(
      snapshot([
        [' 猫 ', 'ネコ', 'N5'],
        ['猫', 'ねこ', 'N4'],
        ['猫', '別の読み', 'N4'],
        ['ばら', 'ばら', 'N2'],
        ['ばら', 'バラ', 'N1'],
        ['犬', 'いぬ', 'N2'],
        ['', '', 'N5']
      ])
    )

    expect(inventory.entries).toEqual([
      { expression: 'ばら', level: 'N2' },
      { expression: '犬', level: 'N2' },
      { expression: '猫', level: 'N5' }
    ])
    expect(inventory.dataset).toEqual({
      name: 'OpenJLPT',
      version: 'test-version',
      snapshotId: 'snapshot-test',
      license: 'CC-BY-SA-4.0',
      licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
      attribution:
        "OpenJLPT contributors; level classifications derived from Jonathan Waller's JLPT Resources.",
      rawRecordCount: 7,
      deduplicatedExpressionCount: 3,
      duplicateCount: 3,
      conflictCount: 2
    })
  })

  it('is independent of source row order', () => {
    const entries = [
      ['水', 'みず', 'N4'],
      ['猫', 'ねこ', 'N5'],
      ['水', 'みず', 'N3']
    ] satisfies Array<[string, string, JlptLevel]>

    expect(buildJlptCoverageInventory(snapshot([...entries].reverse()))).toEqual(
      buildJlptCoverageInventory(snapshot(entries))
    )
  })

  it('rejects incompatible schemas and non-tuple entries', () => {
    expect(() => buildJlptCoverageInventory({ ...snapshot([]), schemaVersion: 2 })).toThrow(
      'Invalid JLPT vocabulary snapshot'
    )
    expect(() =>
      buildJlptCoverageInventory({
        ...snapshot([]),
        entries: [
          ['猫', 'ねこ', 'N5', 'unexpected']
        ] as unknown as JlptVocabularySnapshot['entries']
      })
    ).toThrow('Invalid JLPT vocabulary entry at index 0')
  })
})

describe('aggregateJlptCoverage', () => {
  const inventory: JlptCoverageInventory = buildJlptCoverageInventory(
    snapshot([
      ['猫', 'ねこ', 'N5'],
      ['犬', 'いぬ', 'N5'],
      ['本', 'ほん', 'N4'],
      ['水', 'みず', 'N3'],
      ['空', 'そら', 'N3'],
      ['山', 'やま', 'N2'],
      ['森', 'もり', 'N1']
    ])
  )

  const inventoryDetails: Record<string, KnowledgeDetails> = {
    猫: details('known', ['wanikani']),
    犬: details('wellKnown', ['anki']),
    本: details('learning', ['wanikani', 'anki']),
    水: details('inDeck', ['anki']),
    山: details('known', ['wanikani', 'anki']),
    森: details('wellKnown', ['wanikani'])
  }

  it('builds disjoint bands, cumulative slices, provenance, and unclassified counts', () => {
    const report = aggregateJlptCoverage({
      inventory,
      inventoryDetails,
      trackedDetails: {
        ' 未分類 ': details('learning', ['anki']),
        未分類: details('known', ['wanikani']),
        別: details('inDeck', ['wanikani']),
        猫: details('known', ['wanikani'])
      },
      generatedAt: '2026-08-29T09:00:00.000Z'
    })

    expect(report.bands.N5).toEqual({
      total: 2,
      buckets: { unknown: 0, inDeck: 0, learning: 0, known: 1, wellKnown: 1 },
      provenance: { wanikaniOnly: 1, ankiOnly: 1, both: 0 }
    })
    expect(report.bands.N3).toEqual({
      total: 2,
      buckets: { unknown: 1, inDeck: 1, learning: 0, known: 0, wellKnown: 0 },
      provenance: { wanikaniOnly: 0, ankiOnly: 1, both: 0 }
    })
    expect(report.throughLevels.N3).toEqual({
      total: 5,
      buckets: { unknown: 1, inDeck: 1, learning: 1, known: 1, wellKnown: 1 },
      provenance: { wanikaniOnly: 1, ankiOnly: 2, both: 1 }
    })
    expect(report.unclassifiedByDataset).toEqual({
      total: 2,
      buckets: { unknown: 0, inDeck: 1, learning: 0, known: 1, wellKnown: 0 },
      provenance: { wanikaniOnly: 1, ankiOnly: 0, both: 1 }
    })
    expect(report.dataset).toBe(inventory.dataset)
    expect(report.generatedAt).toBe('2026-08-29T09:00:00.000Z')

    for (const slice of [
      ...Object.values(report.bands),
      ...Object.values(report.throughLevels),
      report.unclassifiedByDataset
    ]) {
      expectSliceInvariant(slice)
    }

    expect(Object.values(report.bands).reduce((sum, band) => sum + band.total, 0)).toBe(
      inventory.dataset.deduplicatedExpressionCount
    )
    expect(report.throughLevels.N5).toEqual(report.bands.N5)
    expect(report.throughLevels.N4.total).toBe(3)
    expect(report.throughLevels.N3.total).toBe(5)
    expect(report.throughLevels.N2.total).toBe(6)
    expect(report.throughLevels.N1.total).toBe(7)
  })

  it('returns all five empty bands and cumulative slices for an empty inventory', () => {
    const emptyInventory = buildJlptCoverageInventory(snapshot([]))
    const report = aggregateJlptCoverage({
      inventory: emptyInventory,
      inventoryDetails: {},
      trackedDetails: {},
      generatedAt: 'now'
    })

    for (const level of JLPT_LEVELS) {
      expect(report.bands[level]).toEqual({
        total: 0,
        buckets: { unknown: 0, inDeck: 0, learning: 0, known: 0, wellKnown: 0 },
        provenance: { wanikaniOnly: 0, ankiOnly: 0, both: 0 }
      })
      expect(report.throughLevels[level]).toEqual(report.bands[level])
    }
  })
})

describe('JLPT coverage helpers', () => {
  it('keeps queued out of mastered and studied counts and does not round percentages', () => {
    const buckets = { unknown: 1, inDeck: 2, learning: 3, known: 4, wellKnown: 5 }

    expect(masteredCount(buckets)).toBe(9)
    expect(studiedCount(buckets)).toBe(12)
    expect(percent(0, 0)).toBe(0)
    expect(percent(1, 3)).toBeCloseTo(33.33333333333333, 12)
    expect(percent(1, 3)).not.toBe(33.3)
  })
})
