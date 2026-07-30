import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import SubtitleSidebar, {
  scrollRowIntoView,
  SidebarRow,
  CueRowContent,
  matchCounterText,
  searchKeyAction,
  createTranslationPopupController,
  placeTranslationPopup,
  type TranslationPopup
} from '@src/renderer/src/components/SubtitleSidebar'
import { cueKey } from '@src/renderer/src/state/tokenization'
import type { Cue } from '@src/shared/cue'
import type { Token } from '@src/shared/token'
import type { SearchMatch } from '@src/renderer/src/state/sidebarSearch'

// SSR-only render (no jsdom, no testing-library) per AGENTS.md testing policy.
// SubtitleSidebar itself now owns hook state (search bar), so it can only be
// exercised via renderToStaticMarkup's initial render — never called as a
// bare function (that would throw "invalid hook call" outside React's
// dispatcher). Click/context-menu behavior on a row is tested through the
// hook-free SidebarRow. The search bar's client-only effects (focus
// on open, scroll on explicit navigation) are not exercised here, same as
// MenuBar's outside-click listener and OptionsMenu's rebind-capture
// listener — they need a live DOM this test environment doesn't provide.

function makeToken(overrides: Partial<Token>): Token {
  return {
    surface: '',
    reading: '',
    lemma: '',
    pos: '',
    startOffset: 0,
    ...overrides
  }
}

const cueA: Cue = { start: 0, end: 2, text: 'hello' }
const cueB: Cue = { start: 3, end: 5, text: 'a\nb' }

describe('SubtitleSidebar empty state', () => {
  it('shows a placeholder when there are no cues', () => {
    const html = renderToStaticMarkup(
      <SubtitleSidebar cues={[]} tokens={{}} onSelectCue={vi.fn()} />
    )
    expect(html).toContain('id="subtitle-sidebar-empty"')
    expect(html).not.toContain('<ul')
  })
})

describe('SubtitleSidebar row rendering', () => {
  it('renders one row per cue', () => {
    const html = renderToStaticMarkup(
      <SubtitleSidebar cues={[cueA, cueB]} tokens={{}} onSelectCue={vi.fn()} />
    )
    expect(html).toContain('hello')
    expect(html).toContain('a')
    expect(html).toContain('b')
    expect((html.match(/class="subtitle-sidebar-row"/g) ?? []).length).toBe(2)
  })

  it('falls back to plain line-broken text when a cue has no tokens yet', () => {
    const html = renderToStaticMarkup(
      <SubtitleSidebar cues={[cueB]} tokens={{}} onSelectCue={vi.fn()} />
    )
    expect(html).toContain('<br/>')
    expect(html).not.toContain('data-level')
  })

  it('marks the active row with data-active, by cueKey', () => {
    const html = renderToStaticMarkup(
      <SubtitleSidebar
        cues={[cueA, cueB]}
        tokens={{}}
        activeCueKey={cueKey(cueA)}
        onSelectCue={vi.fn()}
      />
    )
    expect(html).toMatch(/class="subtitle-sidebar-row" data-active=""><span>hello/)
  })

  it('marks no row active when activeCueKey matches none of the cues', () => {
    const html = renderToStaticMarkup(
      <SubtitleSidebar cues={[cueA, cueB]} tokens={{}} activeCueKey="nope" onSelectCue={vi.fn()} />
    )
    expect(html).not.toContain('data-active')
  })
})

