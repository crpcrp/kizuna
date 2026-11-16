// Japanese wraps mid-word: analysis removes line breaks; display retains them. Token offsets use analysis text.

import { clamp } from './math'

/** Half-open range in UTF-16 code units. */
export interface TextOffsetRange {
  readonly startOffset: number
  readonly endOffset: number
}

export interface TextLineProjection {
  readonly text: string
  readonly displayStartOffset: number
  readonly analysisStartOffset: number
}

export interface TextProjection {
  /** Text with exactly one newline between each source line. */
  readonly displayText: string
  /** Text with visual line-wrap boundaries removed and no replacement space. */
  readonly analysisText: string
  readonly lines: readonly TextLineProjection[]
}

/** Source lines must contain no newlines; empty lines retain display boundaries but add no analysis characters. */
export function createTextProjection(sourceLines: readonly string[]): TextProjection {
  let displayStartOffset = 0
  let analysisStartOffset = 0
  const lines: TextLineProjection[] = []

  for (const [index, text] of sourceLines.entries()) {
    if (text.includes('\n')) {
      throw new RangeError('projection source lines must not contain newline characters')
    }

    lines.push(
      Object.freeze({
        text,
        displayStartOffset,
        analysisStartOffset
      })
    )
    displayStartOffset += text.length
    analysisStartOffset += text.length
    if (index < sourceLines.length - 1) displayStartOffset++
  }

  return Object.freeze({
    displayText: sourceLines.join('\n'),
    analysisText: sourceLines.join(''),
    lines: Object.freeze(lines)
  })
}

export function displayTextProjection(displayText: string): TextProjection {
  return createTextProjection(displayText.split('\n'))
}

/** Returned display ranges exclude inserted newlines. */
export function mapAnalysisRangeToDisplayRanges(
  projection: TextProjection,
  range: TextOffsetRange
): TextOffsetRange[] {
  assertRange(range, projection.analysisText.length, 'analysis range')

  return projection.lines.flatMap((line) => {
    const lineEnd = line.analysisStartOffset + line.text.length
    const startOffset = Math.max(range.startOffset, line.analysisStartOffset)
    const endOffset = Math.min(range.endOffset, lineEnd)
    if (startOffset >= endOffset) return []

    return [
      {
        startOffset: line.displayStartOffset + startOffset - line.analysisStartOffset,
        endOffset: line.displayStartOffset + endOffset - line.analysisStartOffset
      }
    ]
  })
}

/** Clip stale token ranges so a transient text mismatch renders fewer segments instead of throwing. */
export function clipAnalysisRangeToDisplayRanges(
  projection: TextProjection,
  range: TextOffsetRange
): TextOffsetRange[] {
  const length = projection.analysisText.length
  const integerOr = (value: number, fallback: number): number =>
    Number.isInteger(value) ? value : fallback
  const startOffset = clamp(integerOr(range.startOffset, 0), 0, length)
  const endOffset = clamp(integerOr(range.endOffset, startOffset), startOffset, length)
  return mapAnalysisRangeToDisplayRanges(projection, { startOffset, endOffset })
}

function assertOffset(offset: number, length: number, label: string): void {
  if (!Number.isInteger(offset) || offset < 0 || offset > length) {
    throw new RangeError(`${label} must be an integer between 0 and ${length}`)
  }
}

function assertRange(range: TextOffsetRange, length: number, label: string): void {
  assertOffset(range.startOffset, length, `${label} start`)
  assertOffset(range.endOffset, length, `${label} end`)
  if (range.startOffset > range.endOffset) {
    throw new RangeError(`${label} start must not exceed end`)
  }
}
