import './SubtitleOverlay.css'
import { findActiveCue, type Cue } from '../../../shared/cue'
import { type Token } from '../../../shared/token'
import type { KnowledgeLevel } from '../../../shared/knowledge'
import { DEFAULT_SUBTITLE_STYLE, type SubtitleStyleSettings } from '../../../shared/playerSettings'
import { cueKey } from '../state/tokenization'
import type { VocabularySpan } from '../state/vocabularySpans'
import InteractiveText, { tokenLevels } from './InteractiveText'

export { tokenSpans, type TokenSpanItem } from './InteractiveText'

/** Backwards-compatible name for callers that used the old overlay helper. */
export const cueTokenLevels = tokenLevels

// Presentational overlay: shows whichever cue is active at the current
// playback time. Derived from props — no internal state; dragging is
// reported to the caller via onDragStart rather than tracked here, so the
// component itself stays a pure function of its props.
//
// When `tokens` (for the currently-active cue) is provided and non-empty,
// renders one interactive span per token instead of plain text. Otherwise
// falls back exactly to the original plain-text rendering — this fallback
// must never regress since it covers the "not tokenized yet" / "not
// Japanese" cases.

export interface SubtitleOverlayProps {
  cues: Cue[]
  timePos: number
  /** Tokens for the currently-active cue only; caller matches them to the cue. */
  tokens?: Token[]
  /**
   * Tokens (by `startOffset`) that should render as visually highlighted,
   * independent of live mouse hover — e.g. the caller's resolved word popup
   * may span more tokens than the one actually under the cursor (a
   * longest-match compound like 閻魔大王 resolved from a click on just 閻魔),
   * and the highlight should reflect the whole matched word.
   */
  highlightedTokens?: Token[]
  /**
   * Knowledge level per lemma, used to underline each token by how well the
   * viewer knows it. `undefined` means coloring is disabled/not yet resolved
   * and renders no `data-level` attribute at all (no regression for callers
   * that haven't wired this yet); an object (even `{}`) means coloring is on
   * and a word missing from the map defaults to `'unknown'`. How a token's
   * level follows from this map is `cueTokenLevels` below.
   */
  levels?: Record<string, KnowledgeLevel>
  /** Compound projections for this cue; member tokens render as one word. */
  vocabularySpans?: VocabularySpan[]
  /** Font scale + box position; defaults to DEFAULT_SUBTITLE_STYLE when omitted. */
  style?: SubtitleStyleSettings
  /** The event is optional for callers that only need the token. */
  onWordHover?: (token: Token, event?: React.MouseEvent) => void
  onWordClick?: (token: Token, event?: React.MouseEvent) => void
  /** Fired when the pointer leaves a token span, so the caller can cancel a
   * pending hover-intent timer for a word merely swept past (see onWordHover
   * on the caller side) instead of only ever resetting it on the *next*
   * token's onMouseEnter. */
  onWordLeave?: () => void
  /** Fired on mousedown directly on the subtitle box background (not a word
   * span), so the caller can start tracking a drag-to-reposition gesture. */
  onDragStart?: (event: React.MouseEvent) => void
  /** Disables dragging and makes the full subtitle text selectable. */
  dragEnabled?: boolean
}

/** Base subtitle font size (rem) at fontScale 1, matching the previous fixed 1.1rem. */
const BASE_SUBTITLE_FONT_REM = 1.1

/** Cross-platform stack with coverage for Japanese compatibility punctuation such as `｡`. */
const SUBTITLE_FONT_FAMILY = '"Yu Gothic UI", "Yu Gothic", Meiryo, "Noto Sans JP", sans-serif'

/** Pure: turns SubtitleStyleSettings into the inline style for #subtitle's box. */
export function subtitleBoxStyle(style: SubtitleStyleSettings): React.CSSProperties {
  // Rounded to avoid floating-point artifacts (e.g. 1.1 * 1.5 === 1.6500000000000001) in the CSS value.
  const fontRem = Math.round(BASE_SUBTITLE_FONT_REM * style.fontScale * 1000) / 1000
  return {
    position: 'absolute',
    left: `${style.xPct}%`,
    top: `${style.yPct}%`,
    transform: 'translate(-50%, -50%)',
    fontSize: `${fontRem}rem`,
    fontFamily: SUBTITLE_FONT_FAMILY
  }
}

export default function SubtitleOverlay({
  cues,
  timePos,
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
  const cue = findActiveCue(cues, timePos)

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
