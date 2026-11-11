// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import JimakuSubtitlesDialog from '@src/renderer/src/components/JimakuSubtitlesDialog'
import { entry, file, props } from './dialogProps'

afterEach(cleanup)

describe('Jimaku file stage', () => {
  it('renders ranked file clues, pagination, disabled exclusions, and delegated actions', () => {
    const first = file('first', 'Show - 07.srt', {
      reasons: ['Same episode', 'Timing unknown', 'Same release group']
    })
    const second = file('second', 'Show - 08.ass', { format: 'ass', size: Number.NaN })
    const third = file('third', 'Show - 09.zip', { format: 'zip' })
    const fourth = file('fourth', 'Show - 10.ssa', { format: 'ssa' })
    const fifth = file('fifth', 'Show - 11.srt', { reasons: ['Signs/songs only'] })
    const excluded = file('excluded', 'Show - 12.srt', {
      status: 'excluded',
      reasons: ['Different episode', 'Foreign-only subtitle']
    })
    const dialog = props({
      phase: { kind: 'choosingFile' },
      files: [first, second, third, fourth, fifth, excluded],
      shownFiles: [first, second, third, fourth, fifth]
    })
    render(<JimakuSubtitlesDialog {...dialog} />)

    expect(screen.getByText('Same episode')).toBeTruthy()
    expect(screen.getByText('Timing unknown')).toBeTruthy()
    expect(screen.getByText('Same release group')).toBeTruthy()
    expect(screen.getAllByText('2.0 KiB')).toHaveLength(4)
    expect(screen.getByText('Size unknown')).toBeTruthy()
    expect(screen.getAllByText('Signs/songs only')).toHaveLength(2)
    expect(screen.queryByText('Different episode')).toBeNull()
    expect(screen.getByRole('button', { name: 'Show all files' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Refresh results' })).toBeTruthy()

    fireEvent.click(screen.getAllByRole('button', { name: 'Download and use' })[0])
    expect(dialog.onChooseFile).toHaveBeenCalledWith('first')
    fireEvent.click(screen.getByRole('button', { name: 'Open Show - 07.srt source on Jimaku' }))
    expect(dialog.onOpenSourcePage).toHaveBeenCalledWith(1)
    fireEvent.click(screen.getByRole('button', { name: 'Show all files' }))
    expect(dialog.onShowAllFiles).toHaveBeenCalledOnce()
  })

  it('uses Open on Jimaku for externally hosted titles and never offers a broken download', () => {
    const external = entry(1)
    external.flags.external = true
    const dialog = props({
      phase: { kind: 'choosingFile' },
      selectedEntry: external,
      files: [file('external', 'Show - 07.srt')],
      shownFiles: [file('external', 'Show - 07.srt')]
    })
    render(<JimakuSubtitlesDialog {...dialog} />)

    expect(screen.queryByRole('button', { name: 'Download and use' })).toBeNull()
    fireEvent.click(screen.getAllByRole('button', { name: 'Open on Jimaku' })[1])
    expect(dialog.onOpenSourcePage).toHaveBeenCalledWith(1)
  })
})
