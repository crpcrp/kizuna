// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import JimakuSubtitlesDialog from '@src/renderer/src/components/JimakuSubtitlesDialog'
import { props, rememberedTitle } from './dialogProps'

afterEach(cleanup)

describe('Jimaku error stage', () => {
  it('distinguishes an unavailable remembered title from a transient failure', () => {
    const onClearRememberedTitle = vi.fn()
    const onChangeTitle = vi.fn()
    const dialog = props({
      phase: { kind: 'error', code: 'notFound', recovery: 'files' },
      rememberedTitle,
      onClearRememberedTitle,
      onChangeTitle
    })
    render(<JimakuSubtitlesDialog {...dialog} />)

    expect(screen.getByRole('alert').textContent).toContain(
      'Remembered title is no longer available'
    )
    fireEvent.click(screen.getByRole('button', { name: 'Search titles' }))
    expect(onChangeTitle).toHaveBeenCalledOnce()
    fireEvent.click(screen.getAllByRole('button', { name: 'Clear remembered title' })[0])
    expect(onClearRememberedTitle).toHaveBeenCalledOnce()
  })
})
