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
  imageSize: { width: 2400, height: 1350 },
  recognizing: true
}

describe('GameOcrFrame', () => {
  it('fits the captured screenshot to the complete client area without letterboxing', () => {
    render(<GameOcrFrame presentation={presentation} onClose={vi.fn()} />)

    const image = screen.getByRole('img', { name: 'Frozen game frame' }) as HTMLImageElement
    expect(image.src).toContain(`data:image/png;base64,${presentation.imageBase64}`)
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

  it('closes on background click or Escape but not from content clicks', () => {
    const onClose = vi.fn()
    render(
      <GameOcrFrame presentation={presentation} onClose={onClose}>
        <button type="button">OCR text box</button>
      </GameOcrFrame>
    )

    fireEvent.click(screen.getByRole('button', { name: 'OCR text box' }))
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('main', { name: 'Frozen game frame' }))
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('keeps the frame open when a press that started on content ends on the background', () => {
    const onClose = vi.fn()
    render(
      <GameOcrFrame presentation={presentation} onClose={onClose}>
        <button type="button">OCR text box</button>
      </GameOcrFrame>
    )
    const background = screen.getByRole('main', { name: 'Frozen game frame' })

    // A selection drag out of a box fires its click on the shared ancestor.
    fireEvent.pointerDown(screen.getByRole('button', { name: 'OCR text box' }))
    fireEvent.click(background)
    expect(onClose).not.toHaveBeenCalled()

    fireEvent.pointerDown(background)
    fireEvent.click(background)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('renders no screenshot or indicator after a discard state', () => {
    render(<GameOcrFrame onClose={vi.fn()} />)

    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.queryByRole('status')).toBeNull()
  })
})
