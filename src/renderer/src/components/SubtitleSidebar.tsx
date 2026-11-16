import './SubtitleSidebar.css'
import { Fragment, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Cue } from '../../../shared/cue'
import type { Token } from '../../../shared/token'
import type { KnowledgeLevel } from '../../../shared/knowledge'
import { cueKey } from '../state/tokenization'
import InteractiveText from './InteractiveText'
import {
  findMatches,
  stepMatch,
  highlightSegments,
  type SearchMatch,
  type HighlightSegment
} from '../state/sidebarSearch'
import { SubtitleSearchDebounce } from '../state/subtitleSearchDebounce'
import type { VocabularySpan } from '../state/vocabularySpans'
import { useSidebarTranslation } from '../state/useSidebarTranslation'
import SubtitleTranslationPopup from './SubtitleTranslationPopup'
import { useLatestCallback, useLatestRef } from '../state/useLatestRef'

const COPY_TOAST_MS = 1200

/** Shared by every row without a search match, so memoized rows see a stable prop. */
const NO_MATCHES: SearchMatch[] = []
const NO_TOKENS: Token[] = []

export interface SubtitleSidebarProps {
  cues: Cue[]
  /** `cueKey` of the currently-active cue (see App.tsx), or undefined if none. */
  activeCueKey?: string
  /** Missing cue tokenization renders as plain text. */
  tokens: Record<string, Token[]>
  /** Undefined disables coloring; an empty map enables it with 'unknown' as the default. */
  levels?: Record<string, KnowledgeLevel>
  /** Pass only this cue’s projections so changes in other cues do not re-render the row. */
  spansForCue?: (cueKey: string) => VocabularySpan[] | undefined
  onSelectCue: (cue: Cue) => void
  onCopyCue?: (cue: Cue) => void
  /** Translates the full cue text after it has been copied. When absent,
   * right-click keeps the original short-lived copy toast. */
  onTranslateCue?: (cue: Cue, requestId: string) => Promise<string>
  createTranslationRequestId?: () => string
  onCancelTranslation?: (requestId: string) => void
  /** Root element ref, so the caller can measure the sidebar's rendered width
   * for the mpv video-margin-ratio-right inset (see computeVideoMargins). */
  containerRef?: React.RefObject<HTMLElement | null>
}

/** A callback ref scrolls on mount, including when the sidebar reopens. */
function scrollRowIntoView(el: HTMLElement | null): void {
  el?.scrollIntoView({ block: 'center' })
}

/** The input must also stop propagation so typing cannot trigger player shortcuts. */
function searchKeyAction(
  key: string,
  shiftKey: boolean,
  searchActive: boolean
): 'search' | 'next' | 'previous' | 'close' | undefined {
  if (key === 'Enter') {
    if (!searchActive) return 'search'
    return shiftKey ? 'previous' : 'next'
  }
  if (key === 'Escape') return 'close'
  return undefined
}

function matchCounterText(query: string, currentIndex: number, totalMatches: number): string {
  if (query.trim().length === 0) return ''
  if (totalMatches === 0) return '0/0'
  return `${currentIndex + 1}/${totalMatches}`
}

/** Segment offsets refer to the supplied text slice. */
function renderSegments(
  text: string,
  segments: HighlightSegment[],
  keyPrefix: string
): React.ReactNode {
  if (segments.length === 0) return null
  if (segments.length === 1 && segments[0].kind === 'plain') return text
  return segments.map((seg, i) => {
    const slice = text.slice(seg.start, seg.end)
    if (seg.kind === 'plain') return <Fragment key={`${keyPrefix}-${i}`}>{slice}</Fragment>
    return (
      <mark key={`${keyPrefix}-${i}`} data-current={seg.kind === 'currentMatch' ? '' : undefined}>
        {slice}
      </mark>
    )
  })
}

/** Rebase cue-wide segments to the sub-range; source segments must fully partition the cue. */
function clipSegments(
  segments: HighlightSegment[],
  rangeStart: number,
  rangeLength: number
): HighlightSegment[] {
  const rangeEnd = rangeStart + rangeLength
  const clipped: HighlightSegment[] = []
  for (const seg of segments) {
    const start = Math.max(seg.start, rangeStart)
    const end = Math.min(seg.end, rangeEnd)
    if (start < end)
      clipped.push({ start: start - rangeStart, end: end - rangeStart, kind: seg.kind })
  }
  return clipped
}

