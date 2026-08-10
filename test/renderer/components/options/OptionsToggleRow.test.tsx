// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import OptionsToggleRow from '@src/renderer/src/components/options/OptionsToggleRow'

// The row makes the switch the only way to change a boolean setting without
// costing the checkbox its accessible name and description. Both halves are
// pinned here: the text is inert, and it still names the control.
//
// happy-dom does forward a `<label>` click to its control, so the inert-text
// case really does fail against the old `<label htmlFor>` markup.

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function renderRow(onChange = vi.fn()): { onChange: ReturnType<typeof vi.fn> } {
  render(
    <OptionsToggleRow
      id="auto-play-next-checkbox"
      title="Auto-play next file"
      description="Continue with the next video in the folder."
      checked={false}
      onChange={onChange}
    />
  )
  return { onChange }
}

describe('OptionsToggleRow interaction', () => {
  it('toggles once when the switch itself is clicked', () => {
    const { onChange } = renderRow()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Auto-play next file' }))

    expect(onChange).toHaveBeenCalledExactlyOnceWith(true)
  })

  it('ignores clicks on the title, the description, the label block and the row', () => {
    const { onChange } = renderRow()
    const title = screen.getByText('Auto-play next file')

    for (const target of [
      title,
      screen.getByText('Continue with the next video in the folder.'),
      title.closest('.options-row-label'),
      // The row itself: forwards nothing today, and must not grow an onClick.
      title.closest('.options-row')
    ]) {
      expect(target).not.toBeNull()
      fireEvent.click(target as Element)
    }

    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('OptionsToggleRow accessible name and description', () => {
  it('names the checkbox from the visible title alone and exposes the description', () => {
    renderRow()
    // getByRole matches on the computed name, so this already fails if the
    // description leaks into it the way the old `<label>` wrapper let it.
    const checkbox = screen.getByRole('checkbox', { name: 'Auto-play next file' })

    expect(checkbox.getAttribute('aria-labelledby')).toBe('auto-play-next-checkbox-label')
    expect(document.getElementById('auto-play-next-checkbox-label')?.textContent).toBe(
      'Auto-play next file'
    )
    expect(checkbox.getAttribute('aria-describedby')).toBe('auto-play-next-checkbox-description')
    expect(document.getElementById('auto-play-next-checkbox-description')?.textContent).toBe(
      'Continue with the next video in the folder.'
    )
  })

  it('leaves aria-describedby off a row with no description', () => {
    render(
      <OptionsToggleRow
        id="translation-enabled"
        title="Enable experimental translation for subtitles and OCR"
        checked={false}
        onChange={vi.fn()}
      />
    )

    const checkbox = screen.getByRole('checkbox', {
      name: 'Enable experimental translation for subtitles and OCR'
    })
    expect(checkbox.hasAttribute('aria-describedby')).toBe(false)
    expect(document.querySelector('.options-row-description')).toBeNull()
  })
})
