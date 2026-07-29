// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import MenuBar, { APPLY_FOLDER_FEEDBACK_MS } from '@src/renderer/src/components/MenuBar'

function renderMenu(overrides: Partial<React.ComponentProps<typeof MenuBar>> = {}) {
  const props: React.ComponentProps<typeof MenuBar> = {
    tracks: [],
    selectedSubtitleId: null,
    onOpenFile: vi.fn(),
    onSelectAudio: vi.fn(),
    onSelectSubtitle: vi.fn(),
    onOpenOptions: vi.fn(),
    ...overrides
  }
  return { ...render(<MenuBar {...props} />), props }
}

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('MenuBar interactions', () => {
  it('shows ordered extractor Quality choices, selects one, and suppresses duplicate or in-flight picks', () => {
    const onSetYtdlpQuality = vi.fn()
    const { rerender, props } = renderMenu({
      qualityVisible: true,
      quality: '1080',
      onSetYtdlpQuality
    })

    fireEvent.click(screen.getByRole('button', { name: 'Video' }))
    const labels = [
      'Best available',
      '2160p or lower',
      '1440p or lower',
      '1080p or lower',
      '720p or lower',
      '480p or lower',
      '360p or lower',
      'Lowest available'
    ]
    const videoMenu = screen.getByRole('button', { name: 'Video' }).parentElement!
    const labelOf = (item: Element): string =>
      item.querySelector('.menu-item-label')?.textContent ?? ''
    const items = within(videoMenu)
      .getAllByRole('menuitemradio')
      .filter((item) => labels.includes(labelOf(item)))
    expect(items.map(labelOf)).toEqual(labels)
    expect(items.map((item) => item.getAttribute('aria-checked'))).toEqual([
      'false',
      'false',
      'false',
      'true',
      'false',
      'false',
      'false',
      'false'
    ])
    fireEvent.click(screen.getByRole('menuitemradio', { name: '1080p or lower' }))
    expect(onSetYtdlpQuality).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Video' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: '720p or lower' }))
    expect(onSetYtdlpQuality).toHaveBeenCalledOnce()
    expect(onSetYtdlpQuality).toHaveBeenCalledWith('720')

    rerender(<MenuBar {...props} qualityReloading />)
    fireEvent.click(screen.getByRole('button', { name: 'Video' }))
    const reloadingChoice = screen.getByRole('menuitemradio', { name: '480p or lower' })
    expect((reloadingChoice as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(reloadingChoice)
    expect(onSetYtdlpQuality).toHaveBeenCalledOnce()
  })

  it('omits Quality choices when the current media is not extractor-backed', () => {
    renderMenu({ qualityVisible: false })

    fireEvent.click(screen.getByRole('button', { name: 'Video' }))
    expect(screen.queryByRole('menuitemradio', { name: 'Best available' })).toBeNull()
    expect(screen.queryByText('Quality')).toBeNull()
  })

  it('toggles the sidebar and closes the Subtitle menu', () => {
    const onToggleSidebar = vi.fn()
    renderMenu({ onToggleSidebar })

    fireEvent.click(screen.getByRole('button', { name: 'Subtitle' }))
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Show subtitle sidebar' }))

    expect(onToggleSidebar).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Subtitle' }).getAttribute('aria-expanded')).toBe(
      'false'
    )
  })

  it('confirms folder application, restarts its timer, and clears it on unmount', () => {
    vi.useFakeTimers()
    const clearTimeout = vi.spyOn(globalThis, 'clearTimeout')
    const onApplyOffsetToFolder = vi.fn()
    const view = renderMenu({ onApplyOffsetToFolder })

    fireEvent.click(screen.getByRole('button', { name: 'Subtitle' }))
    const apply = screen.getByRole('button', { name: 'Apply subtitle offset to folder' })
    fireEvent.click(apply)
    expect(onApplyOffsetToFolder).toHaveBeenCalledOnce()
    expect(apply.textContent).toContain('Applied')

    vi.advanceTimersByTime(APPLY_FOLDER_FEEDBACK_MS - 1)
    fireEvent.click(apply)
    expect(onApplyOffsetToFolder).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(1)
    expect(apply.textContent).toContain('Applied')

    view.unmount()
    vi.runOnlyPendingTimers()
    expect(clearTimeout).toHaveBeenCalledTimes(2)
  })

  it('on a URL, the sole subtitle Off clears the online caption, not the (absent) embedded one', () => {
    const onSelectSubtitle = vi.fn()
    const onSelectUrlSubtitleOff = vi.fn()
    renderMenu({
      tracks: [],
      onSelectSubtitle,
      onSelectUrlSubtitleOff,
      urlSubtitleMenu: {
        status: 'ready',
        tracks: [
          {
            kind: 'provided',
            lang: 'en',
            label: 'English',
            formats: ['srt'],
            selectionId: 'provided:en'
          }
        ]
      }
    })

    fireEvent.click(screen.getByRole('button', { name: 'Subtitle' }))
    // The embedded Off is collapsed away, so exactly one Off remains.
    const offItems = screen.getAllByRole('menuitemradio', { name: 'Off' })
    expect(offItems).toHaveLength(1)

    fireEvent.click(offItems[0])
    expect(onSelectUrlSubtitleOff).toHaveBeenCalledOnce()
    expect(onSelectSubtitle).not.toHaveBeenCalled()
  })

  it('opens Options straight from the Settings entry, with no dropdown of its own', () => {
    const onOpenOptions = vi.fn()
    renderMenu({ onOpenOptions })

    // Another panel is open: clicking Settings must also close it.
    fireEvent.click(screen.getByRole('button', { name: 'Subtitle' }))
    const settings = screen.getByRole('button', { name: 'Settings' })
    expect(settings.getAttribute('aria-haspopup')).toBeNull()

    fireEvent.click(settings)
    expect(onOpenOptions).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Subtitle' }).getAttribute('aria-expanded')).toBe(
      'false'
    )
    expect(screen.queryByRole('menuitem', { name: 'Options' })).toBeNull()
  })

  it('runs the Playback items and closes the Playback menu', () => {
    const onSetSpeed = vi.fn()
    const onCycleAbLoop = vi.fn()
    const onFrameStep = vi.fn()
    const onFrameBack = vi.fn()
    renderMenu({ hasFile: true, onSetSpeed, onCycleAbLoop, onFrameStep, onFrameBack })

    const playback = (): HTMLElement => screen.getByRole('button', { name: 'Playback' })
    fireEvent.click(playback())
    fireEvent.click(screen.getByRole('menuitemradio', { name: '1.5×' }))
    expect(onSetSpeed).toHaveBeenCalledWith(1.5)
    expect(playback().getAttribute('aria-expanded')).toBe('false')

    fireEvent.click(playback())
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'A–B loop' }))
    expect(onCycleAbLoop).toHaveBeenCalledOnce()

    fireEvent.click(playback())
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Step forward one frame' }))
    expect(onFrameStep).toHaveBeenCalledOnce()

    fireEvent.click(playback())
    fireEvent.click(screen.getByRole('menuitemradio', { name: 'Step back one frame' }))
    expect(onFrameBack).toHaveBeenCalledOnce()
  })

  it('disables loading a subtitle file while media opening is in progress', () => {
    renderMenu({ onLoadSubtitleFile: vi.fn(), mediaOpening: true })

    fireEvent.click(screen.getByRole('button', { name: 'Subtitle' }))
    expect(
      (screen.getByRole('menuitem', { name: 'Load subtitle file' }) as HTMLButtonElement).disabled
    ).toBe(true)
  })
})

