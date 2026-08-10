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
      <GameOcrBoxes regions={[region('later', 'ĺľŚ', 20, 20), region('first', 'ĺ‰Ť\nčˇŚ', 10, 10)]} />
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
      makeToken({ surface: 'çĄž', lemma: 'çĄž' }),
      makeToken({ surface: 'ć§', lemma: 'ć§', startOffset: 1 }),
      makeToken({ surface: 'ă¨', lemma: 'ă¨', pos: 'ĺŠ©č©ž', startOffset: 2 })
    ]
    const { container } = render(
      <GameOcrBoxes
        regions={[
          region('compound', 'çĄžć§ă¨', 0, 0, {
            tokens,
            highlightedTokens: tokens.slice(0, 2),
            levels: { çĄž: 'unknown', ć§: 'unknown', ă¨: 'unknown' },
            vocabularySpans: [
              {
                cueKey: 'compound',
                startOffset: 0,
                endOffset: 2,
                memberTokenOffsets: [0, 1],
                expression: 'çĄžć§',
                matchedSurface: 'çĄžć§',
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
        regions={[region('one', 'ä¸€', 0, 0), region('two', 'äşŚ', 120, 0)]}
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
        <GameOcrBoxes regions={[region('one', 'é¸ćŠžă§ăŤă‚‹ć–‡ĺ­—', 0, 0)]} />
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

    expect(selectedText).toContain('é¸ćŠžă§ăŤă‚‹ć–‡ĺ­—')
    expect(selection?.toString()).toBe(selectedText)
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('main', { name: 'Frozen game frame' }))
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('supports Tab focus and Enter activation while Escape remains owned by the frame', () => {
    const onClose = vi.fn()
    const { container } = render(
      <GameOcrFrame onClose={onClose}>
        <GameOcrBoxes regions={[region('one', 'ć–‡ĺ­—', 0, 0)]} />
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
        regions={[region('same-id', 'ĺŚă', 0, 0)]}
        onActiveRegionChange={onActiveRegionChange}
      />
    )
    const box = container.querySelector('[data-region-id="same-id"]') as HTMLElement
    fireEvent.click(box)
    expect(box.getAttribute('data-active')).toBe('')

    rerender(
      <GameOcrBoxes
        captureKey="second-capture"
        regions={[region('same-id', 'ĺŚă', 0, 0)]}
        onActiveRegionChange={onActiveRegionChange}
      />
    )
    await waitFor(() => expect(box.getAttribute('data-active')).toBeNull())
    expect(onActiveRegionChange).toHaveBeenLastCalledWith(null)
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
    expect(css).not.toMatch(/#[0-9a-f]{3,8}/i)
  })
})

