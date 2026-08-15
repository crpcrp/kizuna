// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import GameOcrBoxes, { type GameOcrBoxRegion } from '@src/renderer/src/components/GameOcrBoxes'
import GameOcrFrame from '@src/renderer/src/components/GameOcrFrame'
import { makeToken } from '@test/harness/tokenFixtures'

afterEach(cleanup)

function region(
  id: string,
  text: string,
  x: number,
  y: number,
  overrides: Partial<GameOcrBoxRegion> = {}
): GameOcrBoxRegion {
  return {
    id,
    text,
    layout: {
      id,
      originalBounds: { x, y, width: 80, height: 32 },
      displayBounds: { x, y, width: 100, height: 48 }
    },
    ...overrides
  }
}

describe('GameOcrBoxes', () => {
  it('renders one selectable plain-text box per region in deterministic source order', () => {
    const { container } = render(
      <GameOcrBoxes
        regions={[region('later', '\u5f8c', 20, 20), region('first', '\u524d\n\u884c', 10, 10)]}
      />
    )

    expect(
      [...container.querySelectorAll('[data-game-ocr-box]')].map((box) =>
        box.getAttribute('data-region-id')
      )
    ).toEqual(['first', 'later'])
    expect(container.querySelector('[data-region-id="first"]')?.innerHTML).toContain('<br')
    expect(container.querySelector('[data-region-id="first"]')?.getAttribute('tabindex')).toBe('0')
  })

  it('passes token, knowledge, highlight, and compound data to InteractiveText', () => {
    const tokens = [
      makeToken({ surface: '\u795e', lemma: '\u795e' }),
      makeToken({ surface: '\u69d8', lemma: '\u69d8', startOffset: 1 }),
      makeToken({ surface: '\u3068', lemma: '\u3068', pos: '\u52a9\u8a5e', startOffset: 2 })
    ]
    const { container } = render(
      <GameOcrBoxes
        regions={[
          region('compound', '\u795e\u69d8\u3068', 0, 0, {
            tokens,
            highlightedTokens: tokens.slice(0, 2),
            levels: { '\u795e': 'unknown', '\u69d8': 'unknown', '\u3068': 'unknown' },
            vocabularySpans: [
              {
                cueKey: 'compound',
                startOffset: 0,
                endOffset: 2,
                memberTokenOffsets: [0, 1],
                expression: '\u795e\u69d8',
                matchedSurface: '\u795e\u69d8',
                level: 'known'
              }
            ]
          })
        ]}
      />
    )

    const box = container.querySelector('[data-region-id="compound"]')
    expect(box?.querySelectorAll('[data-token]')).toHaveLength(3)
    expect(box?.querySelectorAll('[data-level="known"]')).toHaveLength(2)
    expect(box?.querySelector('[data-token][data-highlighted]')).not.toBeNull()
    expect(box?.querySelector('[data-level="wellKnown"]')).not.toBeNull()
  })

  it('activates one box at a time on click and transfers active state', () => {
    const onActiveRegionChange = vi.fn()
    const { container } = render(
      <GameOcrBoxes
        regions={[region('one', '\u4e00', 0, 0), region('two', '\u4e8c', 120, 0)]}
        onActiveRegionChange={onActiveRegionChange}
      />
    )
    const one = container.querySelector('[data-region-id="one"]') as HTMLElement
    const two = container.querySelector('[data-region-id="two"]') as HTMLElement

    fireEvent.click(one)
    expect(one.getAttribute('data-active')).toBe('')
    expect(onActiveRegionChange).toHaveBeenLastCalledWith('one')

    fireEvent.click(two)
    expect(one.getAttribute('data-active')).toBeNull()
    expect(two.getAttribute('data-active')).toBe('')
    expect(onActiveRegionChange).toHaveBeenLastCalledWith('two')
  })

  it('keeps box pointer, selection, and copy events out of the frozen-frame close handler', () => {
    const onClose = vi.fn()
    const { container } = render(
      <GameOcrFrame onClose={onClose}>
        <GameOcrBoxes
          regions={[region('one', '\u9078\u629e\u3067\u304d\u308b\u6587\u5b57', 0, 0)]}
        />
      </GameOcrFrame>
    )
    const box = container.querySelector('[data-region-id="one"]') as HTMLElement

    const mouseDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 })
    box.dispatchEvent(mouseDown)
    expect(mouseDown.defaultPrevented).toBe(false)
    fireEvent.mouseUp(box)

    const selection = window.getSelection()
    const range = document.createRange()
    range.selectNodeContents(box)
    selection?.removeAllRanges()
    selection?.addRange(range)
    const selectedText = selection?.toString()
    fireEvent.select(box)
    fireEvent.copy(box)

    expect(selectedText).toContain('\u9078\u629e\u3067\u304d\u308b\u6587\u5b57')
    expect(selection?.toString()).toBe(selectedText)
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.pointerDown(screen.getByRole('main', { name: 'Frozen game frame' }), { button: 0 })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('supports Tab focus and Enter activation while Escape remains owned by the frame', () => {
    const onClose = vi.fn()
    const { container } = render(
      <GameOcrFrame onClose={onClose}>
        <GameOcrBoxes regions={[region('one', '\u6587\u5b57', 0, 0)]} />
      </GameOcrFrame>
    )
    const box = container.querySelector('[data-region-id="one"]') as HTMLElement

    box.focus()
    expect(document.activeElement).toBe(box)
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(box.getAttribute('data-active')).toBe('')
    expect(box.getAttribute('aria-pressed')).toBe('true')

    fireEvent.keyDown(box, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('clears active state when the capture key changes', async () => {
    const onActiveRegionChange = vi.fn()
    const { container, rerender } = render(
      <GameOcrBoxes
        captureKey="first-capture"
        regions={[region('same-id', '\u540c\u3058', 0, 0)]}
        onActiveRegionChange={onActiveRegionChange}
      />
    )
    const box = container.querySelector('[data-region-id="same-id"]') as HTMLElement
    fireEvent.click(box)
    expect(box.getAttribute('data-active')).toBe('')

    rerender(
      <GameOcrBoxes
        captureKey="second-capture"
        regions={[region('same-id', '\u540c\u3058', 0, 0)]}
        onActiveRegionChange={onActiveRegionChange}
      />
    )
    await waitFor(() => expect(box.getAttribute('data-active')).toBeNull())
    expect(onActiveRegionChange).toHaveBeenLastCalledWith(null)
  })

  it('applies the fitted typography, including the line spacing of a stacked block', () => {
    const { container } = render(
      <GameOcrBoxes
        regions={[
          region('stacked', '\u4e00\u884c\u76ee\n\u4e8c\u884c\u76ee', 0, 0, {
            fontSize: 18,
            lineHeight: 1.6
          })
        ]}
      />
    )

    const box = container.querySelector<HTMLElement>('[data-region-id="stacked"]')
    expect(box?.style.fontSize).toBe('18px')
    expect(box?.style.lineHeight).toBe('1.6')
  })

  it('uses semantic theme tokens and preserves a readable Japanese text surface', () => {
    const css = readFileSync(
      join(
        import.meta.dirname,
        '..',
        '..',
        '..',
        'src',
        'renderer',
        'src',
        'components',
        'GameOcrBoxes.css'
      ),
      'utf8'
    )

    expect(css).toContain('background: var(--surface-subtitle)')
    expect(css).toContain('border: 1px solid var(--border-default)')
    expect(css).toContain('outline: 2px solid var(--accent-strong)')
    expect(css).toMatch(/font-family:[^;]*Yu Gothic UI/)
    expect(css).toContain('padding: 2px 3px')
    expect(css).toContain('line-height: 1.1')
    expect(css).toContain('letter-spacing: 0.03em')
    expect(css).toContain('white-space: pre')
    expect(css).toContain('overflow-wrap: normal')
    expect(css).toContain('align-items: center')
    expect(css).toContain('justify-content: flex-start')
    expect(css).toContain('text-align: left')
    expect(css).not.toMatch(/#[0-9a-f]{3,8}/i)
  })
})
