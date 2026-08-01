import './SubtitleSidebar.css'
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Cue } from '../../../shared/cue'
import type { Token } from '../../../shared/token'
import type { KnowledgeLevel } from '../../../shared/knowledge'
import { cueKey } from '../state/tokenization'
import { tokenSpans, tokenLevel } from './SubtitleOverlay'
import {
  findMatches,
  stepMatch,
  highlightSegments,
  type SearchMatch,
  type HighlightSegment
} from '../state/sidebarSearch'
import { SubtitleSearchDebounce } from '../state/subtitleSearchDebounce'
import type { VocabularySpan } from '../state/vocabularySpans'
import { useLatestCallback } from '../state/useLatestRef'

// Presentational side panel: lists every cue of the current subtitle track,
// highlights whichever one is active, and jumps playback to a clicked row.
// Derived almost entirely from props; the one exception is the always-visible
// search bar (draft query, submitted query, current-match index), which is
// ephemeral UI state scoped to this component.

/** How long the "Copied to clipboard" toast stays up after a right-click copy. */
const COPY_TOAST_MS = 1200

export interface SubtitleSidebarProps {
  cues: Cue[]
  /** `cueKey` of the currently-active cue (see App.tsx), or undefined if none. */
  activeCueKey?: string
  /** Whole-track tokenization, keyed by `cueKey` — see `tokenizeAllCues`.
   * A cue missing from this map (not yet tokenized) falls back to plain text. */
  tokens: Record<string, Token[]>
  /** Same shape/semantics as SubtitleOverlay's `levels` prop: undefined disables
   * coloring, an object (even `{}`) enables it with 'unknown' as the default. */
  levels?: Record<string, KnowledgeLevel>
  /** Compound projections for all cues, keyed internally by each span's cue key. */
  vocabularySpans?: VocabularySpan[]
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

export interface TranslationPopup {
  anchor: { top: number; left: number }
  cueKey: string
  status: 'loading' | 'done' | 'error'
  text?: string
}

export interface TranslationPopupPlacement {
  top: number
  left: number
  placement: 'above' | 'below'
}

export interface PopupAnchorRect {
  top: number
  left: number
  width: number
  bottom: number
}

export interface PopupSize {
  width: number
  height: number
}

/** Pure viewport-safe geometry for the translated-cue popup. */
export function placeTranslationPopup(
  anchorRect: PopupAnchorRect,
  popupSize: PopupSize,
  viewportSize: PopupSize,
  margin = 8
): TranslationPopupPlacement {
  const clamp = (value: number, minimum: number, maximum: number): number =>
    Math.min(Math.max(value, minimum), Math.max(minimum, maximum))
  const left = clamp(
    anchorRect.left + anchorRect.width / 2 - popupSize.width / 2,
    margin,
    viewportSize.width - popupSize.width - margin
  )
  const aboveTop = anchorRect.top - popupSize.height - margin
  const placement = aboveTop >= margin ? 'above' : 'below'
  const preferredTop = placement === 'above' ? aboveTop : anchorRect.bottom + margin
  return {
    top: clamp(preferredTop, margin, viewportSize.height - popupSize.height - margin),
    left,
    placement
  }
}

export interface TranslationPopupController {
  open(
    cueKey: string,
    anchor: TranslationPopup['anchor'],
    translate: (requestId: string) => Promise<string>
  ): void
  close(): void
}

/** Owns the popup's cue-local cache and latest-request-wins guard. Kept apart
 * from React so the async edge cases remain directly testable. */
export function createTranslationPopupController(
  setPopup: (popup: TranslationPopup | null) => void,
  createRequestId: () => string,
  cancel: (requestId: string) => void
): TranslationPopupController {
  const cache = new Map<string, string>()
  let popup: TranslationPopup | null = null
  let requestNonce = 0
  let activeRequestId: string | undefined

  function set(next: TranslationPopup | null): void {
    popup = next
    setPopup(next)
  }

  function cancelActiveRequest(): void {
    if (activeRequestId === undefined) return
    const requestId = activeRequestId
    activeRequestId = undefined
    cancel(requestId)
  }

  return {
    open(cueKey, anchor, translate): void {
      if (popup?.cueKey === cueKey && popup.status === 'loading') return

      const cached = cache.get(cueKey)
      if (cached !== undefined) {
        cancelActiveRequest()
        requestNonce++
        set({ anchor, cueKey, status: 'done', text: cached })
        return
      }

      cancelActiveRequest()
      const request = ++requestNonce
      const requestId = createRequestId()
      activeRequestId = requestId
      set({ anchor, cueKey, status: 'loading' })
      void translate(requestId).then(
        (text) => {
          if (request !== requestNonce) return
          if (activeRequestId === requestId) activeRequestId = undefined
          cache.set(cueKey, text)
          set({ anchor, cueKey, status: 'done', text })
        },
        () => {
          if (request !== requestNonce) return
          if (activeRequestId === requestId) activeRequestId = undefined
          set({ anchor, cueKey, status: 'error' })
        }
      )
    },

    close(): void {
      requestNonce++
      cancelActiveRequest()
      set(null)
    }
  }
}

/** Pure: scrolls the active row into the middle of the sidebar's scroll
 * container. Wired as the active row's callback ref (React invokes it once
 * the button mounts), so the currently-playing subtitle is visible right
 * when the panel opens — SubtitleSidebar unmounts/remounts on every
 * App.tsx sidebarOpen toggle, so "mounts" and "opens" are the same event. */
export function scrollRowIntoView(el: HTMLElement | null): void {
  el?.scrollIntoView({ block: 'center' })
}

/** Pure: what the search input's Enter/Shift+Enter/Escape should do,
 * factored out of the `onKeyDown` handler so the decision itself is
 * testable without a live keyboard event (see the input's `onKeyDown`,
 * which always calls `stopPropagation()` regardless of this result — that
 * part keeps every keystroke, including plain letters and Space, from
 * reaching App.tsx's window-level keybinding handler). */
export function searchKeyAction(
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

/** Pure: the search row's live counter text — '' while the query is blank
 * (nothing to count), '0/0' when the query has no matches, else 1-based
 * "current/total". */
export function matchCounterText(
  query: string,
  currentIndex: number,
  totalMatches: number
): string {
  if (query.trim().length === 0) return ''
  if (totalMatches === 0) return '0/0'
  return `${currentIndex + 1}/${totalMatches}`
}

/** Pure: splits `text` (already the exact slice a segment set was computed
 * for) into plain runs and `<mark>` runs per `segments`. A lone 'plain'
 * segment covering the whole text renders as the bare string, so a row with
 * no active search collapses back to the original unmarked output. */
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

/** Pure: clips cue-wide `segments` (offsets into the full cue text) down to
 * a sub-range [rangeStart, rangeStart + rangeLength), rebased to be
 * relative to that sub-range. Segments already fully partition their
 * source range, so intersecting with a sub-range yields a full partition
 * of it too — no gap-filling needed. */
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

/** Pure: a cue's text split on '\n', each line paired with its start offset
 * into the raw cue text (for rebasing highlight segments per line). */
function linesWithOffsets(text: string): Array<{ line: string; offset: number }> {
  const lines = text.split('\n')
  let offset = 0
  return lines.map((line) => {
    const entry = { line, offset }
    offset += line.length + 1
    return entry
  })
}

/** Pure: renders one cue's text as line-broken plain text (tokens not yet
 * available) or as knowledge-colored token spans (tokens available), with
 * `matches`/`currentMatch` (already filtered to this cue) wrapped in
 * `<mark>`. Exported for direct testing, same as `scrollRowIntoView`. */
export function CueRowContent({
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
  const projectedLevels = new Map(
    vocabularySpans
      ?.filter((span) => span.cueKey === cueKey(cue))
      .flatMap((span) => span.memberTokenOffsets.map((offset) => [offset, span.level] as const))
  )

  if (rowTokens.length === 0) {
    return (
      <>
        {linesWithOffsets(cue.text).map(({ line, offset }, i) => (
          <span key={i}>
            {i > 0 && <br />}
            {renderSegments(line, clipSegments(segments, offset, line.length), `l${i}`)}
          </span>
        ))}
      </>
    )
  }

  const spans = tokenSpans(cue.text, rowTokens)
  return (
    <>
      {spans.map((item, i) =>
        item.type === 'break' ? (
          <br key={i} />
        ) : (
          <span
            key={i}
            data-level={tokenLevel(item.token, levels, projectedLevels.get(item.token.startOffset))}
          >
            {renderSegments(
              item.token.surface,
              clipSegments(segments, item.token.startOffset, item.token.surface.length),
              `t${i}`
            )}
          </span>
        )
      )}
    </>
  )
}

/** Presentational, hook-free row: one cue's clickable button. Kept separate
 * from `SubtitleSidebar` (which owns the search state and calls hooks) so it
 * can be invoked directly in tests. */
export function SidebarRow({
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
  /** Ref for the enclosing `<li>`, used only by the current-match row's
   * scroll-into-view effect (see SubtitleSidebar). */
  liRef?: (el: HTMLLIElement | null) => void
}): React.JSX.Element {
  return (
    <li ref={liRef}>
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

export default function SubtitleSidebar({
  cues,
  activeCueKey,
  tokens,
  levels,
  vocabularySpans,
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

  const currentMatchRowRef = useRef<HTMLElement | null>(null)
  const isFirstNavRef = useRef(true)
  const debounceRef = useRef<SubtitleSearchDebounce | null>(null)
  const rowElsRef = useRef<Map<string, HTMLLIElement> | null>(null)
  const [copyToastAnchor, setCopyToastAnchor] = useState<{ top: number; left: number } | null>(null)
  const copyToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [translationPopup, setTranslationPopup] = useState<TranslationPopup | null>(null)
  const [translationPopupPosition, setTranslationPopupPosition] =
    useState<TranslationPopupPlacement | null>(null)
  const translationPopupElementRef = useRef<HTMLDivElement | null>(null)
  const createRequestId = useLatestCallback(
    (): string => createTranslationRequestId?.() ?? crypto.randomUUID()
  )
  const cancelTranslation = useLatestCallback((requestId: string): void =>
    onCancelTranslation?.(requestId)
  )

  if (rowElsRef.current === null) rowElsRef.current = new Map()
  // Created once per mount; the callbacks read the latest props through the
  // mirrors above instead of being rebuilt with the controller.
  const [translationPopupController] = useState<TranslationPopupController>(() =>
    createTranslationPopupController(
      (popup) => {
        setTranslationPopupPosition(null)
        setTranslationPopup(popup)
      },
      createRequestId,
      cancelTranslation
    )
  )

  function commitSearch(nextQuery: string): void {
    setSearchedQuery(nextQuery)
    setCurrentIndex(0)
  }

  if (debounceRef.current === null) debounceRef.current = new SubtitleSearchDebounce(commitSearch)

  const matches = useMemo(() => findMatches(cues, searchedQuery), [cues, searchedQuery])
  const searchActive = searchedQuery.trim().length > 0

  // A new match list (submitted-query edit or track change) always starts back
  // at the first match — but must never itself trigger the nav-scroll effect
  // below. Every path that produces a new list goes through `commitSearch`
  // (query edits) or the track reset below, so the index is reset there rather
  // than from an effect watching `matches`.

  // A new subtitle track owns a fresh query. Cancelling first keeps an old
  // track's timer from applying its draft to the replacement track; running
  // the reset as this effect's cleanup means it fires on exactly the same
  // track changes as before, and the debounce cancel still covers unmount.
  useEffect(() => {
    const debounce = debounceRef.current!
    const controller = translationPopupController
    return () => {
      debounce.cancel()
      setQuery('')
      commitSearch('')
      controller.close()
    }
  }, [cues, translationPopupController])

  // Scrolls the current-match row into view, but only for explicit
  // next/previous navigation (navNonce bumps), never merely because the
  // match list changed underneath — and never on the very first render.
  useEffect(() => {
    if (isFirstNavRef.current) {
      isFirstNavRef.current = false
      return
    }
    scrollRowIntoView(currentMatchRowRef.current)
  }, [navNonce])

  const displayIndex = matches.length > 0 ? Math.min(currentIndex, matches.length - 1) : 0
  const currentMatch = matches.length > 0 ? matches[displayIndex] : undefined

  function navigate(dir: 1 | -1): void {
    setCurrentIndex((i) => stepMatch(i, matches.length, dir))
    setNavNonce((n) => n + 1)
  }

  function closeSearch(): void {
    setQuery('')
    debounceRef.current!.flush('')
  }

  // Right-click-to-copy feedback: a small self-dismissing toast anchored
  // above the row that was copied, using that row's own rect (via
  // rowElsRef) rather than the click coordinates — same idea as WordPopup
  // anchoring to the subtitle box. Captured once at copy time, so it stays
  // put even if that row later unmounts from a search re-filter while the
  // toast is still up. Re-copying restarts the clock instead of stacking
  // timers.
  function handleCopyCue(cue: Cue): void {
    onCopyCue?.(cue)
    const rect = rowElsRef.current!.get(cueKey(cue))?.getBoundingClientRect()
    const anchor = rect ? { top: rect.top, left: rect.left + rect.width / 2 } : { top: 0, left: 0 }
    if (onTranslateCue) {
      translationPopupController.open(cueKey(cue), anchor, (requestId) =>
        onTranslateCue(cue, requestId)
      )
      return
    }

    setCopyToastAnchor(rect ? anchor : null)
    if (copyToastTimerRef.current !== null) clearTimeout(copyToastTimerRef.current)
    copyToastTimerRef.current = setTimeout(() => setCopyToastAnchor(null), COPY_TOAST_MS)
  }

  useEffect(() => {
    return () => {
      if (copyToastTimerRef.current !== null) clearTimeout(copyToastTimerRef.current)
      translationPopupController.close()
    }
  }, [translationPopupController])

  // Re-measure only when popup content changes or the viewport resizes. Scrolling
  // deliberately does not trigger layout work; a vanished row closes the popup.
  useLayoutEffect(() => {
    if (!translationPopup) return
    const reposition = (): void => {
      const anchor = rowElsRef.current!.get(translationPopup.cueKey)?.getBoundingClientRect()
      const popup = translationPopupElementRef.current?.getBoundingClientRect()
      if (!anchor || !popup) {
        translationPopupController.close()
        return
      }
      const next = placeTranslationPopup(anchor, popup, {
        width: window.innerWidth,
        height: window.innerHeight
      })
      setTranslationPopupPosition((current) =>
        current?.top === next.top &&
        current.left === next.left &&
        current.placement === next.placement
          ? current
          : next
      )
    }
    reposition()
    window.addEventListener('resize', reposition)
    return () => window.removeEventListener('resize', reposition)
  }, [translationPopup, cues, translationPopupController])

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
        <div
          id="subtitle-sidebar-translate-popup"
          role="status"
          ref={translationPopupElementRef}
          style={{
            top: translationPopupPosition?.top ?? 0,
            left: translationPopupPosition?.left ?? 0
          }}
        >
          <div className="subtitle-sidebar-translate-header">
            Copied to clipboard
            <button
              type="button"
              aria-label="Close translation"
              onClick={() => translationPopupController.close()}
            >
              ✕
            </button>
          </div>
          {translationPopup.status === 'loading' && <p>Translating…</p>}
          {translationPopup.status === 'done' && <p>{translationPopup.text}</p>}
          {translationPopup.status === 'error' && <p>Translation failed.</p>}
        </div>
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
            const isCurrentMatchRow = currentMatch !== undefined && currentMatch.cueKey === key
            return (
              <SidebarRow
                key={key}
                cue={cue}
                isActive={key === activeCueKey}
                rowTokens={tokens[key] ?? []}
                levels={levels}
                vocabularySpans={vocabularySpans}
                matches={matches.filter((m) => m.cueKey === key)}
                currentMatch={isCurrentMatchRow ? currentMatch : undefined}
                onSelectCue={onSelectCue}
                onCopyCue={onCopyCue || onTranslateCue ? handleCopyCue : undefined}
                liRef={(el) => {
                  if (el) rowElsRef.current!.set(key, el)
                  else rowElsRef.current!.delete(key)
                  if (isCurrentMatchRow) currentMatchRowRef.current = el
                }}
              />
            )
          })}
        </ul>
      )}
    </aside>
  )
}
