// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import JimakuSubtitlesDialog from '@src/renderer/src/components/JimakuSubtitlesDialog'
import { archive, file, props } from './dialogProps'

afterEach(cleanup)

describe('Jimaku archive stage', () => {
  it('requires an explicit archive member choice and shows timing hints', () => {
    const dialog = props({
      phase: { kind: 'choosingArchiveMember' },
      archive: archive(),
      selectedFile: file('zip', 'Show-pack.zip', { format: 'zip' }),
      showingAllFiles: true
    })
    render(<JimakuSubtitlesDialog {...dialog} />)

    expect(screen.getByText(/will not guess between ambiguous members/)).toBeTruthy()
    expect(screen.getAllByText('Episode 7')).toHaveLength(2)
    expect(screen.getByText('Timing unknown')).toBeTruthy()
    fireEvent.click(screen.getAllByRole('button', { name: 'Download and use' })[0])
    expect(dialog.onChooseMember).toHaveBeenCalledWith('member-1')
  })
})
