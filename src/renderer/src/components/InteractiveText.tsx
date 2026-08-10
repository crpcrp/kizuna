import type { ReactNode } from 'react'
import type { KnowledgeLevel } from '../../../shared/knowledge'
import type { Token } from '../../../shared/token'
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
  renderTokenContent?: (token: Token, itemIndex: number) => ReactNode
}

export type TokenSpanItem = { type: 'token'; token: Token } | { type: 'break' }

/**
 * Pure helper: turns text and ordered tokens into token items and line breaks.
 * Newlines are taken from the original text rather than inferred from token
 * surfaces, which also preserves blank lines between tokens.
 */
export function tokenSpans(text: string, tokens: Token[]): TokenSpanItem[] {
  const items: TokenSpanItem[] = []
  let lastLine = 0
  for (const token of tokens) {
    const line = countNewlinesBefore(text, token.startOffset)
    for (let i = lastLine; i < line; i++) items.push({ type: 'break' })
    items.push({ type: 'token', token })
    lastLine = line
  }
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

function countNewlinesBefore(text: string, offset: number): number {
  let count = 0
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === '\n') count++
  }
  return count
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
      ? tokenSpans(text, tokens).map((item, itemIndex) =>
          item.type === 'break' ? (
            <br key={itemIndex} />
          ) : (
            <span
              key={itemIndex}
              data-token=""
              data-highlighted={highlightedOffsets.has(item.token.startOffset) ? '' : undefined}
              data-level={levelFor(item.token)}
              onMouseEnter={(event) => onWordHover?.(item.token, event)}
              onMouseLeave={() => onWordLeave?.()}
              onClick={(event) => onWordClick?.(item.token, event)}
            >
              {renderTokenContent ? renderTokenContent(item.token, itemIndex) : item.token.surface}
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
