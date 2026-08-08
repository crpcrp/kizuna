import './WordPopup.css'
import { Fragment } from 'react'
import { pitchAccentValue, priorityWeight, type LookupResult } from '../../../shared/dictionary'
import type { KnowledgeDetails } from '../../../shared/knowledge'
import {
  capGlossarySenses,
  glossaryDataAttributes,
  parseStructuredGlossary,
  sanitizeGlossaryCss,
  type GlossaryNode
} from '../../../shared/structuredGlossary'
import type { Token } from '../../../shared/token'

// Word lookup popup: shown near a token the user clicked/hovered while a
// video is playing. It takes data as props and remains mounted while CSS
// controls visibility, which keeps rendering deterministic in tests.

export interface WordPopupProps {
  results: LookupResult[]
  /** Anchor position (e.g. viewport px) near the token that was clicked/hovered. */
  position: { x: number; y: number } | null
  onClose?: () => void
  /** Max dictionary entries (rows) to render. Defaults to unlimited. */
  maxEntries?: number
  /** Max meanings/senses to render per entry. Defaults to unlimited. */
  maxMeanings?: number
  /** The word the popup was opened for — forwarded verbatim in the mine request. */
  token?: Token
  /** The active cue's text — forwarded verbatim in the mine request. */
  sentence?: string
  /**
   * Mines `result` into Anki (via App.tsx's injected bridge). The component
   * stays IPC-free per its own doc comment above — this is the only hook out.
   * The "＋ Anki" button only renders when this is supplied.
   */
  onAddToAnki?: (result: LookupResult) => void | Promise<void>
  /**
   * Transient state of the most recent `onAddToAnki` call, owned by App.tsx
   * (not local component state, so this component stays a pure function of
   * its props). Shown in place of the button on every row while not 'idle'.
   */
  ankiStatus?: 'idle' | 'adding' | 'added' | 'updated' | 'error'
  ankiError?: string
  /** Shows the overwrite action when a matching card exists. */
  duplicatePolicy?: 'prevent-global' | 'prevent-deck' | 'overwrite' | 'allow'
  /**
   * When the looked-up word already has a note in Anki, App.tsx passes the
   * matching card's id here — the row then renders an "Open in Anki" button
   * (calling `onOpenAnkiCard`) instead of the "＋ Anki" button/status.
   */
  ankiExisting?: Readonly<Record<string, { cardId: number }>>
  /** Opens `ankiExisting`'s card in Anki's Browse window. Only used when `ankiExisting` is set. */
  onOpenAnkiCard?: (cardId: number) => void | Promise<void>
  /**
   * Called with the target term when the user clicks a glossary
   * cross-reference link whose `href` resolves to one (see
   * `parseInternalLinkQuery`). Omitted (or a link whose `href` doesn't
   * resolve) renders the link as the old non-interactive chip.
   */
  onLinkClick?: (term: string) => void
  /** Shows a back arrow (top-left) that calls this when clicked. Only
   * rendered when both this and `canGoBack` are set — see `onLinkClick`. */
  onBack?: () => void
  /** Whether a previous word is available to go back to. See `onBack`. */
  canGoBack?: boolean
  /** Supplemental knowledge-source details for the word that opened this popup. */
  provenanceByExpression?: Readonly<Record<string, KnowledgeDetails>>
}

/**
 * Splits a glossary blob (senses joined with '\n' at import time, see
 * lookup.ts) into individual sense strings, trimming whitespace and dropping
 * any empty lines that result from stray/duplicate separators. Also the
 * fallback sense list for results imported before `glossaryJson` existed
 * (schema < 2).
 */
export function splitSenses(glossary: string): string[] {
  return glossary
    .split('\n')
    .map((sense) => sense.trim())
    .filter((sense) => sense.length > 0)
}

