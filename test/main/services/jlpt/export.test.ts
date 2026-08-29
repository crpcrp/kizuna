import { describe, expect, it } from 'vitest'
import { buildJlptExportItems } from '@src/main/services/jlpt/export'
import { buildJlptKanjiInventory, type JlptKanjiInventory } from '@src/main/services/jlpt/kanji'
import { buildJlptVocabularyInventory } from '@src/main/services/jlpt/vocabularyInventory'
import type { JlptVocabularySnapshot } from '@src/main/services/jlpt/classifier'
import type { JlptLevel } from '@src/shared/jlpt'
import type { KnowledgeDetails, KnowledgeLevel } from '@src/shared/knowledge'

const SOURCE = {
  name: 'OpenJLPT',
  version: 'test-version',
  commit: 'snapshot-test',
  license: 'CC-BY-SA-4.0'
}

function vocabularySnapshot(entries: Array<[string, string, JlptLevel]>): JlptVocabularySnapshot {
  return { schemaVersion: 1, source: SOURCE, inputRecordCount: entries.length, entries }
}

function details(level: KnowledgeLevel): KnowledgeDetails {
  return { level, sourceKinds: [], sources: [] }
}

function inventories(): {
  vocabulary: ReturnType<typeof buildJlptVocabularyInventory>
  kanji: JlptKanjiInventory
} {
  return {
    vocabulary: buildJlptVocabularyInventory(
      vocabularySnapshot([
        ['木', 'き', 'N5'],
        ['猫', 'ねこ', 'N4'],
        ['空', 'そら', 'N3'],
        ['犬', 'いぬ', 'N3'],
        ['山', 'やま', 'N2']
      ])
    ),
    kanji: buildJlptKanjiInventory({
      schemaVersion: 1,
      source: SOURCE,
      inputRecordCount: 4,
      entries: [
        ['火', 'N5', 7],
        ['字', 'N4', null],
        ['空', 'N3', 11],
        ['山', 'N2', 13]
      ]
    })
  }
}

describe('buildJlptExportItems', () => {
  it('includes unknown and absent details through the target and filters every other bucket', () => {
    const { vocabulary, kanji } = inventories()
    const result = buildJlptExportItems({
      request: { throughLevel: 'N3', mode: 'both' },
      vocabulary,
      kanji,
      details: {
        木: details('inDeck'),
        猫: details('unknown'),
        火: details('learning'),
        字: details('known'),
        空: details('wellKnown')
      }
    })

    expect(result).toEqual([
      {
        id: 'vocabulary:猫',
        kind: 'vocabulary',
        expression: '猫',
        reading: 'ねこ',
        level: 'N4',
        frequency: null
      },
      {
        id: 'vocabulary:犬',
        kind: 'vocabulary',
        expression: '犬',
        reading: 'いぬ',
        level: 'N3',
        frequency: null
      }
    ])
  })

  it('keeps vocabulary on cross-kind collisions and preserves mode-specific fields', () => {
    const { vocabulary, kanji } = inventories()
    const detailsByLemma = {
      木: details('unknown'),
      猫: details('known'),
      犬: details('known'),
      火: details('unknown'),
      字: details('unknown'),
      空: details('unknown')
    }

    expect(
      buildJlptExportItems({
        request: { throughLevel: 'N3', mode: 'both' },
        vocabulary,
        kanji,
        details: detailsByLemma
      })
    ).toEqual([
      {
        id: 'kanji:火',
        kind: 'kanji',
        expression: '火',
        reading: '',
        level: 'N5',
        frequency: 7
      },
      {
        id: 'kanji:字',
        kind: 'kanji',
        expression: '字',
        reading: '',
        level: 'N4',
        frequency: null
      },
      {
        id: 'vocabulary:木',
        kind: 'vocabulary',
        expression: '木',
        reading: 'き',
        level: 'N5',
        frequency: null
      },
      {
        id: 'vocabulary:空',
        kind: 'vocabulary',
        expression: '空',
        reading: 'そら',
        level: 'N3',
        frequency: null
      }
    ])

    expect(
      buildJlptExportItems({
        request: { throughLevel: 'N3', mode: 'kanji' },
        vocabulary,
        kanji,
        details: detailsByLemma
      }).map((item) => item.id)
    ).toEqual(['kanji:火', 'kanji:字', 'kanji:空'])

    expect(
      buildJlptExportItems({
        request: { throughLevel: 'N3', mode: 'vocabulary' },
        vocabulary,
        kanji,
        details: detailsByLemma
      }).map((item) => item.id)
    ).toEqual(['vocabulary:木', 'vocabulary:空'])
  })
})
