// @vitest-environment happy-dom
import { initialPlayerState } from '@src/renderer/src/state/playerState'
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
      settings={{ ...initialPlayerState, startupBehavior: 'splash' }}
      onChange={vi.fn()}
      active
      supportsGameOcr
      {...overrides}
    />
  )
}

describe('StartupTab', () => {
  it('renders the accessible group and selected persisted choice', () => {
    renderTab({ settings: { ...initialPlayerState, startupBehavior: 'video-player' } })

    expect(screen.getByRole('radiogroup', { name: 'When Kizuna starts' })).not.toBeNull()
    expect(screen.getByRole('radio', { name: 'Video player' })).toHaveProperty('checked', true)
    expect(screen.getByText('This choice applies on the next launch.')).not.toBeNull()
  })

  it('dispatches one selection change without changing the current surface', () => {
    const onChangeStartupBehavior = vi.fn()
    renderTab({ onChange: onChangeStartupBehavior })

    fireEvent.click(screen.getByRole('radio', { name: 'Video player' }))

    expect(onChangeStartupBehavior).toHaveBeenCalledOnce()
    expect(onChangeStartupBehavior).toHaveBeenCalledWith({ startupBehavior: 'video-player' })
  })

  it('disables Game OCR with a visible Windows-only explanation when unsupported', () => {
    renderTab({
      supportsGameOcr: false,
      settings: { ...initialPlayerState, startupBehavior: 'game-ocr' }
    })

    const gameOcr = screen.getByRole('radio', { name: 'Game OCR' }) as HTMLInputElement
    expect(gameOcr.disabled).toBe(true)
    expect(gameOcr.checked).toBe(true)
    expect(screen.getByText(/Game OCR is Windows-only/)).not.toBeNull()
  })
})