describe('SubtitleSidebar knowledge-level coloring', () => {
  const cue: Cue = { start: 0, end: 2, text: '猫は可愛い' }
  const tokens: Token[] = [
    makeToken({ surface: '猫', lemma: '猫', startOffset: 0 }),
    makeToken({ surface: 'は', lemma: 'は', startOffset: 1 }),
    makeToken({ surface: '可愛い', lemma: '可愛い', startOffset: 2 })
  ]

  it('renders data-level per token when tokens are available for the cue', () => {
    const html = renderToStaticMarkup(
      <SubtitleSidebar
        cues={[cue]}
        tokens={{ [cueKey(cue)]: tokens }}
        levels={{ 猫: 'learning', は: 'wellKnown', 可愛い: 'known' }}
        onSelectCue={vi.fn()}
      />
    )
    expect(html).toContain('data-level="learning">猫</span>')
    expect(html).toContain('data-level="wellKnown">は</span>')
    expect(html).toContain('data-level="known">可愛い</span>')
  })

  it('renders data-level="inDeck" for a lemma whose card is mined but not yet learned', () => {
    const html = renderToStaticMarkup(
      <SubtitleSidebar
        cues={[cue]}
        tokens={{ [cueKey(cue)]: tokens }}
        levels={{ 猫: 'inDeck' }}
        onSelectCue={vi.fn()}
      />
    )
    expect(html).toContain('data-level="inDeck">猫</span>')
  })

  it('defaults to unknown for a lemma missing from levels', () => {
    const html = renderToStaticMarkup(
      <SubtitleSidebar
        cues={[cue]}
        tokens={{ [cueKey(cue)]: tokens }}
        levels={{ 猫: 'learning' }}
        onSelectCue={vi.fn()}
      />
    )
    expect(html).toContain('data-level="unknown">は</span>')
  })

  it('renders no data-level attribute when levels is undefined', () => {
    const html = renderToStaticMarkup(
      <SubtitleSidebar cues={[cue]} tokens={{ [cueKey(cue)]: tokens }} onSelectCue={vi.fn()} />
    )
    expect(html).not.toContain('data-level')
  })
})

describe('SubtitleSidebar symbol tokens', () => {
  // Mirrors SubtitleOverlay's equivalent test: both components share the
  // tokenLevel helper, so a symbol/punctuation token must render "wellKnown"
  // here too, even when absent from levels (would otherwise default to unknown).
  const cue: Cue = { start: 0, end: 2, text: '猫(?)' }
  const tokens: Token[] = [
    makeToken({ surface: '猫', reading: 'ねこ', lemma: '猫', pos: '名詞', startOffset: 0 }),
    makeToken({ surface: '(', lemma: '(', pos: '記号,括弧開', startOffset: 1 }),
    makeToken({ surface: '?', lemma: '?', pos: '記号,一般', startOffset: 2 }),
    makeToken({ surface: ')', lemma: ')', pos: '補助記号,括弧閉', startOffset: 3 })
  ]

  it('renders "wellKnown" for symbol tokens even when absent from levels', () => {
    const html = renderToStaticMarkup(
      <SubtitleSidebar
        cues={[cue]}
        tokens={{ [cueKey(cue)]: tokens }}
        levels={{}}
        onSelectCue={vi.fn()}
      />
    )
    expect(html).toContain('data-level="unknown">猫</span>')
    expect(html).toContain('data-level="wellKnown">(</span>')
    expect(html).toContain('data-level="wellKnown">?</span>')
    expect(html).toContain('data-level="wellKnown">)</span>')
  })
})

describe('scrollRowIntoView', () => {
  // Backs the sidebar's "jump to the active cue when opened" effect (see
  // SubtitleSidebar's mount-only useEffect). Tested as a standalone pure
  // function per this file's SSR-only policy — the effect wiring itself,
  // which needs a real DOM to fire, is not separately tested (same pattern
  // as App.tsx's extracted effect helpers, e.g. videoScaleWindowSize).
  it('scrolls the given element into the center of its container', () => {
    const scrollIntoView = vi.fn()
    scrollRowIntoView({ scrollIntoView } as unknown as HTMLElement)
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' })
  })

  it('does nothing when there is no active row element', () => {
    expect(() => scrollRowIntoView(null)).not.toThrow()
  })
})

interface RowButtonProps {
  onClick: () => void
  onContextMenu: (event: React.MouseEvent<HTMLButtonElement>) => void
}
interface ListItemProps {
  children: React.ReactElement<RowButtonProps>
}

