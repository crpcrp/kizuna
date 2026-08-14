import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import SubtitleOverlay, {
  tokenSpans,
  subtitleBoxStyle,
  type TokenSpanItem
} from '@src/renderer/src/components/SubtitleOverlay'
import InteractiveText, {
  type InteractiveTextProps
} from '@src/renderer/src/components/InteractiveText'
import { DEFAULT_SUBTITLE_STYLE } from '@src/shared/playerSettings'
import type { Cue } from '@src/shared/cue'
import type { Token } from '@src/shared/token'
import { makeToken } from '@test/harness/tokenFixtures'
import { REPO_ROOT } from '@test/paths'

// SSR-only render (no jsdom, no testing-library) per AGENTS.md testing policy.

const cues: Cue[] = [
  { start: 0, end: 2, text: 'hello' },
  { start: 3, end: 5, text: 'a\nb' }
]

describe('SubtitleOverlay.css glyph outline (issue #132)', () => {
  const css = readFileSync(
    join(REPO_ROOT, 'src', 'renderer', 'src', 'components', 'SubtitleOverlay.css'),
    'utf-8'
  )
  // Isolate the #subtitle rule block so the outline is asserted as a
  // property of #subtitle itself (inherited by both plain-text and
  // tokenized descendants), not merely present anywhere in the file.
  const subtitleRule = css.slice(css.indexOf('#subtitle {'), css.indexOf('\n}') + 2)

  it('declares a configurable text-shadow outline in all eight surrounding directions', () => {
    expect(subtitleRule).toContain('text-shadow:')
    expect(subtitleRule.match(/var\(--subtitle-outline-size\)/g)).toHaveLength(12)
  })

  it('outlines with the black --subtitle-outline token, not a literal color', () => {
    expect(subtitleRule).toContain('var(--subtitle-outline)')
  })

  it('does not add a rectangular border to #subtitle', () => {
    expect(subtitleRule).not.toMatch(
      /\bborder(?:-(?:top|right|bottom|left|width|style|color))?\s*:/
    )
  })
})

describe('SubtitleOverlay.css background option', () => {
  const css = readFileSync(
    join(REPO_ROOT, 'src', 'renderer', 'src', 'components', 'SubtitleOverlay.css'),
    'utf-8'
  )

  it('makes only the subtitle box background transparent when disabled', () => {
    expect(css).toContain("#subtitle[data-background-enabled='false']")
    expect(css).toMatch(
      /#subtitle\[data-background-enabled='false'\]\s*\{\s*background:\s*transparent;\s*\}/
    )
  })
})

