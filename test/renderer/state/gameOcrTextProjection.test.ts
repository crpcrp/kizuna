import { describe, expect, it } from 'vitest'
import {
  createGameOcrTextProjection,
  displayRangeToAnalysisText,
  mapAnalysisOffsetToDisplayOffset,
  mapAnalysisRangeToDisplayRanges,
  mapDisplayOffsetToAnalysisOffset,
  mapDisplayRangeToAnalysisRange,
  type TextOffsetRange
} from '@src/renderer/src/state/gameOcrTextProjection'

const range = (startOffset: number, endOffset: number): TextOffsetRange => ({
  startOffset,
  endOffset
})

describe('game OCR text projection', () => {
  it('keeps a single line identical in both views', () => {
    const projection = createGameOcrTextProjection(['日本語'])

    expect(projection.displayText).toBe('日本語')
    expect(projection.analysisText).toBe('日本語')
    expect(mapAnalysisOffsetToDisplayOffset(projection, 2)).toBe(2)
    expect(mapDisplayOffsetToAnalysisOffset(projection, 1)).toBe(1)
    expect(mapAnalysisRangeToDisplayRanges(projection, range(1, 3))).toEqual([range(1, 3)])
  })

  it('adds one display newline while joining analysis lines without a separator', () => {
    const projection = createGameOcrTextProjection(['棒人間が描か', 'れている。'])

    expect(projection.displayText).toBe('棒人間が描か\nれている。')
    expect(projection.analysisText).toBe('棒人間が描かれている。')
    expect(mapAnalysisOffsetToDisplayOffset(projection, 6)).toBe(7)
    expect(mapDisplayOffsetToAnalysisOffset(projection, 7)).toBe(6)
  })

  it('retains empty lines in display text but not analysis text', () => {
    const projection = createGameOcrTextProjection(['上', '', '下'])

    expect(projection.displayText).toBe('上\n\n下')
    expect(projection.analysisText).toBe('上下')
    expect(mapAnalysisRangeToDisplayRanges(projection, range(0, 2))).toEqual([
      range(0, 1),
      range(3, 4)
    ])
  })

  it.each([
    ['before a newline', ['abc', 'def'], range(0, 2), [range(0, 2)]],
    ['after a newline', ['abc', 'def'], range(3, 5), [range(4, 6)]],
    ['across one newline', ['描か', 'れている'], range(0, 5), [range(0, 2), range(3, 6)]],
    [
      'across multiple newlines',
      ['a', 'bc', 'def'],
      range(0, 6),
      [range(0, 1), range(2, 4), range(5, 8)]
    ]
  ])('maps an analysis range %s to visible segments', (_name, lines, input, expected) => {
    const projection = createGameOcrTextProjection(lines)

    expect(mapAnalysisRangeToDisplayRanges(projection, input)).toEqual(expected)
  })

  it('maps display selections across lines back to continuous analysis text', () => {
    const projection = createGameOcrTextProjection(['描か', 'れている'])
    const selection = range(1, 6)

    expect(mapDisplayRangeToAnalysisRange(projection, selection)).toEqual(range(1, 5))
    expect(displayRangeToAnalysisText(projection, selection)).toBe('かれてい')
  })

  it('maps a selection containing only an inserted newline to no semantic text', () => {
    const projection = createGameOcrTextProjection(['前', '後'])

    expect(displayRangeToAnalysisText(projection, range(1, 2))).toBe('')
    expect(mapDisplayRangeToAnalysisRange(projection, range(1, 2))).toEqual(range(1, 1))
  })

  it('keeps offset boundaries stable around a newline', () => {
    const projection = createGameOcrTextProjection(['ab', 'cd'])

    expect(mapDisplayOffsetToAnalysisOffset(projection, 2)).toBe(2)
    expect(mapDisplayOffsetToAnalysisOffset(projection, 3)).toBe(2)
    expect(mapAnalysisOffsetToDisplayOffset(projection, 2)).toBe(3)
    expect(mapAnalysisRangeToDisplayRanges(projection, range(2, 2))).toEqual([])
  })

  it('uses offsets rather than searching repeated text', () => {
    const projection = createGameOcrTextProjection(['猫', '猫'])

    expect(mapAnalysisRangeToDisplayRanges(projection, range(1, 2))).toEqual([range(2, 3)])
    expect(displayRangeToAnalysisText(projection, range(2, 3))).toBe('猫')
  })

  it('rejects malformed offsets and ranges consistently', () => {
    const projection = createGameOcrTextProjection(['abc'])

    expect(() => mapAnalysisOffsetToDisplayOffset(projection, -1)).toThrow(RangeError)
    expect(() => mapDisplayOffsetToAnalysisOffset(projection, 4)).toThrow(RangeError)
    expect(() => mapAnalysisRangeToDisplayRanges(projection, range(2, 1))).toThrow(RangeError)
    expect(() => displayRangeToAnalysisText(projection, range(0, 4))).toThrow(RangeError)
  })

  it('rejects source lines containing embedded newlines', () => {
    expect(() => createGameOcrTextProjection(['a\nb'])).toThrow(RangeError)
  })
})