describe('SubtitleSidebar click-to-seek', () => {
  it("fires onSelectCue with the clicked row's cue", () => {
    const onSelectCue = vi.fn()
    const element = SidebarRow({
      cue: cueB,
      isActive: false,
      rowTokens: [],
      matches: [],
      onSelectCue
    })
    // <li><button>...</button></li> -> invoke the button's onClick directly.
    const li = element as React.ReactElement<ListItemProps>
    li.props.children.props.onClick()
    expect(onSelectCue).toHaveBeenCalledWith(cueB)
  })

  it('prevents the browser menu and copies without selecting the row', () => {
    const onSelectCue = vi.fn()
    const onCopyCue = vi.fn()
    const preventDefault = vi.fn()
    const element = SidebarRow({
      cue: cueB,
      isActive: false,
      rowTokens: [],
      matches: [],
      onSelectCue,
      onCopyCue
    })
    const li = element as React.ReactElement<ListItemProps>
    li.props.children.props.onContextMenu({
      preventDefault
    } as unknown as React.MouseEvent<HTMLButtonElement>)

    expect(preventDefault).toHaveBeenCalledOnce()
    expect(onCopyCue).toHaveBeenCalledWith(cueB)
    expect(onSelectCue).not.toHaveBeenCalled()
  })
})

describe('SubtitleSidebar copy toast', () => {
  // The toast only appears after a right-click copy fires handleCopyCue's
  // setState, which needs a live DOM event dispatch — outside this SSR-only
  // harness (same limitation noted for the search bar's client-only effects
  // above). This just pins the initial-render contract: no copy yet, no toast.
  it('is absent on initial render, even when onCopyCue is provided', () => {
    const html = renderToStaticMarkup(
      <SubtitleSidebar cues={[cueA]} tokens={{}} onSelectCue={vi.fn()} onCopyCue={vi.fn()} />
    )
    expect(html).not.toContain('subtitle-sidebar-copy-toast')
  })
})