function CueRowContent({
  cue,
  rowTokens,
  levels,
  vocabularySpans,
  matches,
  currentMatch
}: {
  cue: Cue
  rowTokens: Token[]
  levels?: Record<string, KnowledgeLevel>
  vocabularySpans?: VocabularySpan[]
  matches: SearchMatch[]
  currentMatch?: SearchMatch
}): React.JSX.Element {
  const segments = highlightSegments(cue.text.length, matches, currentMatch)
  return (
    <InteractiveText
      id={cueKey(cue)}
      text={cue.text}
      tokens={rowTokens}
      levels={levels}
      vocabularySpans={vocabularySpans}
      renderLine={(line, offset, lineIndex) =>
        renderSegments(line, clipSegments(segments, offset, line.length), `l${lineIndex}`)
      }
      renderTokenContent={(token, itemIndex, fragment) =>
        renderSegments(
          fragment.text,
          // Search offsets use display text, not line-break-free tokenization offsets.
          clipSegments(segments, fragment.displayStartOffset, fragment.text.length),
          `t${itemIndex}`
        )
      }
    />
  )
}

function SidebarRowView({
  cue,
  isActive,
  rowTokens,
  levels,
  vocabularySpans,
  matches,
  currentMatch,
  onSelectCue,
  onCopyCue,
  liRef
}: {
  cue: Cue
  isActive: boolean
  rowTokens: Token[]
  levels?: Record<string, KnowledgeLevel>
  vocabularySpans?: VocabularySpan[]
  matches: SearchMatch[]
  currentMatch?: SearchMatch
  onSelectCue: (cue: Cue) => void
  onCopyCue?: (cue: Cue) => void
  /** Stable ref for the enclosing `<li>`; it reads the row's key from
   * `data-cue-key` (see SubtitleSidebar's `rowElsRef`). */
  liRef?: (el: HTMLLIElement | null) => void | (() => void)
}): React.JSX.Element {
  return (
    <li ref={liRef} data-cue-key={cueKey(cue)}>
      <button
        type="button"
        className="subtitle-sidebar-row"
        data-active={isActive ? '' : undefined}
        ref={isActive ? scrollRowIntoView : undefined}
        onClick={() => onSelectCue(cue)}
        onContextMenu={(event) => {
          event.preventDefault()
          onCopyCue?.(cue)
        }}
      >
        <CueRowContent
          cue={cue}
          rowTokens={rowTokens}
          levels={levels}
          vocabularySpans={vocabularySpans}
          matches={matches}
          currentMatch={currentMatch}
        />
      </button>
    </li>
  )
}

/** Memoized row: with stable props, an active-cue change re-renders only the
 * previously and newly active rows, not the whole track. */
const SidebarRow = memo(SidebarRowView)

