import './SubtitleOverlay.css'
import { type Cue } from '../../../shared/cue'
import { type Token } from '../../../shared/token'
import type { KnowledgeLevel } from '../../../shared/knowledge'
import { DEFAULT_SUBTITLE_STYLE, type SubtitleStyleSettings } from '../../../shared/playerSettings'
import { cueKey } from '../state/tokenization'
import type { WordPopupTextContext } from '../state/wordLookup'
import type { VocabularySpan } from '../state/vocabularySpans'
import InteractiveText from './InteractiveText'

export interface SubtitleOverlayProps {
  cue?: Cue
  /** Tokens for the currently-active cue only; caller matches them to the cue. */
  tokens?: Token[]
  /** Highlight the whole matched compound, including tokens beyond the hovered token. */
  highlightedTokens?: Token[]
  /** Undefined disables coloring; an empty map enables it with 'unknown' as the default. */
  levels?: Record<string, KnowledgeLevel>
  /** Compound projections for this cue; member tokens render as one word. */
  vocabularySpans?: VocabularySpan[]
  style?: SubtitleStyleSettings
  /** The event is optional for callers that only need the token. */
  onWordHover?: (token: Token, event?: React.MouseEvent, context?: WordPopupTextContext) => void
  onWordClick?: (token: Token, event?: React.MouseEvent, context?: WordPopupTextContext) => void
  /** Cancel hover intent when a token is swept past without entering another token. */
  onWordLeave?: () => void
  /** Fired on mousedown directly on the subtitle box background (not a word
   * span), so the caller can start tracking a drag-to-reposition gesture. */
  onDragStart?: (event: React.MouseEvent) => void
  /** Disables dragging and makes the full subtitle text selectable. */
  dragEnabled?: boolean
}

/** Base subtitle font size in rem at fontScale 1. */
const BASE_SUBTITLE_FONT_REM = 1.1

/** Cross-platform stack with coverage for Japanese compatibility punctuation such as `｡`. */
const SUBTITLE_FONT_FAMILY = '"Yu Gothic UI", "Yu Gothic", Meiryo, "Noto Sans JP", sans-serif'

function subtitleBoxStyle(style: SubtitleStyleSettings): React.CSSProperties {
  // Rounded to avoid floating-point artifacts (e.g. 1.1 * 1.5 === 1.6500000000000001) in the CSS value.
  const fontRem = Math.round(BASE_SUBTITLE_FONT_REM * style.fontScale * 1000) / 1000
  return {
    position: 'absolute',
    left: `${style.xPct}%`,
    top: `${style.yPct}%`,
    transform: 'translate(-50%, -50%)',
    fontSize: `${fontRem}rem`,
    fontFamily: SUBTITLE_FONT_FAMILY,
    '--subtitle-outline-size': `${style.outlineSizePx}px`
  } as React.CSSProperties
}

export default function SubtitleOverlay({
  cue,
  tokens,
  highlightedTokens,
  levels,
  vocabularySpans,
  style = DEFAULT_SUBTITLE_STYLE,
  onWordHover,
  onWordClick,
  onWordLeave,
  onDragStart,
  dragEnabled = true
}: SubtitleOverlayProps): React.JSX.Element {
  // Only starts a drag when the mousedown lands on the box itself (not a
  // word span), so repositioning the subtitle never steals a word click/hover.
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (dragEnabled && e.target === e.currentTarget) onDragStart?.(e)
  }

  const handleInteractiveMouseDown = (e: React.MouseEvent): void => {
    if (!dragEnabled) return
    const target = e.target as { closest?: (selector: string) => Element | null }
    if (!target.closest?.('[data-token]')) onDragStart?.(e)
  }

  if (!cue) {
    return (
      <div
        id="subtitle"
        data-background-enabled={style.backgroundEnabled ? undefined : 'false'}
        className={dragEnabled ? undefined : 'subtitle-selectable'}
        style={subtitleBoxStyle(style)}
        onMouseDown={handleMouseDown}
      />
    )
  }

  return (
    <div
      id="subtitle"
      data-background-enabled={style.backgroundEnabled ? undefined : 'false'}
      className={dragEnabled ? undefined : 'subtitle-selectable'}
      style={subtitleBoxStyle(style)}
      onMouseDown={handleMouseDown}
    >
      <InteractiveText
        id={cueKey(cue)}
        text={cue.text}
        tokens={tokens}
        highlightedTokens={highlightedTokens}
        levels={levels}
        vocabularySpans={vocabularySpans}
        onWordHover={onWordHover}
        onWordClick={onWordClick}
        onWordLeave={onWordLeave}
        onMouseDown={handleInteractiveMouseDown}
      />
    </div>
  )
}
