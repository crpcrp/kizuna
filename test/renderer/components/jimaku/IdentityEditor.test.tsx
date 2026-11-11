// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import JimakuSubtitlesDialog from '@src/renderer/src/components/JimakuSubtitlesDialog'
import { entry, props } from './dialogProps'

afterEach(cleanup)

describe('Jimaku identity editor', () => {
  it('disables episode filtering for a movie and keeps local fallback delegated', () => {
    const movie = entry(2, 'Movie', true)
    const dialog = props({
      phase: { kind: 'choosingFile' },
      selectedEntry: movie,
      onLoadLocalFile: vi.fn()
    })
    render(<JimakuSubtitlesDialog {...dialog} />)

    expect(screen.getByRole('textbox', { name: 'Episode' }).hasAttribute('disabled')).toBe(true)
    expect(screen.getByText('Movies do not use episode filtering.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Load local file…' }))
    expect(dialog.onLoadLocalFile).toHaveBeenCalledOnce()
  })
})
