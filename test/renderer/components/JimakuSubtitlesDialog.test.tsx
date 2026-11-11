// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import JimakuSubtitlesDialog from '@src/renderer/src/components/JimakuSubtitlesDialog'
import { props } from './jimaku/dialogProps'

afterEach(cleanup)

describe('JimakuSubtitlesDialog stage switch', () => {
  it('maps busy, setup, actionable errors, cancellation, and Escape to callbacks', () => {
    const dialog = props({ phase: { kind: 'searchingTitles' } })
    const { rerender } = render(<JimakuSubtitlesDialog {...dialog} />)
    expect(screen.getByRole('status').textContent).toContain('Searching Jimaku titles')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(dialog.onCancelOperation).toHaveBeenCalledOnce()

    rerender(<JimakuSubtitlesDialog {...dialog} phase={{ kind: 'setupRequired' }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }))
    expect(dialog.onOpenSettings).toHaveBeenCalledOnce()

    rerender(
      <JimakuSubtitlesDialog
        {...dialog}
        phase={{ kind: 'error', code: 'notFound', recovery: 'titles' }}
      />
    )
    expect(screen.getByRole('alert').textContent).toContain('Edit the title or category')
    fireEvent.click(screen.getByRole('button', { name: 'Edit title or category' }))
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Title query' }))

    rerender(
      <JimakuSubtitlesDialog
        {...dialog}
        phase={{ kind: 'error', code: 'network', recovery: 'files' }}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(dialog.onRefresh).toHaveBeenCalledOnce()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(dialog.onClose).toHaveBeenCalledOnce()
  })
})
