import { describe, expect, it } from 'vitest'
import {
  buildJlptVocabularyInventory,
  type JlptCanonicalVocabularyInventory
} from '@src/main/services/jlpt/vocabularyInventory'
import type { JlptVocabularySnapshot } from '@src/main/services/jlpt/classifier'
import type { JlptLevel } from '@src/shared/jlpt'

const SOURCE = {
  name: 'OpenJLPT',
  version: 'test-version',
  commit: 'snapshot-test',
  license: 'CC-BY-SA-4.0'
}

function snapshot(entries: Array<[string, string, JlptLevel]>): JlptVocabularySnapshot {
  return { schemaVersion: 1, source: SOURCE, inputRecordCount: entries.length, entries }
}

describe('buildJlptVocabularyInventory', () => {
  it('keeps the easiest level and a deterministic reading from that level', () => {
    const inventory = buildJlptVocabularyInventory(
      snapshot([
        ['猫', '高い', 'N4'],
        ['猫', '', 'N5'],
        ['猫', 'ねこ', 'N5'],
        ['猫', 'あねこ', 'N5'],
        ['犬', 'いぬ', 'N4'],
        [' 犬 ', 'いぬ', 'N4'],
        ['  ', '', 'N5']
      ])
    )

    expect(inventory).toEqual({
      entries: [
        { expression: '犬', reading: 'いぬ', level: 'N4' },
        { expression: '猫', reading: 'あねこ', level: 'N5' }
      ],
      nonEmptyRecordCount: 6,
      conflictCount: 1
    } satisfies JlptCanonicalVocabularyInventory)
  })

  it('is independent of source row order', () => {
    const entries = [
      ['猫', 'ねこ', 'N5'],
      ['猫', 'あねこ', 'N5'],
      ['犬', 'いぬ', 'N4']
    ] satisfies Array<[string, string, JlptLevel]>

    expect(buildJlptVocabularyInventory(snapshot([...entries].reverse()))).toEqual(
      buildJlptVocabularyInventory(snapshot(entries))
    )
  })
})