export default function SubtitleSidebar({
  cues,
  activeCueKey,
  tokens,
  levels,
  spansForCue,
  onSelectCue,
  onCopyCue,
  onTranslateCue,
  createTranslationRequestId,
  onCancelTranslation,
  containerRef
}: SubtitleSidebarProps): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [searchedQuery, setSearchedQuery] = useState('')
  const [currentIndex, setCurrentIndex] = useState(0)
  const [navNonce, setNavNonce] = useState(0)

  const isFirstNavRef = useRef(true)
  const debounceRef = useRef<SubtitleSearchDebounce | null>(null)
  const [copyToastAnchor, setCopyToastAnchor] = useState<{ top: number; left: number } | null>(null)
  const copyToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const {
    popup: translationPopup,
    position: translationPopupPosition,
    popupElementRef: translationPopupElementRef,
    rowElementsRef: rowElsRef,
    openTranslation,
    closeTranslation
  } = useSidebarTranslation({
    cues,
    onTranslateCue,
    createTranslationRequestId,
    onCancelTranslation
  })

  function commitSearch(nextQuery: string): void {
    setSearchedQuery(nextQuery)
    setCurrentIndex(0)
  }

  if (debounceRef.current === null) debounceRef.current = new SubtitleSearchDebounce(commitSearch)

  const matches = useMemo(() => findMatches(cues, searchedQuery), [cues, searchedQuery])
  const matchesByCue = useMemo(() => {
    const byCue = new Map<string, SearchMatch[]>()
    for (const match of matches) {
      const list = byCue.get(match.cueKey)
      if (list) list.push(match)
      else byCue.set(match.cueKey, [match])
    }
    return byCue
  }, [matches])
  const searchActive = searchedQuery.trim().length > 0

  // Cancel the old track’s debounce before resetting so it cannot update the replacement track.
  useEffect(() => {
    const debounce = debounceRef.current!
    return () => {
      debounce.cancel()
      setQuery('')
      commitSearch('')
    }
  }, [cues])

  // Scroll only for explicit navigation, not result changes or the initial render.
  const displayIndex = matches.length > 0 ? Math.min(currentIndex, matches.length - 1) : 0
  const currentMatch = matches.length > 0 ? matches[displayIndex] : undefined
  const currentMatchKeyRef = useLatestRef(currentMatch?.cueKey)

  useEffect(() => {
    if (isFirstNavRef.current) {
      isFirstNavRef.current = false
      return
    }
    const key = currentMatchKeyRef.current
    scrollRowIntoView(key === undefined ? null : (rowElsRef.current!.get(key) ?? null))
  }, [navNonce, currentMatchKeyRef, rowElsRef])

  function navigate(dir: 1 | -1): void {
    setCurrentIndex((i) => stepMatch(i, matches.length, dir))
    setNavNonce((n) => n + 1)
  }

  function closeSearch(): void {
    setQuery('')
    debounceRef.current!.flush('')
  }

  // Snapshot the row position so the copy toast stays anchored even if filtering unmounts the row.
  function handleCopyCue(cue: Cue): void {
    onCopyCue?.(cue)
    if (onTranslateCue) {
      openTranslation(cue)
      return
    }

    const rect = rowElsRef.current!.get(cueKey(cue))?.getBoundingClientRect()
    const anchor = rect ? { top: rect.top, left: rect.left + rect.width / 2 } : { top: 0, left: 0 }
    setCopyToastAnchor(rect ? anchor : null)
    if (copyToastTimerRef.current !== null) clearTimeout(copyToastTimerRef.current)
    copyToastTimerRef.current = setTimeout(() => setCopyToastAnchor(null), COPY_TOAST_MS)
  }

  useEffect(() => {
    return () => {
      if (copyToastTimerRef.current !== null) clearTimeout(copyToastTimerRef.current)
    }
  }, [])

  // Stable identities for the memoized rows: the caller's handlers are
  // usually recreated on every App render (i.e. every active-cue change).
  const selectCue = useLatestCallback(onSelectCue)
  const copyCue = useLatestCallback(handleCopyCue)
  const rowCopyHandler = onCopyCue || onTranslateCue ? copyCue : undefined
  const rowRef = useCallback(
    (el: HTMLLIElement | null) => {
      const key = el?.dataset.cueKey
      if (!el || key === undefined) return
      const rows = rowElsRef.current!
      rows.set(key, el)
      return () => {
        if (rows.get(key) === el) rows.delete(key)
      }
    },
    [rowElsRef]
  )

  return (
    <aside id="subtitle-sidebar" aria-label="All subtitles" ref={containerRef}>
      {copyToastAnchor && (
        <div
          id="subtitle-sidebar-copy-toast"
          role="status"
          style={{ top: copyToastAnchor.top, left: copyToastAnchor.left }}
        >
          Copied to clipboard
        </div>
      )}
      {translationPopup && (
        <SubtitleTranslationPopup
          popup={translationPopup}
          position={translationPopupPosition}
          popupRef={translationPopupElementRef}
          onClose={closeTranslation}
        />
      )}
      <div id="subtitle-sidebar-header">
        <div className="subtitle-sidebar-search-row">
          <input
            type="text"
            aria-label="Search query"
            value={query}
            onChange={(event) => {
              const nextQuery = event.target.value
              setQuery(nextQuery)
              debounceRef.current!.update(nextQuery)
            }}
            onKeyDown={(event) => {
              event.stopPropagation()
              const action = searchKeyAction(event.key, event.shiftKey, searchActive)
              if (action === 'search') {
                event.preventDefault()
                debounceRef.current!.flush(query)
              }
              if (action === 'next' || action === 'previous') {
                event.preventDefault()
                navigate(action === 'next' ? 1 : -1)
              } else if (action === 'close') {
                closeSearch()
              }
            }}
          />
          {searchActive ? (
            <>
              <span className="subtitle-sidebar-search-count">
                {matchCounterText(searchedQuery, displayIndex, matches.length)}
              </span>
              <button
                type="button"
                aria-label="Previous match"
                disabled={matches.length === 0}
                onClick={() => navigate(-1)}
              >
                ▲
              </button>
              <button
                type="button"
                aria-label="Next match"
                disabled={matches.length === 0}
                onClick={() => navigate(1)}
              >
                ▼
              </button>
              <button type="button" aria-label="Clear search" onClick={closeSearch}>
                ✕
              </button>
            </>
          ) : (
            <button
              type="button"
              aria-label="Search subtitles"
              onClick={() => debounceRef.current!.flush(query)}
            >
              Search
            </button>
          )}
        </div>
      </div>

      {cues.length === 0 ? (
        <p id="subtitle-sidebar-empty">No subtitles loaded.</p>
      ) : (
        <ul>
          {cues.map((cue) => {
            const key = cueKey(cue)
            return (
              <SidebarRow
                key={key}
                cue={cue}
                isActive={key === activeCueKey}
                rowTokens={tokens[key] ?? NO_TOKENS}
                levels={levels}
                vocabularySpans={spansForCue?.(key)}
                matches={matchesByCue.get(key) ?? NO_MATCHES}
                currentMatch={currentMatch?.cueKey === key ? currentMatch : undefined}
                onSelectCue={selectCue}
                onCopyCue={rowCopyHandler}
                liRef={rowRef}
              />
            )
          })}
        </ul>
      )}
    </aside>
  )
}
