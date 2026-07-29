import { describe, expect, it } from 'vitest'
import {
  wholeTrackVocabularyDependencyKey,
  type WholeTrackVocabularyDependencies
} from '@src/renderer/src/state/wholeTrackVocabularyKey'

const input: WholeTrackVocabularyDependencies = {
  filePath: 'episode.mkv',
  subtitleTrackId: 2,
  japaneseSubtitleSelected: true,
  cues: [{ start: 0, end: 1, text: 'word' }],
  frequencyDictId: 1,
  sortOrder: 'auto',
  dictionarySettings: { yomitanDicts: [{ id: 1, enabled: true }] },
  knowledgeEpoch: 3
}

describe('wholeTrackVocabularyDependencyKey', () => {
  it('excludes Anki-domain data but changes for vocabulary inputs', () => {
    const key = wholeTrackVocabularyDependencyKey(input)
    const ankiLoadingOrReady = {
      ...input,
      anki: { status: 'ready', duplicatePolicy: 'overwrite', deck: 'Target' }
    }
    expect(wholeTrackVocabularyDependencyKey(ankiLoadingOrReady)).toBe(key)

    expect(
      wholeTrackVocabularyDependencyKey({ ...input, cues: [{ start: 1, end: 2, text: 'other' }] })
    ).not.toBe(key)
    expect(
      wholeTrackVocabularyDependencyKey({
        ...input,
        dictionarySettings: { yomitanDicts: [{ id: 1, enabled: false }] }
      })
    ).not.toBe(key)
    expect(wholeTrackVocabularyDependencyKey({ ...input, knowledgeEpoch: 4 })).not.toBe(key)
  })
})
