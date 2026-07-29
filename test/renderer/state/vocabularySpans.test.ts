import { describe, expect, it } from 'vitest'
import type { Token } from '@src/shared/token'
import {
  deriveVocabularySpans,
  type VocabularySpanLookup
} from '@src/renderer/src/state/vocabularySpans'

const token = (surface: string, startOffset: number, pos = '名詞'): Token => ({
  surface,
  startOffset,
  pos,
  lemma: surface,
  reading: ''
})
const lookup = (
  tokenOffset: number,
  matchedSurface: string | undefined,
  expression = matchedSurface ?? '',
  level: VocabularySpanLookup['level'] = 'unknown',
  cueKey = 'cue-1'
): VocabularySpanLookup => ({ cueKey, tokenOffset, result: { expression, matchedSurface }, level })

describe('deriveVocabularySpans', () => {
  it('projects a compound while leaving the same suffix standalone', () => {
    const tokens = [token('神', 0), token('様', 1), token('様', 3)]
    expect(
      deriveVocabularySpans('cue-1', tokens, [lookup(0, '神様', '神様', 'known'), lookup(3, '様')])
    ).toEqual([
      {
        cueKey: 'cue-1',
        startOffset: 0,
        endOffset: 2,
        memberTokenOffsets: [0, 1],
        expression: '神様',
        matchedSurface: '神様',
        level: 'known'
      }
    ])
  })

  it('returns no span when lookup found no dictionary compound', () => {
    expect(
      deriveVocabularySpans('cue-1', [token('神', 0), token('様', 1)], [lookup(0, undefined)])
    ).toEqual([])
  })

  it('chooses the longest overlap at each left-to-right offset', () => {
    const tokens = [token('甲', 0), token('乙', 1), token('丙', 2), token('丁', 3)]
    const spans = deriveVocabularySpans('cue-1', tokens, [
      lookup(0, '甲乙'),
      lookup(1, '乙丙丁'),
      lookup(0, '甲乙丙')
    ])
    expect(spans.map((span) => span.matchedSurface)).toEqual(['甲乙丙'])
  })

  it('rejects punctuation and offset gaps', () => {
    expect(
      deriveVocabularySpans(
        'cue-1',
        [token('神', 0), token('、', 1, '記号'), token('様', 2)],
        [lookup(0, '神、様')]
      )
    ).toEqual([])
    expect(
      deriveVocabularySpans('cue-1', [token('神', 0), token('様', 2)], [lookup(0, '神様')])
    ).toEqual([])
  })

  it('binds identical surfaces to their exact offsets', () => {
    const tokens = [token('神', 0), token('様', 1), token('神', 3), token('様', 4)]
    expect(
      deriveVocabularySpans('cue-1', tokens, [lookup(3, '神様')])[0].memberTokenOffsets
    ).toEqual([3, 4])
  })

  it('rejects stale cue/offset data and a non-prefix matched surface', () => {
    const tokens = [token('神', 0), token('様', 1)]
    expect(
      deriveVocabularySpans('cue-1', tokens, [
        lookup(0, '神様', '神様', 'known', 'old-cue'),
        lookup(9, '神様'),
        lookup(0, '様')
      ])
    ).toEqual([])
  })

  it('uses the strongest knowledge level for duplicate compound results', () => {
    const tokens = [token('神', 0), token('様', 1)]
    const [span] = deriveVocabularySpans('cue-1', tokens, [
      lookup(0, '神様'),
      lookup(0, '神様', '神様', 'known')
    ])
    expect(span.level).toBe('known')
  })
})
