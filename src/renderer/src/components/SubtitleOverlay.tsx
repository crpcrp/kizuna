import './SubtitleOverlay.css'
import { findActiveCue, type Cue } from '../../../shared/cue'
import { type Token } from '../../../shared/token'
import type { KnowledgeLevel } from '../../../shared/knowledge'
import { DEFAULT_SUBTITLE_STYLE, type SubtitleStyleSettings } from '../../../shared/playerSettings'
import { cueKey } from '../state/tokenization'
import type { VocabularySpan } from '../state/vocabularySpans'
import { vocabularyLevelsByToken } from '../state/vocabularyUnits'

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

/** Windows-first stack with coverage for Japanese compatibility punctuation such as `｡`. */
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

export type TokenSpanItem = { type: 'token'; token: Token } | { type: 'break' }

/**
 * Pure helper: turns a cue's raw text + its tokens into an ordered list of
 * token spans and line-break markers, so a token whose surface follows a
 * `\n` in the original cue text still produces a visual line break.
 * Assumes `tokens` is already in cue order (by `startOffset`).
 */
export function tokenSpans(cueText: string, tokens: Token[]): TokenSpanItem[] {
  const items: TokenSpanItem[] = []
  let lastLine = 0
  for (const token of tokens) {
    const line = countNewlinesBefore(cueText, token.startOffset)
    for (let i = lastLine; i < line; i++) items.push({ type: 'break' })
    items.push({ type: 'token', token })
    lastLine = line
  }
  return items
}

function countNewlinesBefore(text: string, offset: number): number {
  let count = 0
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === '\n') count++
  }
  return count
}

/**
 * Pure: resolves one cue's tokens to their `data-level`, shared by
 * SubtitleOverlay and SubtitleSidebar so the two never deviate. Levels come
 * from `vocabularyLevelsByToken` — the same base the word report and bulk mining
 * derive from — so a word underlined as known is exactly a word those two count
 * as known. `undefined` levels means coloring is disabled and no attribute is
 * rendered; a symbol/punctuation token is always `'wellKnown'` since there is
 * nothing to "know" about a '(' or a '?'.
 */
export function cueTokenLevels(
  key: string,
  tokens: Token[],
  levels: Record<string, KnowledgeLevel> | undefined,
  vocabularySpans: VocabularySpan[] | undefined
): (token: Token) => KnowledgeLevel | undefined {
  if (!levels) return () => undefined
  const byOffset = vocabularyLevelsByToken({ cueKey: key, tokens, spans: vocabularySpans }, levels)
  return (token) => byOffset.get(token.startOffset) ?? 'wellKnown'
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
  const highlightedOffsets = new Set(highlightedTokens?.map((t) => t.startOffset))

  // Only starts a drag when the mousedown lands on the box itself (not a
  // word span), so repositioning the subtitle never steals a word click/hover.
  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>): void => {
    if (dragEnabled && e.target === e.currentTarget) onDragStart?.(e)
  }

  if (!cue || !tokens || tokens.length === 0) {
    const lines = cue ? cue.text.split('\n') : []
    return (
      <div
        id="subtitle"
        data-background-enabled={style.backgroundEnabled ? undefined : 'false'}
        className={dragEnabled ? undefined : 'subtitle-selectable'}
        style={subtitleBoxStyle(style)}
        onMouseDown={handleMouseDown}
      >
        {lines.map((line, i) => (
          <span key={i}>
            {i > 0 && <br />}
            {line}
          </span>
        ))}
      </div>
    )
  }

  const spans = tokenSpans(cue.text, tokens)
  const levelFor = cueTokenLevels(cueKey(cue), tokens, levels, vocabularySpans)
  return (
    <div
      id="subtitle"
      data-background-enabled={style.backgroundEnabled ? undefined : 'false'}
      className={dragEnabled ? undefined : 'subtitle-selectable'}
      style={subtitleBoxStyle(style)}
      onMouseDown={handleMouseDown}
    >
      {spans.map((item, i) =>
        item.type === 'break' ? (
          <br key={i} />
        ) : (
          <span
            key={i}
            data-token=""
            data-highlighted={highlightedOffsets.has(item.token.startOffset) ? '' : undefined}
            data-level={levelFor(item.token)}
            onMouseEnter={(e) => onWordHover?.(item.token, e)}
            onMouseLeave={() => onWordLeave?.()}
            onClick={(e) => onWordClick?.(item.token, e)}
          >
            {item.token.surface}
          </span>
        )
      )}
    </div>
  )
}