describe('theme.css --subtitle-outline (issue #132)', () => {
  const themeCss = readFileSync(join(REPO_ROOT, 'src', 'renderer', 'src', 'theme.css'), 'utf-8')

  it('defines the same black outline color in both the dark and light blocks', () => {
    const matches = [...themeCss.matchAll(/--subtitle-outline:\s*(#[0-9a-fA-F]{3,8})/g)]
    expect(matches, 'expected --subtitle-outline in both :root blocks').toHaveLength(2)
    for (const [, value] of matches) {
      expect(value.toLowerCase()).toBe('#000000')
    }
  })
})

describe('SubtitleOverlay markup', () => {
  it('renders the active cue text', () => {
    const html = renderToStaticMarkup(<SubtitleOverlay cues={cues} timePos={1} />)
    expect(html).toContain('id="subtitle"')
    expect(html).toContain('hello')
  })

  it('renders empty when no cue is active (gap between cues)', () => {
    const html = renderToStaticMarkup(<SubtitleOverlay cues={cues} timePos={2.5} />)
    expect(html).toMatch(/<div id="subtitle"[^>]*><\/div>/)
  })

  it('renders empty when before the first cue', () => {
    const html = renderToStaticMarkup(<SubtitleOverlay cues={cues} timePos={-1} />)
    expect(html).toMatch(/<div id="subtitle"[^>]*><\/div>/)
  })

  it('renders empty when after the last cue', () => {
    const html = renderToStaticMarkup(<SubtitleOverlay cues={cues} timePos={10} />)
    expect(html).toMatch(/<div id="subtitle"[^>]*><\/div>/)
  })

  it('splits a multi-line cue into separate lines', () => {
    const html = renderToStaticMarkup(<SubtitleOverlay cues={cues} timePos={4} />)
    expect(html).toContain('a')
    expect(html).toContain('<br/>')
    expect(html).toContain('b')
  })

  it('falls back to plain text when tokens is an empty array', () => {
    const html = renderToStaticMarkup(<SubtitleOverlay cues={cues} timePos={1} tokens={[]} />)
    expect(html).toContain('id="subtitle"')
    expect(html).toContain('hello')
    expect(html).not.toContain('data-token')
  })

  it('applies the default position/font-size inline style when style is omitted', () => {
    const html = renderToStaticMarkup(<SubtitleOverlay cues={cues} timePos={1} />)
    expect(html).toContain('left:50%')
    expect(html).toContain('top:82%')
    expect(html).toContain('font-size:1.1rem')
  })

  it('applies a custom style prop to left/top/font-size', () => {
    const html = renderToStaticMarkup(
      <SubtitleOverlay
        cues={cues}
        timePos={1}
        style={{ fontScale: 2, outlineSizePx: 3, xPct: 25, yPct: 60, backgroundEnabled: true }}
      />
    )
    expect(html).toContain('left:25%')
    expect(html).toContain('top:60%')
    expect(html).toContain('font-size:2.2rem')
    expect(html).toContain('--subtitle-outline-size:3px')
  })

  it.each([
    ['plain text', undefined],
    ['tokenized text', [makeToken({ surface: 'hello' })]]
  ])('marks the background as disabled for %s rendering', (_label, tokens) => {
    const html = renderToStaticMarkup(
      <SubtitleOverlay
        cues={cues}
        timePos={1}
        tokens={tokens}
        style={{ ...DEFAULT_SUBTITLE_STYLE, backgroundEnabled: false }}
      />
    )
    expect(html).toContain('data-background-enabled="false"')
  })

  it('does not add disabled-background markup when the background is enabled', () => {
    const html = renderToStaticMarkup(<SubtitleOverlay cues={cues} timePos={1} />)
    expect(html).not.toContain('data-background-enabled')
  })
})

describe('subtitleBoxStyle (pure)', () => {
  it('derives left/top/font-size from a SubtitleStyleSettings', () => {
    expect(subtitleBoxStyle(DEFAULT_SUBTITLE_STYLE)).toEqual({
      position: 'absolute',
      left: '50%',
      top: '82%',
      transform: 'translate(-50%, -50%)',
      fontSize: '1.1rem',
      fontFamily: '"Yu Gothic UI", "Yu Gothic", Meiryo, "Noto Sans JP", sans-serif',
      '--subtitle-outline-size': '1px'
    })
  })

  it('scales font size by fontScale', () => {
    expect(
      subtitleBoxStyle({
        fontScale: 1.5,
        outlineSizePx: 1,
        xPct: 10,
        yPct: 20,
        backgroundEnabled: true
      }).fontSize
    ).toBe('1.65rem')
  })

  it('uses a Japanese-capable font stack for halfwidth ideographic punctuation', () => {
    const cue: Cue = { start: 0, end: 2, text: '｡' }
    const punctuation = makeToken({ surface: '｡', pos: '記号' })
    const html = renderToStaticMarkup(
      <SubtitleOverlay cues={[cue]} timePos={1} tokens={[punctuation]} />
    )

    expect(subtitleBoxStyle(DEFAULT_SUBTITLE_STYLE).fontFamily).toContain('Yu Gothic UI')
    expect(html).toContain('>｡</span>')
  })
})

describe('SubtitleOverlay drag handling', () => {
  const cue: Cue = { start: 0, end: 2, text: 'hello' }

  it('fires onDragStart when mousedown lands on the box background itself', () => {
    const onDragStart = vi.fn()
    const element = SubtitleOverlay({ cues: [cue], timePos: 1, onDragStart })
    const target = {}
    const event = { target, currentTarget: target } as unknown as React.MouseEvent<HTMLDivElement>
    element.props.onMouseDown(event)
    expect(onDragStart).toHaveBeenCalledWith(event)
  })

  it('does not fire onDragStart when mousedown lands on a child (e.g. a word span)', () => {
    const onDragStart = vi.fn()
    const element = SubtitleOverlay({ cues: [cue], timePos: 1, onDragStart })
    const event = {
      target: {},
      currentTarget: {}
    } as unknown as React.MouseEvent<HTMLDivElement>
    element.props.onMouseDown(event)
    expect(onDragStart).not.toHaveBeenCalled()
  })

  it('does not throw when onDragStart is omitted', () => {
    const element = SubtitleOverlay({ cues: [cue], timePos: 1 })
    const target = {}
    const event = { target, currentTarget: target } as unknown as React.MouseEvent<HTMLDivElement>
    expect(() => element.props.onMouseDown(event)).not.toThrow()
  })

  it('does not fire onDragStart and marks the text selectable when dragging is disabled', () => {
    const onDragStart = vi.fn()
    const element = SubtitleOverlay({ cues: [cue], timePos: 1, onDragStart, dragEnabled: false })
    const target = {}
    const event = { target, currentTarget: target } as unknown as React.MouseEvent<HTMLDivElement>
    element.props.onMouseDown(event)
    expect(onDragStart).not.toHaveBeenCalled()
    expect(element.props.className).toBe('subtitle-selectable')
  })
})

describe('tokenSpans (pure)', () => {
  /** Token offsets ignore the cue's line breaks, so fixtures use them that way. */
  function fragment(text: string, displayStartOffset: number, fragmentCount = 1, index = 0) {
    return { text, displayStartOffset, fragmentIndex: index, fragmentCount }
  }

  it('returns one token item per token, in order, when there is no newline', () => {
    const tokens: Token[] = [
      makeToken({ surface: 'hello' }),
      makeToken({ surface: 'world', startOffset: 5 })
    ]
    const spans = tokenSpans('helloworld', tokens)
    expect(spans).toEqual<TokenSpanItem[]>([
      { type: 'token', token: tokens[0], ...fragment('hello', 0) },
      { type: 'token', token: tokens[1], ...fragment('world', 5) }
    ])
  })

  it('inserts a break item at a line boundary crossed by token startOffset', () => {
    const tokens: Token[] = [
      makeToken({ surface: 'a' }),
      makeToken({ surface: 'b', startOffset: 1 })
    ]
    const spans = tokenSpans('a\nb', tokens)
    expect(spans).toEqual<TokenSpanItem[]>([
      { type: 'token', token: tokens[0], ...fragment('a', 0) },
      { type: 'break' },
      { type: 'token', token: tokens[1], ...fragment('b', 2) }
    ])
  })

  it('inserts multiple breaks when a token spans several blank lines', () => {
    const tokens: Token[] = [
      makeToken({ surface: 'a' }),
      makeToken({ surface: 'c', startOffset: 1 })
    ]
    const spans = tokenSpans('a\n\nc', tokens)
    expect(spans).toEqual<TokenSpanItem[]>([
      { type: 'token', token: tokens[0], ...fragment('a', 0) },
      { type: 'break' },
      { type: 'break' },
      { type: 'token', token: tokens[1], ...fragment('c', 3) }
    ])
  })

  it('splits a word wrapped across two cue lines into fragments of one token', () => {
    const tokens: Token[] = [makeToken({ surface: '描かれている', startOffset: 0 })]
    const spans = tokenSpans('描か\nれている', tokens)
    expect(spans).toEqual<TokenSpanItem[]>([
      { type: 'token', token: tokens[0], ...fragment('描か', 0, 2, 0) },
      { type: 'break' },
      { type: 'token', token: tokens[0], ...fragment('れている', 3, 2, 1) }
    ])
  })

  it('drops a token that no longer fits the text instead of throwing', () => {
    const spans = tokenSpans('猫', [makeToken({ surface: '可愛い', startOffset: 8 })])
    expect(spans).toEqual([])
  })

  it('returns an empty array for an empty tokens list', () => {
    expect(tokenSpans('anything', [])).toEqual([])
  })
})

describe('SubtitleOverlay optional event parameters', () => {
  const cue: Cue = { start: 0, end: 2, text: '猫' }
  const token = makeToken({ surface: '猫', reading: 'ねこ' })

  interface TokenSpanProps {
    onClick: (event: React.MouseEvent) => void
    onMouseEnter: (event: React.MouseEvent) => void
    onMouseLeave: () => void
  }

  /** Renders (without stringifying) so we can invoke the token span's handlers directly. */
  function renderTokenSpan(
    onWordClick?: (token: Token, event?: React.MouseEvent) => void,
    onWordHover?: (token: Token, event?: React.MouseEvent) => void,
    onWordLeave?: () => void
  ): TokenSpanProps {
    const element = SubtitleOverlay({
      cues: [cue],
      timePos: 1,
      tokens: [token],
      onWordClick,
      onWordHover,
      onWordLeave
    })
    // <div id="subtitle"><InteractiveText>{spans}</InteractiveText></div>.
    const interactiveElement = element.props.children as React.ReactElement<InteractiveTextProps>
    const interactiveText = InteractiveText(interactiveElement.props)
    const spans = (interactiveText.props.children as React.ReactElement<TokenSpanProps>[]).filter(
      Boolean
    )
    return spans[0].props
  }

  it('still works when the caller only accepts the token (event omitted)', () => {
    const onWordClick = vi.fn((_t: Token) => {})
    const spanProps = renderTokenSpan(onWordClick)
    spanProps.onClick({ clientX: 1, clientY: 2 } as React.MouseEvent)
    expect(onWordClick).toHaveBeenCalledWith(token, expect.anything())
  })

  it('forwards the DOM mouse event as the second argument when the handler accepts it', () => {
    const onWordClick = vi.fn()
    const onWordHover = vi.fn()
    const spanProps = renderTokenSpan(onWordClick, onWordHover)
    const fakeEvent = { clientX: 42, clientY: 99 } as React.MouseEvent
    spanProps.onClick(fakeEvent)
    spanProps.onMouseEnter(fakeEvent)
    expect(onWordClick).toHaveBeenCalledWith(token, fakeEvent)
    expect(onWordHover).toHaveBeenCalledWith(token, fakeEvent)
  })

  it('does not throw when onWordClick/onWordHover are omitted entirely', () => {
    const spanProps = renderTokenSpan()
    expect(() => spanProps.onClick({} as React.MouseEvent)).not.toThrow()
    expect(() => spanProps.onMouseEnter({} as React.MouseEvent)).not.toThrow()
  })

  it('fires onWordLeave (no args) when the pointer leaves a token span', () => {
    const onWordLeave = vi.fn()
    const spanProps = renderTokenSpan(undefined, undefined, onWordLeave)
    spanProps.onMouseLeave()
    expect(onWordLeave).toHaveBeenCalledWith()
  })

  it('does not throw when onWordLeave is omitted', () => {
    const spanProps = renderTokenSpan()
    expect(() => spanProps.onMouseLeave()).not.toThrow()
  })
})

describe('SubtitleOverlay markup with tokens', () => {
  const tokenCues: Cue[] = [{ start: 0, end: 2, text: '猫は\n可愛い' }]
  const tokens: Token[] = [
    makeToken({ surface: '猫', reading: 'ねこ' }),
    makeToken({ surface: 'は', reading: 'は', pos: '助詞', startOffset: 1 }),
    makeToken({ surface: '可愛い', reading: 'かわいい', pos: '形容詞', startOffset: 2 })
  ]

  it('renders one data-token span per token, with the surface as its text', () => {
    const html = renderToStaticMarkup(
      <SubtitleOverlay cues={tokenCues} timePos={1} tokens={tokens} />
    )
    expect(html).toContain('id="subtitle"')
    const matches = [...html.matchAll(/<span data-token="">([^<]*)<\/span>/g)]
    expect(matches).toHaveLength(3)
    expect(matches.map((m) => m[1])).toEqual(['猫', 'は', '可愛い'])
  })

  it('inserts a line break between tokens that straddle the cue newline', () => {
    const html = renderToStaticMarkup(
      <SubtitleOverlay cues={tokenCues} timePos={1} tokens={tokens} />
    )
    expect(html).toContain('<br/>')
  })

  it('marks only the given highlightedTokens with data-highlighted', () => {
    const html = renderToStaticMarkup(
      <SubtitleOverlay
        cues={tokenCues}
        timePos={1}
        tokens={tokens}
        highlightedTokens={[tokens[0], tokens[1]]}
      />
    )
    expect(html).toContain('<span data-token="" data-highlighted="">猫</span>')
    expect(html).toContain('<span data-token="" data-highlighted="">は</span>')
    expect(html).toContain('<span data-token="">可愛い</span>')
  })

  it('marks no tokens with data-highlighted when the prop is omitted', () => {
    const html = renderToStaticMarkup(
      <SubtitleOverlay cues={tokenCues} timePos={1} tokens={tokens} />
    )
    expect(html).not.toContain('data-highlighted')
  })
})

describe('SubtitleOverlay word wrapped across the cue line break', () => {
  // MeCab sees the cue as one line, so 描かれている is one token even though the
  // subtitle wraps in the middle of it (see cueAnalysisText).
  const wrappedCues: Cue[] = [{ start: 0, end: 2, text: '棒人間が描か\nれている。' }]
  const wrapped = makeToken({ surface: '描かれている', reading: 'えがかれている', pos: '動詞' })
  const tokens: Token[] = [
    makeToken({ surface: '棒人間' }),
    makeToken({ surface: 'が', pos: '助詞', startOffset: 3 }),
    { ...wrapped, startOffset: 4 },
    makeToken({ surface: '。', pos: '記号', startOffset: 10 })
  ]

  function render(extra: Partial<React.ComponentProps<typeof SubtitleOverlay>> = {}): string {
    return renderToStaticMarkup(
      <SubtitleOverlay cues={wrappedCues} timePos={1} tokens={tokens} {...extra} />
    )
  }

  it('renders the split word as two fragments of one token, keeping the line break', () => {
    const html = render()

    expect(html).toContain('data-token-key="0|2|棒人間が描か\n' + 'れている。:4"')
    expect(html.match(/data-token-fragment/g)).toHaveLength(2)
    expect(html).toContain('>描か</span><br/>')
    expect(html).toContain('>れている</span>')
  })

  it('applies the word knowledge level to both fragments', () => {
    const html = render({ levels: { 描かれている: 'learning' } })

    expect(html.match(/data-level="learning"/g)).toHaveLength(2)
  })

  it('highlights both fragments when the popup resolves the split word', () => {
    const html = render({ highlightedTokens: [tokens[2]] })

    expect(html.match(/data-highlighted=""/g)).toHaveLength(2)
  })
})

describe('SubtitleOverlay knowledge-level coloring', () => {
  const tokenCues: Cue[] = [{ start: 0, end: 2, text: '猫は可愛い' }]
  const tokens: Token[] = [
    makeToken({ surface: '猫', reading: 'ねこ' }),
    makeToken({ surface: 'は', reading: 'は', pos: '助詞', startOffset: 1 }),
    makeToken({ surface: '可愛い', reading: 'かわいい', pos: '形容詞', startOffset: 2 })
  ]

  it('renders data-level from the levels map, keyed by lemma', () => {
    const html = renderToStaticMarkup(
      <SubtitleOverlay
        cues={tokenCues}
        timePos={1}
        tokens={tokens}
        levels={{ 猫: 'learning', は: 'wellKnown', 可愛い: 'known' }}
      />
    )
    expect(html).toContain('data-level="learning">猫</span>')
    expect(html).toContain('data-level="wellKnown">は</span>')
    expect(html).toContain('data-level="known">可愛い</span>')
  })

  it('renders data-level="inDeck" for a lemma whose card is mined but not yet learned', () => {
    const html = renderToStaticMarkup(
      <SubtitleOverlay
        cues={tokenCues}
        timePos={1}
        tokens={tokens}
        levels={{ 猫: 'inDeck', 可愛い: 'known' }}
      />
    )
    expect(html).toContain('data-level="inDeck">猫</span>')
  })

  it('defaults to data-level="unknown" for a content lemma absent from levels', () => {
    const html = renderToStaticMarkup(
      <SubtitleOverlay cues={tokenCues} timePos={1} tokens={tokens} levels={{ 猫: 'learning' }} />
    )
    expect(html).toContain('data-level="unknown">可愛い</span>')
  })

  it('defaults content tokens to "unknown" when levels is an empty object (grammar は excluded)', () => {
    const html = renderToStaticMarkup(
      <SubtitleOverlay cues={tokenCues} timePos={1} tokens={tokens} levels={{}} />
    )
    expect((html.match(/data-level="unknown"/g) ?? []).length).toBe(2)
    expect(html).toContain('data-level="wellKnown">は</span>')
  })

  it('renders no data-level attribute at all when levels is undefined', () => {
    const html = renderToStaticMarkup(
      <SubtitleOverlay cues={tokenCues} timePos={1} tokens={tokens} />
    )
    expect(html).not.toContain('data-level')
  })
})

describe('SubtitleOverlay symbol tokens always render as known', () => {
  const tokenCues: Cue[] = [{ start: 0, end: 2, text: '猫(?)' }]
  const tokens: Token[] = [
    makeToken({ surface: '猫', reading: 'ねこ' }),
    makeToken({ surface: '(', pos: '記号,括弧開', startOffset: 1 }),
    makeToken({ surface: '?', pos: '記号,一般', startOffset: 2 }),
    makeToken({ surface: ')', pos: '補助記号,括弧閉', startOffset: 3 })
  ]

  it('renders "wellKnown" for symbol tokens even when absent from levels (would otherwise default to unknown)', () => {
    const html = renderToStaticMarkup(
      <SubtitleOverlay cues={tokenCues} timePos={1} tokens={tokens} levels={{}} />
    )
    expect(html).toContain('data-level="unknown">猫</span>')
    expect(html).toContain('data-level="wellKnown">(</span>')
    expect(html).toContain('data-level="wellKnown">?</span>')
    expect(html).toContain('data-level="wellKnown">)</span>')
  })
})

describe('SubtitleOverlay grammar tokens always render as wellKnown (QA-4)', () => {
  const tokenCues: Cue[] = [{ start: 0, end: 2, text: '猫にな' }]
  const tokens: Token[] = [
    makeToken({ surface: '猫', reading: 'ねこ' }),
    makeToken({ surface: 'に', reading: 'に', pos: '助詞,格助詞', startOffset: 1 }),
    makeToken({ surface: 'な', reading: 'な', lemma: 'だ', pos: '助動詞', startOffset: 2 })
  ]

  it('renders "wellKnown" for particles/auxiliaries even when levels maps their lemma to unknown', () => {
    const html = renderToStaticMarkup(
      <SubtitleOverlay
        cues={tokenCues}
        timePos={1}
        tokens={tokens}
        levels={{ に: 'unknown', だ: 'unknown' }}
      />
    )
    expect(html).toContain('data-level="unknown">猫</span>')
    expect(html).toContain('data-level="wellKnown">に</span>')
    expect(html).toContain('data-level="wellKnown">な</span>')
  })
})
