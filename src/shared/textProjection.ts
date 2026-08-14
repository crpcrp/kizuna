// One text, two views: the display text a viewer reads (with its line breaks)
// and the continuous analysis text MeCab and the dictionary see (with those
// breaks removed). Japanese wraps mid-word, so a word split by a line break —
// an OCR block's second line, or a subtitle cue's second line — is one word,
// and every token offset in this codebase is an offset into the analysis text.
// This module is the only place the two offset spaces are converted.

/**
 * A half-open range using JavaScript string offsets (UTF-16 code units), the
 * same convention used by `Token.startOffset` and `InteractiveText`.
 */
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

/**
 * Builds the display/analysis projection for ordered source lines.
 *
 * Source lines must not contain newline characters. Empty lines are preserved
 * in `displayText`, contribute one display boundary each, and contribute no
 * characters to `analysisText`. All offsets remain UTF-16 code-unit offsets.
 */
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

/**
 * Projection for text that already carries its display line breaks — a
 * subtitle cue, or an OCR block's joined lines. The inverse of
 * `createTextProjection`, since source lines never contain a newline.
 */
export function displayTextProjection(displayText: string): TextProjection {
  return createTextProjection(displayText.split('\n'))
}

/**
 * Maps an analysis boundary to the display boundary before its next visible
 * character. At a line boundary this therefore skips the inserted newline;
 * the end of the analysis text maps to the end of the display text.
 */
export function mapAnalysisOffsetToDisplayOffset(
  projection: TextProjection,
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
  projection: TextProjection,
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

/**
 * Same mapping as `mapAnalysisRangeToDisplayRanges` for a range that may not
 * belong to this text at all — a token list rendered one frame before its
 * replacement lands, or a sentence recorded from a different capture. The
 * range is clipped to the analysis text instead of rejected, so a transient
 * mismatch renders fewer segments rather than throwing.
 */
export function clipAnalysisRangeToDisplayRanges(
  projection: TextProjection,
  range: TextOffsetRange
): TextOffsetRange[] {
  const length = projection.analysisText.length
  const startOffset = clamp(range.startOffset, 0, length)
  const endOffset = clamp(range.endOffset, startOffset, length)
  return mapAnalysisRangeToDisplayRanges(projection, { startOffset, endOffset })
}

/** Maps a display selection to its continuous analysis range. */
export function mapDisplayRangeToAnalysisRange(
  projection: TextProjection,
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
  projection: TextProjection,
  range: TextOffsetRange
): string {
  const analysisRange = mapDisplayRangeToAnalysisRange(projection, range)
  return projection.analysisText.slice(analysisRange.startOffset, analysisRange.endOffset)
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isInteger(value)) return minimum
  return Math.min(Math.max(value, minimum), maximum)
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
