import type { ReactNode } from 'react'
import type { KnowledgeLevel } from '../../../shared/knowledge'
import type { Token } from '../../../shared/token'
import {
  clipAnalysisRangeToDisplayRanges,
  displayTextProjection,
  type TextProjection
} from '../../../shared/textProjection'
import type { WordPopupTextContext } from '../state/wordLookup'
import type { VocabularySpan } from '../state/vocabularySpans'
import { vocabularyLevelsByToken } from '../state/vocabularyUnits'

/**
 * Cue-independent Japanese text data. The id is exposed as a data attribute
 * so multiple interactive text instances can coexist without a singleton DOM
 * id.
 */
export interface InteractiveText {
  id: string
  text: string
  /**
   * The projection `tokens` was produced from. Optional: an equal projection
   * is derived from `text`, since display line breaks are the only difference
   * between the two views. Callers that already hold one pass it to avoid
   * rebuilding it on every render.
   */
  projection?: TextProjection
  tokens?: Token[]
  highlightedTokens?: Token[]
  levels?: Record<string, KnowledgeLevel>
  vocabularySpans?: VocabularySpan[]
}

export interface InteractiveTextProps extends InteractiveText {
  className?: string
  onWordHover?: (token: Token, event?: React.MouseEvent, context?: WordPopupTextContext) => void
  onWordClick?: (token: Token, event?: React.MouseEvent, context?: WordPopupTextContext) => void
  onWordLeave?: () => void
  onMouseDown?: React.MouseEventHandler<HTMLSpanElement>
  onSelect?: React.ReactEventHandler<HTMLSpanElement>
  /** Allows callers such as the subtitle search to wrap parts of a line. */
  renderLine?: (line: string, startOffset: number, lineIndex: number) => ReactNode
  /** Allows callers to add content inside the shared token span. */
  renderTokenContent?: (token: Token, itemIndex: number, fragment: TokenFragment) => ReactNode
}

/** One visible piece of a token: the whole token unless a line break splits it. */
export interface TokenFragment {
  /** Visible text of this piece, sliced from the display text. */
  text: string
  /** Where the piece starts in the display text, for caller-side highlighting. */
  displayStartOffset: number
  fragmentIndex: number
  /** How many pieces the token renders as; above 1 it crosses a line break. */
  fragmentCount: number
}

export type TokenSpanItem = ({ type: 'token'; token: Token } & TokenFragment) | { type: 'break' }

/**
 * Pure helper: turns text and ordered tokens into token items and line breaks.
 *
 * Token offsets are analysis offsets (see `shared/textProjection.ts`), so a
 * word split by a line break is one token rendered as several fragments; every
 * fragment keeps the same Token object and semantic data attributes. Line
 * breaks come from the display text rather than from token surfaces, which
 * also preserves blank lines between tokens.
 */
export function tokenSpans(
  text: string,
  tokens: Token[],
  projection: TextProjection = displayTextProjection(text)
): TokenSpanItem[] {
  const items: TokenSpanItem[] = []
  let displayCursor = 0

  for (const token of tokens) {
    // Clipped rather than mapped: a cue can render one frame with the
    // previous cue's tokens still in state, and that must not throw.
    const ranges = clipAnalysisRangeToDisplayRanges(projection, {
      startOffset: token.startOffset,
      endOffset: token.startOffset + token.surface.length
    })
    ranges.forEach((range, fragmentIndex) => {
      appendBreaks(projection.displayText, displayCursor, range.startOffset, items)
      items.push({
        type: 'token',
        token,
        text: projection.displayText.slice(range.startOffset, range.endOffset),
        displayStartOffset: range.startOffset,
        fragmentIndex,
        fragmentCount: ranges.length
      })
      displayCursor = range.endOffset
    })
  }

  appendBreaks(projection.displayText, displayCursor, projection.displayText.length, items)
  return items
}

/**
 * Pure: resolves the knowledge level for each token without requiring cue
 * timing. `id` is only the vocabulary-span identity used by the existing
 * compound projection; it is not rendered as a DOM id.
 */
export function tokenLevels(
  id: string,
  tokens: Token[],
  levels: Record<string, KnowledgeLevel> | undefined,
  vocabularySpans: VocabularySpan[] | undefined
): (token: Token) => KnowledgeLevel | undefined {
  if (!levels) return () => undefined
  const byOffset = vocabularyLevelsByToken({ cueKey: id, tokens, spans: vocabularySpans }, levels)
  return (token) => byOffset.get(token.startOffset) ?? 'wellKnown'
}

function appendBreaks(
  text: string,
  startOffset: number,
  endOffset: number,
  items: TokenSpanItem[]
): void {
  for (let offset = startOffset; offset < endOffset; offset++) {
    if (text[offset] === '\n') items.push({ type: 'break' })
  }
}

function linesWithOffsets(text: string): Array<{ line: string; offset: number }> {
  const lines = text.split('\n')
  let offset = 0
  return lines.map((line) => {
    const entry = { line, offset }
    offset += line.length + 1
    return entry
  })
}

function classNames(className: string | undefined): string | undefined {
  return className ? `interactive-text ${className}` : 'interactive-text'
}

export default function InteractiveText({
  id,
  text,
  projection,
  tokens,
  highlightedTokens,
  levels,
  vocabularySpans,
  className,
  onWordHover,
  onWordClick,
  onWordLeave,
  onMouseDown,
  onSelect,
  renderLine,
  renderTokenContent
}: InteractiveTextProps): React.JSX.Element {
  const highlightedOffsets = new Set(highlightedTokens?.map((token) => token.startOffset))
  const levelFor = tokenLevels(id, tokens ?? [], levels, vocabularySpans)
  const content =
    tokens && tokens.length > 0
      ? tokenSpans(text, tokens, projection).map((item, itemIndex) =>
          item.type === 'break' ? (
            <br key={itemIndex} />
          ) : (
            <span
              key={itemIndex}
              data-token=""
              // Fragments of a word split by a line break share one key, so the
              // DOM says they are the same word rather than two neighbors.
              data-token-key={
                item.fragmentCount > 1 ? `${id}:${item.token.startOffset}` : undefined
              }
              data-token-fragment={item.fragmentCount > 1 ? String(item.fragmentIndex) : undefined}
              data-highlighted={highlightedOffsets.has(item.token.startOffset) ? '' : undefined}
              data-level={levelFor(item.token)}
              onMouseEnter={(event) => onWordHover?.(item.token, event)}
              onMouseLeave={() => onWordLeave?.()}
              onClick={(event) => onWordClick?.(item.token, event)}
            >
              {renderTokenContent ? renderTokenContent(item.token, itemIndex, item) : item.text}
            </span>
          )
        )
      : linesWithOffsets(text).map(({ line, offset }, lineIndex) => (
          <span key={lineIndex}>
            {lineIndex > 0 && <br />}
            {renderLine ? renderLine(line, offset, lineIndex) : line}
          </span>
        ))

  return (
    <span
      className={classNames(className)}
      data-interactive-text-id={id}
      onMouseDown={onMouseDown}
      onSelect={onSelect}
    >
      {content}
    </span>
  )
}
