// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import StartupTab from '@src/renderer/src/components/options/StartupTab'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function renderTab(overrides: Partial<React.ComponentProps<typeof StartupTab>> = {}): void {
  render(
    <StartupTab
      active
      startupBehavior="splash"
      onChangeStartupBehavior={vi.fn()}
      supportsGameOcr
      {...overrides}
    />
  )
}

describe('StartupTab', () => {
  it('renders the accessible group and selected persisted choice', () => {
    renderTab({ startupBehavior: 'video-player' })

    expect(screen.getByRole('radiogroup', { name: 'When Kizuna starts' })).not.toBeNull()
    expect(screen.getByRole('radio', { name: 'Video player' })).toHaveProperty('checked', true)
    expect(screen.getByText('This choice applies on the next launch.')).not.toBeNull()
  })

  it('dispatches one selection change without changing the current surface', () => {
    const onChangeStartupBehavior = vi.fn()
    renderTab({ onChangeStartupBehavior })

    fireEvent.click(screen.getByRole('radio', { name: 'Video player' }))

    expect(onChangeStartupBehavior).toHaveBeenCalledOnce()
    expect(onChangeStartupBehavior).toHaveBeenCalledWith('video-player')
  })

  it('disables Game OCR with a visible Windows-only explanation when unsupported', () => {
    renderTab({ supportsGameOcr: false, startupBehavior: 'game-ocr' })

    const gameOcr = screen.getByRole('radio', { name: 'Game OCR' }) as HTMLInputElement
    expect(gameOcr.disabled).toBe(true)
    expect(gameOcr.checked).toBe(true)
    expect(screen.getByText(/Game OCR is Windows-only/)).not.toBeNull()
  })
})