function deferred<T>(): {
  promise: Promise<T>
  resolve(value: T): void
  reject(reason?: unknown): void
} {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('createTranslationPopupController', () => {
  const anchor = { top: 10, left: 20 }

  it('shows loading, then the resolved translation while preserving copy behavior in SidebarRow', async () => {
    const changes: Array<TranslationPopup | null> = []
    const controller = createTranslationPopupController(
      (popup) => changes.push(popup),
      () => 'request-1',
      vi.fn()
    )
    const translation = deferred<string>()

    controller.open(cueKey(cueA), anchor, () => translation.promise)
    expect(changes).toEqual([{ anchor, cueKey: cueKey(cueA), status: 'loading' }])

    translation.resolve('Hello')
    await translation.promise
    await Promise.resolve()
    expect(changes.at(-1)).toEqual({ anchor, cueKey: cueKey(cueA), status: 'done', text: 'Hello' })
  })

  it('shows an error when translation rejects', async () => {
    const changes: Array<TranslationPopup | null> = []
    const controller = createTranslationPopupController(
      (popup) => changes.push(popup),
      () => 'request-1',
      vi.fn()
    )
    const translation = deferred<string>()

    controller.open(cueKey(cueA), anchor, () => translation.promise)
    translation.reject(new Error('offline'))
    await translation.promise.catch(() => undefined)
    await Promise.resolve()

    expect(changes.at(-1)).toEqual({ anchor, cueKey: cueKey(cueA), status: 'error' })
  })

  it('uses the per-cue cache and ignores a repeat click while that cue is loading', async () => {
    const changes: Array<TranslationPopup | null> = []
    const controller = createTranslationPopupController(
      (popup) => changes.push(popup),
      () => 'request-1',
      vi.fn()
    )
    const translation = deferred<string>()
    const request = vi.fn(() => translation.promise)

    controller.open(cueKey(cueA), anchor, request)
    controller.open(cueKey(cueA), { top: 11, left: 21 }, request)
    expect(request).toHaveBeenCalledOnce()

    translation.resolve('Hello')
    await translation.promise
    await Promise.resolve()
    controller.open(cueKey(cueA), { top: 12, left: 22 }, request)

    expect(request).toHaveBeenCalledOnce()
    expect(changes.at(-1)).toEqual({
      anchor: { top: 12, left: 22 },
      cueKey: cueKey(cueA),
      status: 'done',
      text: 'Hello'
    })
  })

  it('discards a late result after a newer row is right-clicked', async () => {
    const changes: Array<TranslationPopup | null> = []
    const controller = createTranslationPopupController(
      (popup) => changes.push(popup),
      () => 'request-1',
      vi.fn()
    )
    const first = deferred<string>()
    const second = deferred<string>()

    controller.open(cueKey(cueA), anchor, () => first.promise)
    controller.open(cueKey(cueB), { top: 30, left: 40 }, () => second.promise)
    first.resolve('stale')
    await first.promise
    await Promise.resolve()
    expect(changes.at(-1)).toEqual({
      anchor: { top: 30, left: 40 },
      cueKey: cueKey(cueB),
      status: 'loading'
    })

    second.resolve('current')
    await second.promise
    await Promise.resolve()
    expect(changes.at(-1)).toEqual({
      anchor: { top: 30, left: 40 },
      cueKey: cueKey(cueB),
      status: 'done',
      text: 'current'
    })
  })

  it('clears the popup and invalidates its in-flight request', async () => {
    const changes: Array<TranslationPopup | null> = []
    const cancel = vi.fn()
    const controller = createTranslationPopupController(
      (popup) => changes.push(popup),
      () => 'request-1',
      cancel
    )
    const translation = deferred<string>()

    controller.open(cueKey(cueA), anchor, () => translation.promise)
    controller.close()
    translation.resolve('too late')
    await translation.promise
    await Promise.resolve()

    expect(changes.at(-1)).toBeNull()
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(cancel).toHaveBeenCalledWith('request-1')
  })
  it('cancels the first request exactly once before opening a newer row', () => {
    const changes: Array<TranslationPopup | null> = []
    const createRequestId = vi.fn().mockReturnValueOnce('first').mockReturnValueOnce('second')
    const cancel = vi.fn()
    const controller = createTranslationPopupController(
      (popup) => changes.push(popup),
      createRequestId,
      cancel
    )
    const first = deferred<string>()
    const second = deferred<string>()

    controller.open(cueKey(cueA), anchor, () => first.promise)
    controller.open(cueKey(cueB), { top: 30, left: 40 }, () => second.promise)

    expect(cancel).toHaveBeenCalledTimes(1)
    expect(cancel).toHaveBeenCalledWith('first')
    expect(changes.at(-1)).toEqual({
      anchor: { top: 30, left: 40 },
      cueKey: cueKey(cueB),
      status: 'loading'
    })
  })

  it('does not cancel a request after it has completed successfully', async () => {
    const changes: Array<TranslationPopup | null> = []
    const cancel = vi.fn()
    const controller = createTranslationPopupController(
      (popup) => changes.push(popup),
      () => 'request-1',
      cancel
    )
    const translation = deferred<string>()

    controller.open(cueKey(cueA), anchor, () => translation.promise)
    translation.resolve('Hello')
    await translation.promise
    await Promise.resolve()
    controller.close()
    controller.open(cueKey(cueA), { top: 11, left: 21 }, () => Promise.resolve('unused'))

    expect(cancel).not.toHaveBeenCalled()
  })
})

describe('placeTranslationPopup', () => {
  const viewport = { width: 400, height: 300 }
  const popup = { width: 100, height: 60 }

  it('places a top-edge row below and clamps the left edge', () => {
    expect(
      placeTranslationPopup({ top: 4, left: 0, width: 20, bottom: 24 }, popup, viewport)
    ).toEqual({ top: 32, left: 8, placement: 'below' })
  })

  it('places a bottom-edge row above and clamps the right edge', () => {
    expect(
      placeTranslationPopup({ top: 280, left: 390, width: 20, bottom: 300 }, popup, viewport)
    ).toEqual({ top: 212, left: 292, placement: 'above' })
  })

  it('pins an oversized popup to the viewport margin', () => {
    expect(
      placeTranslationPopup(
        { top: 100, left: 100, width: 20, bottom: 120 },
        { width: 500, height: 400 },
        viewport
      )
    ).toEqual({ top: 8, left: 8, placement: 'below' })
  })

  it('keeps exact-fit boundaries at the viewport margin', () => {
    expect(
      placeTranslationPopup(
        { top: 76, left: 8, width: 20, bottom: 96 },
        { width: 384, height: 60 },
        viewport
      )
    ).toEqual({ top: 8, left: 8, placement: 'above' })
  })
})

describe('SubtitleSidebar search controls', () => {
  it('always shows the search field and its Search button by default', () => {
    const html = renderToStaticMarkup(
      <SubtitleSidebar cues={[]} tokens={{}} onSelectCue={vi.fn()} />
    )
    expect(html).toContain('aria-label="Search query"')
    expect(html).toContain('aria-label="Search subtitles"')
    expect(html).toContain('>Search</button>')
    expect(html).not.toContain('aria-label="Clear search"')
  })
})

describe('searchKeyAction (pure)', () => {
  it('maps Enter to next', () => {
    expect(searchKeyAction('Enter', false, true)).toBe('next')
  })
  it('maps Shift+Enter to previous', () => {
    expect(searchKeyAction('Enter', true, true)).toBe('previous')
  })
  it('maps Enter to search before a query is submitted', () => {
    expect(searchKeyAction('Enter', false, false)).toBe('search')
  })
  it('maps Escape to close', () => {
    expect(searchKeyAction('Escape', false, false)).toBe('close')
  })
  it('maps any other key to undefined', () => {
    expect(searchKeyAction('a', false, false)).toBeUndefined()
  })
})

describe('matchCounterText (pure)', () => {
  it('renders nothing for a blank query', () => {
    expect(matchCounterText('', 0, 0)).toBe('')
    expect(matchCounterText('   ', 0, 5)).toBe('')
  })
  it('renders 0/0 for a query with no matches', () => {
    expect(matchCounterText('猫', 0, 0)).toBe('0/0')
  })
  it('renders 1-based current/total', () => {
    expect(matchCounterText('猫', 0, 3)).toBe('1/3')
    expect(matchCounterText('猫', 2, 3)).toBe('3/3')
  })
})

describe('CueRowContent search highlighting', () => {
  const cue: Cue = { start: 0, end: 2, text: '猫は猫が好き' }

  it('wraps matches in <mark> for plain-text rows, and flags the current one', () => {
    const matches: SearchMatch[] = [
      { cueKey: cueKey(cue), start: 0, end: 1 },
      { cueKey: cueKey(cue), start: 3, end: 4 }
    ]
    const html = renderToStaticMarkup(
      <CueRowContent cue={cue} rowTokens={[]} matches={matches} currentMatch={matches[1]} />
    )
    expect(html.match(/<mark/g) ?? []).toHaveLength(2)
    expect(html).toContain('data-current=""')
    expect(html).toContain('>猫</mark>')
  })

  it('renders no marks for an empty match list', () => {
    const html = renderToStaticMarkup(<CueRowContent cue={cue} rowTokens={[]} matches={[]} />)
    expect(html).not.toContain('<mark')
    expect(html).toContain('猫は猫が好き')
  })

  it('wraps the intersecting substring inside a token span, preserving data-level', () => {
    const tokens: Token[] = [
      makeToken({ surface: '猫', lemma: '猫', startOffset: 0 }),
      makeToken({ surface: 'は', lemma: 'は', startOffset: 1 }),
      makeToken({ surface: '猫', lemma: '猫', startOffset: 2 })
    ]
    const matches: SearchMatch[] = [{ cueKey: cueKey(cue), start: 2, end: 3 }]
    const html = renderToStaticMarkup(
      <CueRowContent
        cue={cue}
        rowTokens={tokens}
        levels={{ 猫: 'learning', は: 'wellKnown' }}
        matches={matches}
      />
    )
    expect(html).toContain('<span data-level="learning"><mark>猫</mark></span>')
  })
})
