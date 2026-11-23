import './WordPopup.css'
import type { WordPopupPosition } from '../state/wordLookup'
import { Fragment, useState } from 'react'
import { pitchAccentValue, priorityWeight, type LookupResult } from '../../../shared/dictionary'
import {
  isKnowledgeSourceDetail,
  type KnowledgeDetails,
  type KnowledgeSource
} from '../../../shared/knowledge'
import {
  capGlossarySenses,
  glossaryDataAttributes,
  parseStructuredGlossary,
  sanitizeGlossaryCss,
  type GlossaryNode
} from '../../../shared/structuredGlossary'
import type { GrammarStep } from '../../../shared/inflection'
import { patternHasAmbiguousPassive, type GrammarExample } from '../../../shared/grammarExamples'
import type { GrammarExamplesView } from '../state/useGrammarExamples'
import type { Token } from '../../../shared/token'

export interface WordPopupProps {
  results: LookupResult[]
  /** Anchor position (e.g. viewport px) near the token that was clicked/hovered. */
  position: WordPopupPosition | null
  onClose?: () => void
  /** Max dictionary entries (rows) to render. Defaults to unlimited. */
  maxEntries?: number
  /** Max meanings/senses to render per entry. Defaults to unlimited. */
  maxMeanings?: number
  /** The word the popup was opened for — forwarded verbatim in the mine request. */
  token?: Token
  /** The active cue's text — forwarded verbatim in the mine request. */
  sentence?: string
  /** Omit to hide the Anki action. */
  onAddToAnki?: (result: LookupResult) => void | Promise<void>
  /** Shared mining status replaces every row action while non-idle. */
  ankiStatus?: 'idle' | 'adding' | 'added' | 'updated' | 'error'
  ankiError?: string
  /** Shows the overwrite action when a matching card exists. */
  duplicatePolicy?: 'prevent-global' | 'prevent-deck' | 'overwrite' | 'allow'
  /** An existing card replaces the add action with an Open in Anki action. */
  ankiExisting?: Readonly<Record<string, { cardId: number }>>
  /** Opens `ankiExisting`'s card in Anki's Browse window. Only used when `ankiExisting` is set. */
  onOpenAnkiCard?: (cardId: number) => void | Promise<void>
  /** Without a resolvable target and this callback, glossary links remain non-interactive chips. */
  onLinkClick?: (term: string) => void
  /** Shown only when canGoBack is also true. */
  onBack?: () => void
  canGoBack?: boolean
  /** Supplemental knowledge-source details for the word that opened this popup. */
  provenanceByExpression?: Readonly<Record<string, KnowledgeDetails>>
  /** Stem and suffixes of the highlighted span, shown above the entry for `grammarSpan`. */
  grammarChain?: GrammarStep[]
  /** The highlighted span's head lemma and surface; an entry matching neither gets no chain. */
  grammarSpan?: { lemma: string; surface: string }
  onOpenGrammarSource?: (url: string) => void
  /** Tatoeba sentences with the same pattern, shown under the grammar chain. */
  grammarExamples?: GrammarExamplesView
}

/** Plain glossaries store senses separated by newlines. */
function splitSenses(glossary: string): string[] {
  return glossary
    .split('\n')
    .map((sense) => sense.trim())
    .filter((sense) => sense.length > 0)
}