/**
 * True when the space-separated `termTags` or `defTags` contains a known
 * common-word marker, including Jitendex's ★ definition tag. Tokens are
 * matched exactly, not as substrings, so e.g. 'newsflash1' would not match.
 */
export function isHighPriority(termTags: string, defTags = ''): boolean {
  return priorityWeight(termTags, defTags) > 0
}

/** Known part-of-speech / conjugation tag -> human-readable label. */
const POS_LABELS: Record<string, string> = {
  v1: 'ichidan verb',
  vk: 'kuru verb',
  vs: 'suru verb',
  'vs-i': 'suru verb',
  'vs-s': 'suru verb',
  vt: 'transitive',
  vi: 'intransitive',
  'adj-i': 'i-adjective',
  'adj-na': 'na-adjective',
  'adj-no': 'no-adjective',
  n: 'noun',
  adv: 'adverb',
  exp: 'expression',
  int: 'interjection',
  prt: 'particle',
  pn: 'pronoun',
  conj: 'conjunction'
}

/** Maps one rules/defTags token to its human label, or null if unknown. */
function labelForToken(token: string): string | null {
  if (POS_LABELS[token]) return POS_LABELS[token]
  if (token.startsWith('v5')) return 'godan verb'
  return null
}

/**
 * Unions the space-separated tokens of `rules` and `defTags`, maps each
 * known part-of-speech/conjugation code to a human-readable label (see
 * POS_LABELS / labelForToken), drops unknown codes, and dedupes labels while
 * preserving first-seen order (e.g. 'v5r' from rules and 'v5r vt' from
 * defTags both map 'v5r' -> 'godan verb', which only appears once).
 */
export function posAttributes(rules: string, defTags: string): string[] {
  const tokens = [...rules.split(' '), ...defTags.split(' ')].filter((t) => t.length > 0)
  const labels: string[] = []
  const seen = new Set<string>()
  for (const token of tokens) {
    const label = labelForToken(token)
    if (label && !seen.has(label)) {
      seen.add(label)
      labels.push(label)
    }
  }
  return labels
}

function renderGlossaryNode(
  node: GlossaryNode,
  key: string,
  onLinkClick?: (term: string) => void
): React.ReactNode {
  if (typeof node === 'string') return node
  const children = node.children.map((child, index) => (
    <Fragment key={`${key}-${index}`}>
      {renderGlossaryNode(child, `${key}-${index}`, onLinkClick)}
    </Fragment>
  ))
  const dataAttrs = glossaryDataAttributes(node.data)
  if (node.tag === 'br') return <br key={key} />
  if (node.tag === 'a') {
    if (node.linkQuery && onLinkClick) {
      return (
        <span
          key={key}
          className="word-popup-sc-link word-popup-sc-link--clickable"
          style={node.style}
          role="button"
          tabIndex={0}
          onClick={() => onLinkClick(node.linkQuery!)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') onLinkClick(node.linkQuery!)
          }}
          {...dataAttrs}
        >
          {children}
        </span>
      )
    }
    return (
      <span key={key} className="word-popup-sc-link" style={node.style} {...dataAttrs}>
        {children}
      </span>
    )
  }
  const Tag = node.tag as keyof React.JSX.IntrinsicElements
  return (
    <Tag key={key} style={node.style} {...dataAttrs}>
      {children}
    </Tag>
  )
}

/**
 * One `<style>` block per distinct dictionary among `results` that shipped
 * its own `styles.css` (see yomitanImport.ts's `readStylesCss` and
 * lookup.ts's `stylesCss` field), deduped by `dictId` and keeping first-seen
 * order. A dictionary's glossary markup (structured-content spans/divs
 * marked with `data-sc-*` attributes) often
 * relies entirely on this CSS for visual separation between sibling tag
 * chips; Yomitan itself injects no default spacing for them, so without
 * this the chips render squashed together with no gap at all.
 */
