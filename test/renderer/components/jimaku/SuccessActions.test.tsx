// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import JimakuSubtitlesDialog from '@src/renderer/src/components/JimakuSubtitlesDialog'
import { props } from './dialogProps'

afterEach(cleanup)

describe('Jimaku success actions', () => {
  it('renders success actions and distinct status notices', () => {
    const dialog = props({
      phase: { kind: 'choosingFile' },
      notice: 'sameContent',
      currentVersionId: 'version-1',
      appliedVersionByItem: { 'file-1': 'version-1' },
      canRevert: true
    })
    render(<JimakuSubtitlesDialog {...dialog} />)

    expect(screen.getByRole('status').textContent).toContain('already in use')
    expect(screen.getByText('In use')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Adjust timing' }))
    fireEvent.click(screen.getByRole('button', { name: 'Try another' }))
    fireEvent.click(screen.getByRole('button', { name: 'Revert to previous subtitles' }))
    expect(dialog.onAdjustTiming).toHaveBeenCalledOnce()
    expect(dialog.onTryAnother).toHaveBeenCalledOnce()
    expect(dialog.onRevert).toHaveBeenCalledOnce()
  })
})
