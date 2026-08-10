// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import GameOcrTab, { type GameOcrTabProps } from '@src/renderer/src/components/options/GameOcrTab'
import { DEFAULT_GAME_OCR_SETTINGS } from '@src/shared/gameOcrSettings'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const stoppedStatus: GameOcrTabProps['status'] = {
  shortcut: 'Ctrl+Shift+O',
  paddle: { state: 'not-started' },
  game: { state: 'stopped' }
}

function renderTab(overrides: Partial<GameOcrTabProps> = {}) {
  return render(
    <GameOcrTab
      active
      open
      settings={DEFAULT_GAME_OCR_SETTINGS}
      status={stoppedStatus}
      onChangeShortcut={vi.fn()}
      onStart={vi.fn()}
      onStop={vi.fn()}
      onRetry={vi.fn()}
      {...overrides}
    />
  )
}

describe('GameOcrTab', () => {
  it('shows the local OCR privacy boundary and stopped defaults', () => {
    renderTab()

    expect(screen.getByText(/display under the mouse is captured/)).not.toBeNull()
    expect(screen.getByText(/PaddleOCR runs locally/)).not.toBeNull()
    expect(screen.getByText('Not started')).not.toBeNull()
    expect(screen.getByText('Stopped')).not.toBeNull()
    expect(
      (screen.getByRole('button', { name: 'Start Game OCR' }) as HTMLButtonElement).disabled
    ).toBe(false)
    expect(
      (screen.getByRole('button', { name: 'Stop Game OCR' }) as HTMLButtonElement).disabled
    ).toBe(true)
  })

  it('exposes lifecycle controls and one retry action for errors', () => {
    const onStart = vi.fn()
    const onStop = vi.fn()
    const onRetry = vi.fn()
    const { rerender } = renderTab({
      onStart,
      onStop,
      onRetry,
      status: {
        ...stoppedStatus,
        paddle: { state: 'error', error: 'PaddleOCR model is missing.' },
        game: { state: 'armed' }
      }
    })

    expect(screen.getByText('PaddleOCR model is missing.')).not.toBeNull()
    expect(screen.getByRole('button', { name: 'Retry' })).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    fireEvent.click(screen.getByRole('button', { name: 'Stop Game OCR' }))
    expect(onRetry).toHaveBeenCalledOnce()
    expect(onStop).toHaveBeenCalledOnce()

    rerender(
      <GameOcrTab
        active
        open
        settings={DEFAULT_GAME_OCR_SETTINGS}
        status={{ ...stoppedStatus, paddle: { state: 'starting' }, game: { state: 'capturing' } }}
        onChangeShortcut={vi.fn()}
        onStart={onStart}
        onStop={onStop}
        onRetry={onRetry}
      />
    )
    expect(screen.getByText('Starting…')).not.toBeNull()
    expect(screen.getByText('Capturing…')).not.toBeNull()
    expect(
      (screen.getByRole('button', { name: 'Start Game OCR' }) as HTMLButtonElement).disabled
    ).toBe(true)
    expect(
      (screen.getByRole('button', { name: 'Stop Game OCR' }) as HTMLButtonElement).disabled
    ).toBe(false)
  })

  it('captures and reports a new global shortcut', () => {
    const onChangeShortcut = vi.fn()
    renderTab({ onChangeShortcut })

    fireEvent.click(screen.getByRole('button', { name: 'Rebind Game OCR capture shortcut' }))
    expect(screen.getByText('Press a key…')).not.toBeNull()
    fireEvent.keyDown(window, {
      code: 'KeyP',
      key: 'p',
      ctrlKey: true,
      altKey: false,
      shiftKey: true,
      metaKey: false
    })

    expect(onChangeShortcut).toHaveBeenCalledWith('Ctrl+Shift+P')
    expect(screen.getByText('Ctrl+Shift+O')).not.toBeNull()
  })
})
