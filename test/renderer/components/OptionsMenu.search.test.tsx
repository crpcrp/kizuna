// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import OptionsMenu from '@src/renderer/src/components/OptionsMenu'
import { baseOptionsMenuProps } from './optionsMenuProps'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function searchBox(): HTMLInputElement {
  return screen.getByLabelText('Find a setting or feature') as HTMLInputElement
}

function tab(name: string): HTMLElement {
  return screen.getByRole('tab', { name })
}

describe('OptionsMenu setting search', () => {
  it('lists matching settings while a query is typed', () => {
    render(<OptionsMenu {...baseOptionsMenuProps()} />)

    fireEvent.change(searchBox(), { target: { value: 'loudness' } })

    const options = within(
      screen.getByRole('listbox', { name: 'Setting search results' })
    ).getAllByRole('option')
    expect(options).toHaveLength(1)
    // The result names the setting and the tab that holds it — the tab being
    // the thing the user shouldn't have to know.
    expect(options[0].textContent).toBe('Normalize loudnessPlayback')
  })

  it('says so when nothing matches', () => {
    render(<OptionsMenu {...baseOptionsMenuProps()} />)

    fireEvent.change(searchBox(), { target: { value: 'zzzz no such setting' } })

    expect(
      within(screen.getByRole('listbox', { name: 'Setting search results' })).queryAllByRole(
        'option'
      )
    ).toHaveLength(0)
    expect(screen.getByText('No settings match that search.')).toBeTruthy()
  })

  it('switches to the result’s tab and clears the query when a result is picked', () => {
    render(<OptionsMenu {...baseOptionsMenuProps()} />)
    // Starts on Playback.
    expect(tab('Playback').getAttribute('aria-selected')).toBe('true')

    fireEvent.change(searchBox(), { target: { value: 'theme' } })
    fireEvent.click(screen.getByRole('option', { name: /Theme/ }))

    expect(tab('Appearance').getAttribute('aria-selected')).toBe('true')
    expect(tab('Playback').getAttribute('aria-selected')).toBe('false')
    expect(searchBox().value).toBe('')
    // Query cleared, so the results list is gone and the tabbed view is back.
    expect(screen.queryByRole('listbox', { name: 'Setting search results' })).toBeNull()
  })

  it('reaches a tab that is only mounted while active', () => {
    render(<OptionsMenu {...baseOptionsMenuProps()} />)

    fireEvent.change(searchBox(), { target: { value: 'wanikani token' } })
    fireEvent.click(screen.getByRole('option', { name: /personal access token/i }))

    expect(tab('Known words').getAttribute('aria-selected')).toBe('true')
    expect(screen.getByLabelText('Personal access token')).toBeTruthy()
  })

  it('reaches the Startup selector from search', () => {
    render(<OptionsMenu {...baseOptionsMenuProps()} />)

    fireEvent.change(searchBox(), { target: { value: 'video player' } })
    fireEvent.click(screen.getByRole('option', { name: /When Kizuna starts/ }))

    expect(tab('Startup').getAttribute('aria-selected')).toBe('true')
    expect(screen.getByRole('radio', { name: 'Splash screen' })).toBeTruthy()
  })

  it('flashes the row the picked result points at', () => {
    render(<OptionsMenu {...baseOptionsMenuProps()} />)

    fireEvent.change(searchBox(), { target: { value: 'loudness' } })
    fireEvent.click(screen.getByRole('option', { name: /Normalize loudness/ }))

    const row = document.getElementById('loudness-normalization-checkbox')?.closest('.options-row')
    expect(row?.classList.contains('options-row-flash')).toBe(true)
  })

  it('lets Escape clear a non-empty query without closing the dialog', () => {
    const onClose = vi.fn()
    render(<OptionsMenu {...baseOptionsMenuProps()} onClose={onClose} />)

    fireEvent.change(searchBox(), { target: { value: 'theme' } })
    fireEvent.keyDown(window, { code: 'Escape' })

    expect(searchBox().value).toBe('')
    expect(onClose).not.toHaveBeenCalled()

    // A second Escape, with the query already empty, closes as before.
    fireEvent.keyDown(window, { code: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