export function dictStylesheets(
  results: Pick<LookupResult, 'dictId' | 'stylesCss'>[]
): Array<{ dictId: number; css: string }> {
  const seen = new Set<number>()
  const sheets: Array<{ dictId: number; css: string }> = []
  for (const result of results) {
    if (!result.stylesCss || seen.has(result.dictId)) continue
    seen.add(result.dictId)
    sheets.push({ dictId: result.dictId, css: result.stylesCss })
  }
  return sheets
}

/**
 * Scopes a dictionary's CSS to only that dictionary's own rows. The raw
 * stylesheet comes from an untrusted, third-party dictionary zip, so it is
 * first run through `sanitizeGlossaryCss` — the same rule-by-rule sanitizer
 * the Anki-export path uses — which restricts declarations to a safe property
 * allowlist, drops `url()`/`@import`/`expression()`/`<>`, and only emits
 * `selector{decls}` for `[data-sc-*]` selectors. Because that output is parsed
 * rule-by-rule it contains no stray `}`, so wrapping it in `@scope` can no
 * longer be brace-escaped to inject app-wide rules. `@scope` (Baseline in
 * Electron's bundled Chromium) then keeps the surviving rules from leaking
 * into another dictionary's rows or the rest of the app's UI.
 *
 * Returns `''` when nothing survives sanitization, so the caller can skip
 * emitting an empty `<style>`.
 */
export function scopeDictCss(dictId: number, css: string): string {
  const safe = sanitizeGlossaryCss(css)
  if (safe === '') return ''
  return `@scope ([data-dict-id="${dictId}"]) {\n${safe}\n}`
}