/** Common-word markers are exact tags, including Jitendex's ★, not substrings. */
function isHighPriority(termTags: string, defTags = ''): boolean {
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

function posAttributes(rules: string, defTags: string): string[] {
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

interface KnowledgeSourceBadge {
  source: KnowledgeSource
  label: string
  detailed: boolean
}

const KNOWLEDGE_SOURCE_ORDER = ['wanikani', 'anki'] as const

/**
 * Builds the source badges shown for one word. `sourceKinds` is authoritative
 * because detailed metadata is optional and may be absent or malformed.
 */
function knowledgeSourceBadges(provenance: KnowledgeDetails | undefined): KnowledgeSourceBadge[] {
  if (!provenance) return []

  return KNOWLEDGE_SOURCE_ORDER.flatMap((sourceKind): KnowledgeSourceBadge[] => {
    if (!provenance.sourceKinds.includes(sourceKind)) return []

    const details = provenance.sources.filter(
      (source) => source.source === sourceKind && isKnowledgeSourceDetail(source)
    )
    if (details.length === 0) {
      return [
        {
          source: sourceKind,
          label: sourceKind === 'wanikani' ? 'WaniKani' : 'Anki',
          detailed: false
        }
      ]
    }

    return details.map((source) => ({
      source: sourceKind,
      label:
        source.source === 'wanikani'
          ? `WaniKani${
              source.curriculumLevel === undefined ? '' : ` - Level ${source.curriculumLevel}`
            } - ${source.proficiency}`
          : `Anki - ${source.deck} - ${source.intervalDays}d`,
      detailed: true
    }))
  })
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

/** Dictionary CSS supplies spacing for structured-content chips; emit it once per dictionary. */
function dictStylesheets(
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

/** Sanitize untrusted CSS before @scope wrapping: stray braces could escape into app-wide rules. */
function scopeDictCss(dictId: number, css: string): string {
  const safe = sanitizeGlossaryCss(css)
  if (safe === '') return ''
  return `@scope ([data-dict-id="${dictId}"]) {\n${safe}\n}`
}

function grammarStepName(step: GrammarStep): string {
  const contraction = step.contractionOf ? ` Contraction of ${step.contractionOf}.` : ''
  const explanation = step.explanation ? ` ${step.explanation}` : ''
  return `${step.surface}: ${step.label}.${explanation}${contraction}`
}

function GrammarChainRow({
  steps,
  onOpenSource
}: {
  steps: GrammarStep[]
  onOpenSource?: (url: string) => void
}): React.JSX.Element {
  const [activeIndex, setActiveIndex] = useState<number | null>(null)
  const active = activeIndex === null ? undefined : steps[activeIndex]
  return (
    <div
      className="word-popup-grammar"
      data-testid="word-popup-grammar"
      onMouseLeave={(event) => {
        if (!event.currentTarget.contains(document.activeElement)) setActiveIndex(null)
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setActiveIndex(null)
      }}
    >
      <div className="word-popup-grammar-parts" role="group" aria-label="Grammar breakdown">
        {steps.map((step, index) => (
          <Fragment key={index}>
            {index > 0 && (
              <span className="word-popup-grammar-joint" aria-hidden="true">
                ─
              </span>
            )}
            <button
              type="button"
              className={
                typeof step.kind === 'object'
                  ? 'word-popup-grammar-part word-popup-grammar-part--stem'
                  : 'word-popup-grammar-part'
              }
              aria-label={grammarStepName(step)}
              onMouseEnter={() => setActiveIndex(index)}
              onFocus={() => setActiveIndex(index)}
              onClick={() => setActiveIndex(index)}
            >
              <span className="word-popup-grammar-surface">{step.surface}</span>
              <span className="word-popup-grammar-label">{step.label}</span>
            </button>
          </Fragment>
        ))}
      </div>
      {active && (
        <div className="word-popup-grammar-detail" role="note">
          {active.explanation && (
            <div className="word-popup-grammar-explanation">{active.explanation}</div>
          )}
          {active.contractionOf && (
            <div className="word-popup-grammar-contraction">
              contraction of {active.contractionOf}
            </div>
          )}
          <div className="word-popup-grammar-source">
            Source:{' '}
            {onOpenSource ? (
              <button
                type="button"
                className="word-popup-grammar-source-link"
                onClick={() => onOpenSource(active.source.url)}
              >
                {active.source.name}
              </button>
            ) : (
              active.source.name
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function ExampleSentence({
  example,
  onOpen
}: {
  example: GrammarExample
  onOpen: (tatoebaId: number) => void
}): React.JSX.Element {
  const { japanese, start, end } = example
  return (
    <li
      className="word-popup-example"
      data-testid="word-popup-example"
      data-same-word={example.sameWord || undefined}
    >
      <div className="word-popup-example-japanese" lang="ja">
        {japanese.slice(0, start)}
        <mark className="word-popup-example-match">{japanese.slice(start, end)}</mark>
        {japanese.slice(end)}
        {example.sameWord && <span className="word-popup-example-same">same word</span>}
      </div>
      <div className="word-popup-example-english">
        &ldquo;{example.english}&rdquo;{' '}
        <button
          type="button"
          className="word-popup-example-source"
          title="Tatoeba, CC BY 2.0 FR"
          aria-label={`Open sentence ${example.tatoebaId} on Tatoeba (CC BY 2.0 FR)`}
          onClick={() => onOpen(example.tatoebaId)}
        >
          Tatoeba &#x2197;
        </button>
      </div>
    </li>
  )
}

function GrammarExamplesList({ view }: { view: GrammarExamplesView }): React.JSX.Element {
  const remaining = view.total - view.examples.length
  const expanded = view.examples.length > 2
  return (
    <section
      className="word-popup-examples"
      aria-label="Example sentences"
      data-testid="word-popup-examples"
    >
      {view.sameWordTotal === 0 && (
        <div className="word-popup-examples-note">
          No example with this word; showing the same pattern with other words
        </div>
      )}
      {patternHasAmbiguousPassive(view.patternKey) && (
        <div className="word-popup-examples-note">Examples may show either meaning</div>
      )}
      <ol
        className={
          expanded
            ? 'word-popup-examples-list word-popup-examples-list--expanded'
            : 'word-popup-examples-list'
        }
      >
        {view.examples.map((example, index) => (
          <ExampleSentence
            key={`${example.tatoebaId}-${example.start}-${index}`}
            example={example}
            onOpen={view.openSentence}
          />
        ))}
      </ol>
      {remaining > 0 && (
        <button
          type="button"
          className="word-popup-examples-more"
          disabled={view.loading}
          onClick={view.loadMore}
        >
          More examples ({remaining})
        </button>
      )}
    </section>
  )
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
  provenanceByExpression,
  grammarChain = [],
  grammarSpan,
  onOpenGrammarSource,
  grammarExamples
}: WordPopupProps): React.JSX.Element {
  const open = position !== null
  const shownResults = results.slice(0, maxEntries)
  const stylesheets = dictStylesheets(shownResults)
  // A compound or prefix entry (生き for 生き返った) must not show the conjugated word's chain.
  const grammarEntryIndex =
    grammarChain.length > 0 && grammarSpan
      ? shownResults.findIndex(
          (result) =>
            result.expression === grammarSpan.lemma || result.matchedSurface === grammarSpan.surface
        )
      : -1

  return (
    <div
      id="word-popup"
      className={open ? 'word-popup open' : 'word-popup'}
      role="dialog"
      aria-label="Word lookup"
      aria-hidden={!open}
      data-placement={position?.placement}
      style={position ? { left: position.x, top: position.y } : undefined}
      onClick={(event) => event.stopPropagation()}
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
            const sourceBadges = knowledgeSourceBadges(provenance)
            return (
              <Fragment key={index}>
                {index === grammarEntryIndex && (
                  <GrammarChainRow
                    // A new word resets the selected part.
                    key={grammarChain.map((step) => step.surface).join('|')}
                    steps={grammarChain}
                    onOpenSource={onOpenGrammarSource}
                  />
                )}
                {index === grammarEntryIndex && grammarExamples && (
                  <GrammarExamplesList view={grammarExamples} />
                )}
                <div
                  className="word-popup-row"
                  data-testid="word-popup-row"
                  data-priority={priority || undefined}
                  data-dict-id={result.dictId}
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
                    {result.jlptLevel !== null && (
                      <span
                        className="word-popup-jlpt-level"
                        role="note"
                        aria-label={`Approximate JLPT vocabulary level: ${result.jlptLevel}`}
                        title="Community-sourced estimate; the JLPT does not publish official vocabulary lists."
                      >
                        JLPT {result.jlptLevel} · approx.
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
                  {sourceBadges.length > 0 ? (
                    <div className="word-popup-provenance" aria-label="Word knowledge sources">
                      {sourceBadges.map((badge, badgeIndex) => (
                        <span
                          className={`word-popup-provenance-badge word-popup-provenance-badge--${badge.source}`}
                          key={`${badge.source}-${badgeIndex}`}
                        >
                          {badge.label}
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
                      // A structured-content entry may number its own senses; do not double-number it.
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
              </Fragment>
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
