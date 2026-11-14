// @vitest-environment happy-dom
import { cleanup, fireEvent, render } from '@testing-library/react'
import { afterEach, describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import SubtitleOverlay from '@src/renderer/src/components/SubtitleOverlay'
import { DEFAULT_SUBTITLE_STYLE } from '@src/shared/playerSettings'
import { findActiveCue, type Cue } from '@src/shared/cue'
import { makeToken } from '@test/harness/tokenFixtures'

const cues: Cue[] = [
  { start: 0, end: 2, text: 'hello' },
  { start: 3, end: 5, text: 'a\nb' }
]
afterEach(cleanup)

describe('SubtitleOverlay markup', () => {
  it('renders the active cue text', () => {
    const html = renderToStaticMarkup(<SubtitleOverlay cue={findActiveCue(cues, 1)} />)
    expect(html).toContain('id="subtitle"')
    expect(html).toContain('hello')
  })

  it('renders empty when no cue is active (gap between cues)', () => {
    const html = renderToStaticMarkup(<SubtitleOverlay cue={findActiveCue(cues, 2.5)} />)
    expect(html).toMatch(/<div id="subtitle"[^>]*><\/div>/)
  })

  it('renders empty when before the first cue', () => {
    const html = renderToStaticMarkup(<SubtitleOverlay cue={findActiveCue(cues, -1)} />)
    expect(html).toMatch(/<div id="subtitle"[^>]*><\/div>/)
  })

  it('renders empty when after the last cue', () => {
    const html = renderToStaticMarkup(<SubtitleOverlay cue={findActiveCue(cues, 10)} />)
    expect(html).toMatch(/<div id="subtitle"[^>]*><\/div>/)
  })

  it('splits a multi-line cue into separate lines', () => {
    const html = renderToStaticMarkup(<SubtitleOverlay cue={findActiveCue(cues, 4)} />)
    expect(html).toContain('a')
    expect(html).toContain('<br/>')
    expect(html).toContain('b')
  })

  it('falls back to plain text when tokens is an empty array', () => {
    const html = renderToStaticMarkup(<SubtitleOverlay cue={findActiveCue(cues, 1)} tokens={[]} />)
    expect(html).toContain('id="subtitle"')
    expect(html).toContain('hello')
    expect(html).not.toContain('data-token')
  })

  it('applies the default position/font-size inline style when style is omitted', () => {
    const html = renderToStaticMarkup(<SubtitleOverlay cue={findActiveCue(cues, 1)} />)
    expect(html).toContain('left:50%')
    expect(html).toContain('top:82%')
    expect(html).toContain('font-size:1.1rem')
  })

  it('applies a custom style prop to left/top/font-size', () => {
    const html = renderToStaticMarkup(
      <SubtitleOverlay
        cue={findActiveCue(cues, 1)}
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
        cue={findActiveCue(cues, 1)}
        tokens={tokens}
        style={{ ...DEFAULT_SUBTITLE_STYLE, backgroundEnabled: false }}
      />
    )
    expect(html).toContain('data-background-enabled="false"')
  })

  it('does not add disabled-background markup when the background is enabled', () => {
    const html = renderToStaticMarkup(<SubtitleOverlay cue={findActiveCue(cues, 1)} />)
    expect(html).not.toContain('data-background-enabled')
  })
})

describe('SubtitleOverlay interactions', () => {
  it('forwards word events and knowledge/highlight props through InteractiveText', () => {
    const token = makeToken({ surface: '猫', reading: 'ねこ' })
    const onWordClick = vi.fn(),
      onWordHover = vi.fn(),
      onWordLeave = vi.fn(),
      onDragStart = vi.fn()
    const { container } = render(
      <SubtitleOverlay
        cue={{ start: 0, end: 1, text: '猫' }}
        tokens={[token]}
        levels={{ 猫: 'inDeck' }}
        highlightedTokens={[token]}
        onWordClick={onWordClick}
        onWordHover={onWordHover}
        onWordLeave={onWordLeave}
        onDragStart={onDragStart}
      />
    )
    const word = container.querySelector('[data-token]')!
    expect(word.getAttribute('data-level')).toBe('inDeck')
    expect(word.hasAttribute('data-highlighted')).toBe(true)
    fireEvent.click(word, { clientX: 42, clientY: 99 })
    fireEvent.mouseEnter(word, { clientX: 42, clientY: 99 })
    fireEvent.mouseLeave(word)
    expect(onWordClick).toHaveBeenCalledWith(
      token,
      expect.objectContaining({ clientX: 42, clientY: 99 })
    )
    expect(onWordHover).toHaveBeenCalledWith(token, expect.objectContaining({ clientX: 42 }))
    expect(onWordLeave).toHaveBeenCalledOnce()
    fireEvent.mouseDown(word)
    expect(onDragStart).not.toHaveBeenCalled()
    fireEvent.mouseDown(container.querySelector('#subtitle')!)
    expect(onDragStart).toHaveBeenCalledOnce()
  })

  it('allows selection and suppresses background drag when dragging is disabled', () => {
    const onDragStart = vi.fn()
    const { container } = render(
      <SubtitleOverlay cue={cues[0]} dragEnabled={false} onDragStart={onDragStart} />
    )
    const subtitle = container.querySelector('#subtitle')!
    fireEvent.mouseDown(subtitle)
    expect(onDragStart).not.toHaveBeenCalled()
    expect(subtitle.className).toBe('subtitle-selectable')
  })

  it('renders Japanese punctuation with the configured font stack and fractional scale', () => {
    const { container } = render(
      <SubtitleOverlay
        cue={{ start: 0, end: 1, text: '｡' }}
        tokens={[makeToken({ surface: '｡', pos: '記号' })]}
        style={{ ...DEFAULT_SUBTITLE_STYLE, fontScale: 1.5 }}
      />
    )
    const subtitle = container.querySelector<HTMLElement>('#subtitle')!
    expect(subtitle.style.fontFamily).toContain('Yu Gothic UI')
    expect(subtitle.style.fontSize).toBe('1.65rem')
    expect(subtitle.textContent).toBe('｡')
  })
})