export default function WordPopup({
  results,
  position,
  onClose,
  maxEntries = Infinity,
  maxMeanings = Infinity,
  onAddToAnki,
  ankiStatus = 'idle',
  ankiError,
  ankiExisting = {},
  duplicatePolicy = 'prevent-deck',
  onOpenAnkiCard,
  onLinkClick,
  onBack,
  canGoBack = false,
  provenanceByExpression
}: WordPopupProps): React.JSX.Element {
  const open = position !== null
  const shownResults = results.slice(0, maxEntries)
  const stylesheets = dictStylesheets(shownResults)

  return (
    <div
      id="word-popup"
      className={open ? 'word-popup open' : 'word-popup'}
      role="dialog"
      aria-label="Word lookup"
      aria-hidden={!open}
      style={position ? { left: position.x, top: position.y } : undefined}
    >
      <div className="word-popup-panel">
        {stylesheets.map(({ dictId, css }) => {
          const scoped = scopeDictCss(dictId, css)
          return scoped === '' ? null : <style key={dictId}>{scoped}</style>
        })}
        {results.length === 0 ? (
          <div className="word-popup-empty">No definition found</div>
        ) : (
          shownResults.map((result, index) => {
            const showFurigana = result.reading.length > 0 && result.reading !== result.expression
            const pos = posAttributes(result.rules, result.defTags)
            const pitchAccent = pitchAccentValue(result)
            const structured = parseStructuredGlossary(result.glossaryJson)
            const entries = (
              structured ? capGlossarySenses(structured, maxMeanings) : splitSenses(result.glossary)
            ).slice(0, maxMeanings)
            const priority = isHighPriority(result.termTags, result.defTags)
            const provenance = provenanceByExpression?.[result.expression]
            return (
              <div
                className="word-popup-row"
                data-testid="word-popup-row"
                data-priority={priority || undefined}
                data-dict-id={result.dictId}
                key={index}
              >
                <div className="word-popup-headword">
                  <span className="word-popup-expression">
                    {showFurigana ? (
                      <ruby>
                        {result.expression}
                        <rt className="word-popup-furigana">{result.reading}</rt>
                      </ruby>
                    ) : (
                      result.expression
                    )}
                  </span>
                  {priority && (
                    <span
                      className="word-popup-priority"
                      title="Common word"
                      aria-label="Common word"
                    >
                      &#x2605; common
                    </span>
                  )}
                  {result.frequency !== null && (
                    <span className="word-popup-frequency">
                      {result.frequencyDisplay ?? String(result.frequency)}
                    </span>
                  )}
                  {pitchAccent !== '' && (
                    <span
                      className="word-popup-pitch-accent"
                      role="note"
                      aria-label={`Pitch accent: ${pitchAccent}`}
                    >
                      Pitch {pitchAccent}
                    </span>
                  )}
                  <span className="word-popup-dict-badge">{result.dictTitle}</span>
                  {onAddToAnki &&
                    (ankiStatus !== 'idle' ? (
                      <span className="word-popup-anki-status" data-anki-status={ankiStatus}>
                        {ankiStatus === 'adding' && '…'}
                        {ankiStatus === 'added' && '✓ Added'}
                        {ankiStatus === 'updated' && '✓ Updated'}
                        {ankiStatus === 'error' && `✕ ${ankiError ?? ''}`}
                      </span>
                    ) : ankiExisting[result.expression] ? (
                      <button
                        type="button"
                        className="word-popup-anki-button word-popup-anki-button--open"
                        onClick={() =>
                          duplicatePolicy === 'overwrite'
                            ? onAddToAnki(result)
                            : onOpenAnkiCard?.(ankiExisting[result.expression].cardId)
                        }
                      >
                        {duplicatePolicy === 'overwrite' ? 'Update Anki' : 'Open in Anki'}
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="word-popup-anki-button"
                        onClick={() => onAddToAnki(result)}
                      >
                        &#xFF0B; Anki
                      </button>
                    ))}
                </div>
                {provenance?.sources.length ? (
                  <div className="word-popup-provenance" aria-label="Word knowledge sources">
                    {provenance.sources.map((source, sourceIndex) => (
                      <span
                        className={`word-popup-provenance-badge word-popup-provenance-badge--${source.source}`}
                        key={`${source.source}-${sourceIndex}`}
                      >
                        {source.source === 'wanikani'
                          ? `WaniKani${
                              source.curriculumLevel === undefined
                                ? ''
                                : ` - Level ${source.curriculumLevel}`
                            } - ${source.proficiency}`
                          : `Anki - ${source.deck} - ${source.intervalDays}d`}
                      </span>
                    ))}
                  </div>
                ) : null}
                {pos.length > 0 && (
                  <div className="word-popup-pos-row">
                    {pos.map((label) => (
                      <span className="word-popup-pos" key={label}>
                        {label}
                      </span>
                    ))}
                  </div>
                )}
                <div className="word-popup-senses">
                  {entries.map((entry, senseIndex) => {
                    const content = renderGlossaryNode(
                      entry,
                      `sense-${index}-${senseIndex}`,
                      onLinkClick
                    )
                    if (content === null) return null
                    // A single entry (the common case for a rich structured-content
                    // row that already encodes its own sense numbering internally)
                    // renders bare, so it isn't double-numbered against the dict's
                    // own numbering; multiple entries get our own badge per sense.
                    return entries.length > 1 ? (
                      <div className="word-popup-sense-group" key={senseIndex}>
                        <span className="word-popup-sense-number">{senseIndex + 1}</span>
                        <div className="word-popup-sense-content">{content}</div>
                      </div>
                    ) : (
                      <div
                        className="word-popup-sense-content word-popup-sense-content--solo"
                        key={senseIndex}
                      >
                        {content}
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })
        )}
      </div>
      {onBack && canGoBack && (
        <button
          type="button"
          className="word-popup-back"
          aria-label="Back to previous word"
          onClick={onBack}
        >
          &#x2190;
        </button>
      )}
      {onClose && (
        <button
          type="button"
          className="word-popup-close"
          aria-label="Close word lookup"
          onClick={onClose}
        >
          &#x2715;
        </button>
      )}
    </div>
  )
}
