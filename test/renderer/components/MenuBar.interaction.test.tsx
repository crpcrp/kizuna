// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { APPLY_FOLDER_FEEDBACK_MS } from '@src/renderer/src/components/menu/utils'
import { TestMenuBar as MenuBar, type FlatMenuBarTestProps } from './menu/menuBarTestAdapter'

function renderMenu(overrides: Partial<FlatMenuBarTestProps> = {}) {
  const props: FlatMenuBarTestProps = {
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
