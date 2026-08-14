import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import InteractiveText from '@src/renderer/src/components/InteractiveText'
import { createGameOcrTextProjection } from '@src/renderer/src/state/gameOcrTextProjection'
import type { Token } from '@src/shared/token'
import { makeToken } from '@test/harness/tokenFixtures'

describe('InteractiveText', () => {
  it('renders independent instances without singleton DOM ids', () => {
    const first = makeToken({ surface: '猫' })
    const second = makeToken({ surface: '犬' })
    const html = renderToStaticMarkup(
      <>
        <InteractiveText id="first" text="猫" tokens={[first]} />
        <InteractiveText id="second" text="犬" tokens={[second]} />
      </>
    )

    expect(html).toContain('data-interactive-text-id="first"')
    expect(html).toContain('data-interactive-text-id="second"')
    expect(html).not.toContain(' id="first"')
    expect(html).not.toContain(' id="second"')
  })

  it('keeps plain text fallback and multiline token breaks', () => {
    const plain = renderToStaticMarkup(<InteractiveText id="plain" text={'a\nb'} />)
    const tokens: Token[] = [
      makeToken({ surface: 'a' }),
      makeToken({ surface: 'b', startOffset: 2 })
    ]
    const tokenized = renderToStaticMarkup(
      <InteractiveText id="tokenized" text={'a\nb'} tokens={tokens} />
    )

    expect(plain).toContain('<span>a</span><span><br/>b</span>')
    expect(plain).not.toContain('data-token')
    expect(tokenized).toContain('<span data-token="">a</span><br/><span data-token="">b</span>')
  })

  it('renders a token crossing a display newline as shared semantic fragments', () => {
    const projection = createGameOcrTextProjection(['棒人間が描か', 'れている。'])
    const token = makeToken({
      surface: '描かれている',
      startOffset: 4
    })
    const html = renderToStaticMarkup(
      <InteractiveText
        id="block:one|two"
        text={projection.displayText}
        projection={projection}
        tokens={[token]}
      />
    )

    expect(html).toContain(
      'data-token-key="block:one|two:4" data-token-fragment="0">描か</span><br/>'
    )
    expect(html).toContain(
      'data-token-key="block:one|two:4" data-token-fragment="1">れている</span>'
    )
    expect(html.match(/data-token-key="block:one\|two:4"/g) ?? []).toHaveLength(2)
  })

  it('projects compound, grammar, and punctuation knowledge and highlights tokens', () => {
    const tokens: Token[] = [
      makeToken({ surface: '神' }),
      makeToken({ surface: '様', startOffset: 1 }),
      makeToken({ surface: 'と', pos: '助詞', startOffset: 2 }),
      makeToken({ surface: '?', pos: '記号', startOffset: 3 })
    ]
    const html = renderToStaticMarkup(
      <InteractiveText
        id="compound"
        text="神様と?"
        tokens={tokens}
        levels={{ 神: 'unknown', 様: 'unknown', と: 'unknown' }}
        highlightedTokens={tokens.slice(0, 2)}
        vocabularySpans={[
          {
            cueKey: 'compound',
            startOffset: 0,
            endOffset: 2,
            memberTokenOffsets: [0, 1],
            expression: '神様',
            matchedSurface: '神様',
            level: 'known'
          }
        ]}
      />
    )

    expect(html.match(/data-level="known"/g)).toHaveLength(2)
    expect(html).toContain('data-highlighted="" data-level="known">神</span>')
    expect(html).toContain('data-highlighted="" data-level="known">様</span>')
    expect(html).toContain('data-level="wellKnown">と</span>')
    expect(html).toContain('data-level="wellKnown">?</span>')
  })

  it('forwards optional interaction and selection callbacks', () => {
    const token = makeToken({ surface: '猫' })
    const onHover = vi.fn()
    const onLeave = vi.fn()
    const onClick = vi.fn()
    const onMouseDown = vi.fn()
    const onSelect = vi.fn()
    const element = InteractiveText({
      id: 'callbacks',
      text: '猫',
      tokens: [token],
      onWordHover: onHover,
      onWordLeave: onLeave,
      onWordClick: onClick,
      onMouseDown,
      onSelect
    })
    const root = element as React.ReactElement<{
      children: React.ReactElement<{
        onMouseEnter: (event: React.MouseEvent) => void
        onMouseLeave: () => void
        onClick: (event: React.MouseEvent) => void
      }>[]
      onMouseDown: (event: React.MouseEvent) => void
      onSelect: (event: React.SyntheticEvent) => void
    }>
    const tokenElement = root.props.children[0]
    const event = { clientX: 42, clientY: 99 } as React.MouseEvent

    root.props.onMouseDown(event)
    root.props.onSelect({} as React.SyntheticEvent)
    tokenElement.props.onMouseEnter(event)
    tokenElement.props.onMouseLeave()
    tokenElement.props.onClick(event)

    expect(onMouseDown).toHaveBeenCalledWith(event)
    expect(onSelect).toHaveBeenCalled()
    expect(onHover).toHaveBeenCalledWith(token, event)
    expect(onLeave).toHaveBeenCalledWith()
    expect(onClick).toHaveBeenCalledWith(token, event)
  })
})
