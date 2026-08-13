// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AudioMenu, type AudioMenuProps } from '@src/renderer/src/components/menu/AudioMenu'
import type { Track } from '@src/shared/track'

const run = (action: () => void): (() => void) => action

const tracks: Track[] = [
  { id: 1, kind: 'audio', codec: 'aac', language: 'jpn' },
  { id: 2, kind: 'audio', codec: 'ac3', language: 'eng' },
  { id: 3, kind: 'subtitle', codec: 'ass', title: 'Full', language: 'eng' }
]

function menu(props: Partial<AudioMenuProps> = {}): React.JSX.Element {
  return (
    <AudioMenu
      open
      onToggle={vi.fn()}
      run={run}
      tracks={tracks}
      onSelectAudio={vi.fn()}
      {...props}
    />
  )
}

const markup = (props: Partial<AudioMenuProps> = {}): string => renderToStaticMarkup(menu(props))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('AudioMenu markup', () => {
  it('lists only audio tracks and checks the selected one', () => {
    const html = markup({ selectedAudioId: 1 })
    expect(html).toContain('[JP] aac')
    expect(html).toContain('[EN] ac3')
    expect(html).not.toContain('[EN] Full')
    expect(html).toContain('✓</span><span class="menu-item-label">[JP] aac')
  })

  it('falls back to a disabled placeholder with no audio tracks', () => {
    expect(markup({ tracks: [] })).toContain('No audio tracks')
  })

  it('renders the delay row defaulting to 0 ms', () => {
    const html = markup()
    expect(html).toContain('id="audio-delay-row"')
    expect(html).toContain('id="audio-delay-value"')
    expect(html).toContain('aria-label="Audio delay in milliseconds"')
    expect(html).toContain('value="0"')
    expect(html).toContain('ms')
  })

  it('keeps only per-file controls', () => {
    // Output device and loudness normalization are persistent preferences, so
    // they live in Options > Playback > Audio output now (see OptionsMenu tests).
    const html = markup({ selectedAudioId: 1 })
    expect(html).not.toContain('id="audio-device-list"')
    expect(html).not.toContain('Autoselect device')
    expect(html).not.toContain('Normalize loudness')
    expect(html).toContain('id="audio-delay-row"')
  })
})

describe('AudioMenu delay row', () => {
  it('steps the delay by ±50 ms and resets to 0', () => {
    const onChangeAudioDelay = vi.fn()
    render(menu({ hasFile: true, audioDelayMs: 100, onChangeAudioDelay }))

    fireEvent.click(screen.getByRole('button', { name: 'Increase audio delay' }))
    expect(onChangeAudioDelay).toHaveBeenLastCalledWith(150)
    fireEvent.click(screen.getByRole('button', { name: 'Decrease audio delay' }))
    expect(onChangeAudioDelay).toHaveBeenLastCalledWith(50)
    fireEvent.click(screen.getByRole('button', { name: 'Reset audio delay' }))
    expect(onChangeAudioDelay).toHaveBeenLastCalledWith(0)
  })

  it('disables Reset only when the delay is already 0', () => {
    const view = render(menu({ hasFile: true, audioDelayMs: 0 }))
    expect(
      (screen.getByRole('button', { name: 'Reset audio delay' }) as HTMLButtonElement).disabled
    ).toBe(true)
    view.unmount()

    render(menu({ hasFile: true, audioDelayMs: -250 }))
    expect(
      (screen.getByRole('button', { name: 'Reset audio delay' }) as HTMLButtonElement).disabled
    ).toBe(false)
  })

  it('disables the entire delay row when no file is loaded', () => {
    render(menu({ hasFile: false, audioDelayMs: -250 }))

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
    render(menu({ hasFile: true, audioDelayMs: 0, onChangeAudioDelay }))
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
    render(menu({ hasFile: true, audioDelayMs: 75, onChangeAudioDelay }))
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
    render(menu({ hasFile: true, audioDelayMs: 75, onChangeAudioDelay }))
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

describe('AudioMenu track selection', () => {
  it('forwards the picked track id', () => {
    const onSelectAudio = vi.fn()
    render(menu({ selectedAudioId: 1, onSelectAudio }))

    fireEvent.click(screen.getByRole('menuitemradio', { name: '[EN] ac3' }))
    expect(onSelectAudio).toHaveBeenCalledWith(2)
  })
})
