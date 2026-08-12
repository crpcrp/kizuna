// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import GameOcrFrame from '@src/renderer/src/components/GameOcrFrame'
import type { GameOcrPresentation } from '@src/shared/gameOcr'

afterEach(cleanup)

const presentation: GameOcrPresentation = {
  imageBase64: 'iVBORw0KGgo=',
  imageMediaType: 'image/png',
  imageSize: { width: 2400, height: 1350 },
  recognizing: true
}

describe('GameOcrFrame', () => {
  it('fits the captured screenshot to the complete client area without letterboxing', () => {
    render(<GameOcrFrame presentation={presentation} onClose={vi.fn()} />)

    const image = screen.getByRole('img', { name: 'Frozen game frame' }) as HTMLImageElement
    expect(image.src).toContain(
      `data:${presentation.imageMediaType};base64,${presentation.imageBase64}`
    )
    expect(image.getAttribute('draggable')).toBe('false')

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
        'GameOcrFrame.css'
      ),
      'utf8'
    )
    expect(css).toMatch(/\.game-ocr-frame__image\s*\{[^}]*width:\s*100%;[^}]*height:\s*100%;/s)
    expect(css).toMatch(/\.game-ocr-frame__image\s*\{[^}]*object-fit:\s*fill;/s)
  })

  it('shows the bottom-right recognition indicator and removes it when recognition settles', () => {
    const { rerender } = render(<GameOcrFrame presentation={presentation} onClose={vi.fn()} />)

    expect(screen.getByRole('status').textContent).toContain('Recognizing text…')
    rerender(
      <GameOcrFrame presentation={{ ...presentation, recognizing: false }} onClose={vi.fn()} />
    )
    expect(screen.queryByRole('status')).toBeNull()

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
        'GameOcrFrame.css'
      ),
      'utf8'
    )
    expect(css).toMatch(/\.game-ocr-frame__indicator\s*\{[^}]*right:\s*16px;[^}]*bottom:\s*16px;/s)
    expect(css).toMatch(/\.game-ocr-frame__indicator\s*\{[^}]*pointer-events:\s*none;/s)
  })

  it('closes on one background press or Escape but not from content presses', () => {
    const onClose = vi.fn()
    render(
      <GameOcrFrame presentation={presentation} onClose={onClose}>
        <button type="button">OCR text box</button>
      </GameOcrFrame>
    )

    fireEvent.pointerDown(screen.getByRole('button', { name: 'OCR text box' }), { button: 0 })
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.pointerDown(screen.getByRole('main', { name: 'Frozen game frame' }), { button: 0 })
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('closes on the press rather than the click it would become', () => {
    const onClose = vi.fn()
    render(<GameOcrFrame presentation={presentation} onClose={onClose} />)
    const background = screen.getByRole('main', { name: 'Frozen game frame' })

    // A release that lands elsewhere, an unmounting popup, or the activation of
    // a window the game still held focus over can all swallow the click, and a
    // swallowed click used to leave the screenshot up for a second press.
    fireEvent.pointerDown(background, { button: 0 })
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.click(background)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('keeps the frame open for a selection drag out of a box and for a right-click', () => {
    const onClose = vi.fn()
    render(
      <GameOcrFrame presentation={presentation} onClose={onClose}>
        <button type="button">OCR text box</button>
      </GameOcrFrame>
    )
    const background = screen.getByRole('main', { name: 'Frozen game frame' })

    // A press that starts on a box may be a selection drag onto the screenshot.
    fireEvent.pointerDown(screen.getByRole('button', { name: 'OCR text box' }), { button: 0 })
    fireEvent.pointerUp(background)
    fireEvent.click(background)
    expect(onClose).not.toHaveBeenCalled()

    // Right-clicking the screenshot leaves the frame alone, as the click path did.
    fireEvent.pointerDown(background, { button: 2 })
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.pointerDown(background, { button: 0 })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('renders no screenshot or indicator after a discard state', () => {
    render(<GameOcrFrame onClose={vi.fn()} />)

    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
  })
})
