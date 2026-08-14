/**
 * A half-open range using JavaScript string offsets (UTF-16 code units), the
 * same convention used by `Token.startOffset` and `InteractiveText`.
 */
export interface TextOffsetRange {
  readonly startOffset: number
  readonly endOffset: number
}

export interface GameOcrTextLineProjection {
  readonly text: string
  readonly displayStartOffset: number
  readonly analysisStartOffset: number
}

export interface GameOcrTextProjection {
  /** Text with exactly one newline between each source line. */
  readonly displayText: string
  /** Text with visual line-wrap boundaries removed and no replacement space. */
  readonly analysisText: string
  readonly lines: readonly GameOcrTextLineProjection[]
}

/**
 * Builds the display/analysis projection for ordered OCR source lines.
 *
 * Source lines must not contain newline characters. Empty lines are preserved
 * in `displayText`, contribute one display boundary each, and contribute no
 * characters to `analysisText`. All offsets remain UTF-16 code-unit offsets.
 */
export function createGameOcrTextProjection(sourceLines: readonly string[]): GameOcrTextProjection {
  let displayStartOffset = 0
  let analysisStartOffset = 0
  const lines: GameOcrTextLineProjection[] = []

  for (const [index, text] of sourceLines.entries()) {
    if (text.includes('\n')) {
      throw new RangeError('OCR source lines must not contain newline characters')
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

/**
 * Maps an analysis boundary to the display boundary before its next visible
 * character. At a line boundary this therefore skips the inserted newline;
 * the end of the analysis text maps to the end of the display text.
 */
export function mapAnalysisOffsetToDisplayOffset(
  projection: GameOcrTextProjection,
  offset: number
): number {
  assertOffset(offset, projection.analysisText.length, 'analysis offset')

  for (const line of projection.lines) {
    const lineEnd = line.analysisStartOffset + line.text.length
    if (offset >= line.analysisStartOffset && offset < lineEnd) {
      return line.displayStartOffset + offset - line.analysisStartOffset
    }
    if (offset === line.analysisStartOffset && line.text.length > 0) {
      return line.displayStartOffset
    }
  }

  return projection.displayText.length
}

/** Maps a display boundary to the number of visible UTF-16 code units before it. */
export function mapDisplayOffsetToAnalysisOffset(
  projection: GameOcrTextProjection,
  offset: number
): number {
  assertOffset(offset, projection.displayText.length, 'display offset')

  let analysisOffset = 0
  for (let displayOffset = 0; displayOffset < offset; displayOffset++) {
    if (projection.displayText[displayOffset] !== '\n') analysisOffset++
  }
  return analysisOffset
}

/**
 * Maps one continuous analysis range to ordered visible segments. Inserted
 * newlines are never included in the returned ranges.
 */
export function mapAnalysisRangeToDisplayRanges(
  projection: GameOcrTextProjection,
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

/** Maps a display selection to its continuous analysis range. */
export function mapDisplayRangeToAnalysisRange(
  projection: GameOcrTextProjection,
  range: TextOffsetRange
): TextOffsetRange {
  assertRange(range, projection.displayText.length, 'display range')
  return {
    startOffset: mapDisplayOffsetToAnalysisOffset(projection, range.startOffset),
    endOffset: mapDisplayOffsetToAnalysisOffset(projection, range.endOffset)
  }
}

/** Returns the continuous analysis text represented by a display selection. */
export function displayRangeToAnalysisText(
  projection: GameOcrTextProjection,
  range: TextOffsetRange
): string {
  const analysisRange = mapDisplayRangeToAnalysisRange(projection, range)
  return projection.analysisText.slice(analysisRange.startOffset, analysisRange.endOffset)
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
