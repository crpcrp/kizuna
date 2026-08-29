import { describe, expect, it } from 'vitest'
import type { JlptExportItem } from '@src/shared/jlptExport'
import { displayedCandidates } from '@src/renderer/src/state/bulkMining'
import { buildJlptMiningCandidates } from '@src/renderer/src/state/jlptMining'
import { makeLookupResult } from '@test/harness/dictFixtures'

function item(overrides: Partial<JlptExportItem>): JlptExportItem {
  return {
    id: 'vocabulary:猫',
    kind: 'vocabulary',
    expression: '猫',
    reading: 'ねこ',
    level: 'N4',
    frequency: null,
    ...overrides
  }
}

describe('buildJlptMiningCandidates', () => {
  it('maps vocabulary and kanji rows without subtitle or media context', () => {
    expect(
      buildJlptMiningCandidates([
        item({ expression: ' 猫 ', reading: 'ねこ', level: 'N4' }),
        item({
          id: 'kanji:日',
          kind: 'kanji',
          expression: '日',
          reading: '',
          level: 'N5',
          frequency: 12
        })
      ])
    ).toEqual([
      {
        lemma: '日',
        token: { surface: '日', reading: '', lemma: '日', pos: '', startOffset: 0 },
        sentence: '',
        count: 1,
        kind: 'kanji',
        level: 'N5',
        fallbackFrequency: 12
      },
      {
        lemma: '猫',
        token: { surface: '猫', reading: 'ねこ', lemma: '猫', pos: '', startOffset: 0 },
        sentence: '',
        count: 1,
        kind: 'vocabulary',
        level: 'N4',
        fallbackFrequency: null
      }
    ])
  })

  it('returns an empty list and orders numeric ranks before missing ranks', () => {
    expect(buildJlptMiningCandidates([])).toEqual([])

    const candidates = buildJlptMiningCandidates([
      item({ expression: '猫', level: 'N4' }),
      item({ expression: '犬', level: 'N5' }),
      item({ id: 'vocabulary:火', expression: '火', level: 'N5', reading: 'ひ' }),
      item({ id: 'vocabulary:空', expression: '空', level: 'N3', reading: 'そら' })
    ])
    const resolved = Object.fromEntries(
      candidates.map((candidate) => [
        candidate.lemma,
        {
          entry: makeLookupResult({ expression: candidate.lemma }),
          frequency:
            candidate.lemma === '猫'
              ? 20
              : candidate.lemma === '犬' || candidate.lemma === '火'
                ? 4
                : null
        }
      ])
    )

    expect(
      displayedCandidates(
        candidates,
        resolved,
        {
          maximumFrequency: null,
          minimumCount: null,
          frequencyDictConfigured: true,
          targetDeckMatches: {},
          hideTargetDeckMatches: false
        },
        'frequency'
      ).map((candidate) => candidate.lemma)
    ).toEqual(['火', '犬', '猫', '空'])
  })
})
