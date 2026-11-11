// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import JimakuSubtitlesDialog from '@src/renderer/src/components/JimakuSubtitlesDialog'
import { entry, props, rememberedTitle } from './dialogProps'

afterEach(cleanup)

describe('Jimaku title stage', () => {
  it('keeps editing local and submits only from Search or the form', () => {
    const dialog = props({
      selectedEntry: undefined,
      files: [],
      shownFiles: [],
      entries: [entry(1), entry(2, 'Another Show')],
      shownEntries: [entry(1), entry(2, 'Another Show')]
    })
    render(<JimakuSubtitlesDialog {...dialog} />)

    const query = screen.getByRole('textbox', { name: 'Title query' })
    fireEvent.change(query, { target: { value: 'Edited show' } })
    expect(dialog.onEditIdentity).toHaveBeenCalledWith({ titleQuery: 'Edited show' })
    expect(dialog.onSearch).not.toHaveBeenCalled()

    fireEvent.change(screen.getByRole('combobox', { name: 'Category' }), {
      target: { value: 'anime' }
    })
    fireEvent.change(screen.getByRole('textbox', { name: 'Episode' }), {
      target: { value: '8-9' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    expect(dialog.onEditIdentity).toHaveBeenCalledWith({ category: 'anime' })
    expect(dialog.onEditEpisode).toHaveBeenCalledWith('8-9')
    expect(dialog.onSearch).toHaveBeenCalledOnce()

    expect(
      screen.getByText('Season 2 · Year 2024 · Release group: Group · Source: WEB-DL')
    ).toBeTruthy()
    expect(screen.getByText('Show', { exact: true })).toBeTruthy()
    expect(screen.getByText('Another Show', { exact: true })).toBeTruthy()
  })

  it('shows partial results and retries without hiding available works', () => {
    const dialog = props({
      selectedEntry: undefined,
      files: [],
      shownFiles: [],
      entries: [entry(1)],
      shownEntries: [entry(1)],
      partial: true,
      failedCategories: ['liveAction']
    })
    render(<JimakuSubtitlesDialog {...dialog} />)

    expect(screen.getByText(/Live action could not be searched/)).toBeTruthy()
    expect(screen.getByText('Show', { exact: true })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(dialog.onRefresh).toHaveBeenCalledOnce()
  })

  it('shows the remembered-title marker and opt-in controls', () => {
    const onRememberTitleChange = vi.fn()
    const onClearRememberedTitle = vi.fn()
    const onChangeTitle = vi.fn()
    const dialog = props({
      rememberedTitle,
      onRememberTitleChange,
      onClearRememberedTitle,
      onChangeTitle
    })
    render(<JimakuSubtitlesDialog {...dialog} />)

    expect(screen.getByText('Using remembered title')).toBeTruthy()
    expect(
      (
        screen.getByRole('checkbox', {
          name: 'Remember this title for this folder'
        }) as HTMLInputElement
      ).checked
    ).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Change title' }))
    fireEvent.click(screen.getByRole('button', { name: 'Clear remembered title' }))
    expect(onChangeTitle).toHaveBeenCalledOnce()
    expect(onClearRememberedTitle).toHaveBeenCalledOnce()
  })
})