describe('MenuBar audio delay row', () => {
  it('steps the delay by ±50 ms and resets to 0', () => {
    const onChangeAudioDelay = vi.fn()
    renderMenu({ hasFile: true, audioDelayMs: 100, onChangeAudioDelay })

    fireEvent.click(screen.getByRole('button', { name: 'Audio' }))
    fireEvent.click(screen.getByRole('button', { name: 'Increase audio delay' }))
    expect(onChangeAudioDelay).toHaveBeenLastCalledWith(150)
    fireEvent.click(screen.getByRole('button', { name: 'Decrease audio delay' }))
    expect(onChangeAudioDelay).toHaveBeenLastCalledWith(50)
    fireEvent.click(screen.getByRole('button', { name: 'Reset audio delay' }))
    expect(onChangeAudioDelay).toHaveBeenLastCalledWith(0)
  })

  it('disables Reset only when the delay is already 0', () => {
    const view = renderMenu({ hasFile: true, audioDelayMs: 0 })
    fireEvent.click(screen.getByRole('button', { name: 'Audio' }))
    expect(
      (screen.getByRole('button', { name: 'Reset audio delay' }) as HTMLButtonElement).disabled
    ).toBe(true)
    view.unmount()

    renderMenu({ hasFile: true, audioDelayMs: -250 })
    fireEvent.click(screen.getByRole('button', { name: 'Audio' }))
    expect(
      (screen.getByRole('button', { name: 'Reset audio delay' }) as HTMLButtonElement).disabled
    ).toBe(false)
  })

  it('disables the entire delay row when no file is loaded', () => {
    renderMenu({ hasFile: false, audioDelayMs: -250 })
    fireEvent.click(screen.getByRole('button', { name: 'Audio' }))

    // Every control in the row — steppers, the text field, and Reset (even
    // though the delay is non-zero) — is inert without a file, matching the
    // line-navigation and screenshot items that gate on load state.
    expect(
      (screen.getByRole('button', { name: 'Decrease audio delay' }) as HTMLButtonElement).disabled
    ).toBe(true)
    expect(
      (screen.getByRole('button', { name: 'Increase audio delay' }) as HTMLButtonElement).disabled
    ).toBe(true)
    expect(
      (screen.getByRole('button', { name: 'Reset audio delay' }) as HTMLButtonElement).disabled
    ).toBe(true)
    expect(
      (screen.getByRole('spinbutton', { name: 'Audio delay in milliseconds' }) as HTMLInputElement)
        .disabled
    ).toBe(true)
  })

  it('commits a typed value on Enter and on blur', () => {
    const onChangeAudioDelay = vi.fn()
    renderMenu({ hasFile: true, audioDelayMs: 0, onChangeAudioDelay })

    fireEvent.click(screen.getByRole('button', { name: 'Audio' }))
    const input = screen.getByRole('spinbutton', {
      name: 'Audio delay in milliseconds'
    }) as HTMLInputElement

    // Enter blurs the field (see onKeyDown), and the blur commits the draft.
    input.focus()
    fireEvent.change(input, { target: { value: '-125' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(onChangeAudioDelay).toHaveBeenLastCalledWith(-125)

    fireEvent.change(input, { target: { value: '300' } })
    fireEvent.blur(input)
    expect(onChangeAudioDelay).toHaveBeenLastCalledWith(300)
  })

  it('rejects scientific notation and other junk, resolving to the last committed value', () => {
    const onChangeAudioDelay = vi.fn()
    renderMenu({ hasFile: true, audioDelayMs: 75, onChangeAudioDelay })

    fireEvent.click(screen.getByRole('button', { name: 'Audio' }))
    const input = screen.getByRole('spinbutton', {
      name: 'Audio delay in milliseconds'
    }) as HTMLInputElement

    for (const junk of ['2e+23', '1e3', 'Infinity', '', 'abc']) {
      fireEvent.change(input, { target: { value: junk } })
      fireEvent.blur(input)
      expect(onChangeAudioDelay).not.toHaveBeenCalled()
      expect(input.value).toBe('75')
      input.focus()
    }
  })

  it('reverts a typed value on Escape without committing', async () => {
    const onChangeAudioDelay = vi.fn()
    renderMenu({ hasFile: true, audioDelayMs: 75, onChangeAudioDelay })

    fireEvent.click(screen.getByRole('button', { name: 'Audio' }))
    const input = screen.getByRole('spinbutton', {
      name: 'Audio delay in milliseconds'
    }) as HTMLInputElement

    // Real, asynchronously-dispatched keystrokes verify that Escape does not
    // let the blur handler commit a stale draft.
    const user = userEvent.setup()
    await user.click(input)
    await user.clear(input)
    await user.type(input, '999')
    await user.keyboard('{Escape}')

    expect(onChangeAudioDelay).not.toHaveBeenCalled()
    expect(input.value).toBe('75')
  })
})

describe('MenuBar online-subtitles language filter', () => {
  const LANGS = [
    ['ja', 'Japanese'],
    ['en', 'English'],
    ['de', 'German'],
    ['fr', 'French'],
    ['es', 'Spanish'],
    ['it', 'Italian'],
    ['ru', 'Russian'],
    ['pt', 'Portuguese'],
    ['ko', 'Korean'],
    ['zh', 'Chinese'],
    ['nl', 'Dutch'],
    ['pl', 'Polish']
  ] as const

  const readyMenu = (count: number) => ({
    status: 'ready' as const,
    tracks: LANGS.slice(0, count).map(([lang, label]) => ({
      kind: 'provided' as const,
      lang,
      label,
      formats: ['srt'],
      selectionId: `provided:${lang}`
    }))
  })

  const openSubtitle = (): void => {
    fireEvent.click(screen.getByRole('button', { name: 'Subtitle' }))
  }

  it('renders the filter box above 8 tracks and hides it at or below', () => {
    const many = renderMenu({ urlSubtitleMenu: readyMenu(12) })
    openSubtitle()
    expect(screen.getByRole('textbox', { name: 'Filter subtitle languages' })).toBeTruthy()
    many.unmount()

    renderMenu({ urlSubtitleMenu: readyMenu(3) })
    openSubtitle()
    expect(screen.queryByRole('textbox', { name: 'Filter subtitle languages' })).toBeNull()
  })

  it('narrows the list live, leaving only matching rows and the Off row', () => {
    renderMenu({ urlSubtitleMenu: readyMenu(12) })
    openSubtitle()
    const input = screen.getByRole('textbox', { name: 'Filter subtitle languages' })
    fireEvent.change(input, { target: { value: 'jap' } })

    const section = document.getElementById('online-subtitles')!
    const rows = within(section).getAllByRole('menuitemradio')
    expect(rows.map((r) => r.getAttribute('aria-label') ?? r.textContent)).toContain('Off')
    const selectionIds = within(section)
      .getAllByRole('menuitemradio')
      .map((r) => r.getAttribute('data-selection-id'))
      .filter((id): id is string => id !== null)
    expect(selectionIds).toEqual(['provided:ja'])
  })

  it('shows "No matching language" on a junk query while Off stays clickable', () => {
    const onSelectUrlSubtitleOff = vi.fn()
    renderMenu({ urlSubtitleMenu: readyMenu(12), onSelectUrlSubtitleOff })
    openSubtitle()
    fireEvent.change(screen.getByRole('textbox', { name: 'Filter subtitle languages' }), {
      target: { value: 'zzzz' }
    })

    const section = document.getElementById('online-subtitles')!
    expect(within(section).getByText('No matching language')).toBeTruthy()
    // No language rows survive, but Off remains.
    expect(
      within(section)
        .getAllByRole('menuitemradio')
        .filter((r) => r.getAttribute('data-selection-id') !== null)
    ).toHaveLength(0)
    fireEvent.click(within(section).getByRole('menuitemradio', { name: 'Off' }))
    expect(onSelectUrlSubtitleOff).toHaveBeenCalledOnce()
  })

  it('keeps the currently selected row visible even when the query excludes it', () => {
    renderMenu({ urlSubtitleMenu: readyMenu(12), urlSubtitleSelectedId: 'provided:de' })
    openSubtitle()
    fireEvent.change(screen.getByRole('textbox', { name: 'Filter subtitle languages' }), {
      target: { value: 'jap' }
    })

    const section = document.getElementById('online-subtitles')!
    const selectionIds = within(section)
      .getAllByRole('menuitemradio')
      .map((r) => r.getAttribute('data-selection-id'))
      .filter((id): id is string => id !== null)
    // The excluded-but-selected German row is re-inserted alongside the match.
    expect(selectionIds).toContain('provided:de')
    expect(selectionIds).toContain('provided:ja')
    const german = within(section).getByText('German').closest('button')!
    expect(german.getAttribute('aria-checked')).toBe('true')
  })

  it('clears the box on Escape without closing the Subtitle panel', () => {
    renderMenu({ urlSubtitleMenu: readyMenu(12) })
    openSubtitle()
    const input = screen.getByRole('textbox', {
      name: 'Filter subtitle languages'
    }) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'jap' } })
    expect(input.value).toBe('jap')

    fireEvent.keyDown(input, { key: 'Escape' })
    expect(input.value).toBe('')
    // The menu's own window-level Escape closer must not have fired.
    expect(screen.getByRole('button', { name: 'Subtitle' }).getAttribute('aria-expanded')).toBe(
      'true'
    )
  })

  it('does not close the menu when the filter box is clicked', () => {
    renderMenu({ urlSubtitleMenu: readyMenu(12) })
    openSubtitle()
    const input = screen.getByRole('textbox', { name: 'Filter subtitle languages' })

    fireEvent.pointerDown(input)
    expect(screen.getByRole('button', { name: 'Subtitle' }).getAttribute('aria-expanded')).toBe(
      'true'
    )
  })
})

describe('MenuBar subtitle offset row', () => {
  it('reverts a typed value on Escape without committing', async () => {
    const onChangeSubtitleOffset = vi.fn()
    renderMenu({ subtitleOffsetMs: 75, onChangeSubtitleOffset })

    fireEvent.click(screen.getByRole('button', { name: 'Subtitle' }))
    const input = screen.getByRole('spinbutton', {
      name: 'Subtitle offset in milliseconds'
    }) as HTMLInputElement

    // Same race as the audio-delay field's Escape handler (see
    // offsetEscapingRef): async keystrokes are needed to reproduce it,
    // since fireEvent's synchronous dispatch masks the stale-closure read.
    const user = userEvent.setup()
    await user.click(input)
    await user.clear(input)
    await user.type(input, '999')
    await user.keyboard('{Escape}')

    expect(onChangeSubtitleOffset).not.toHaveBeenCalled()
    expect(input.value).toBe('75')
  })
})
