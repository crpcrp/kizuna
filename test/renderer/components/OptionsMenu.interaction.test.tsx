// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import OptionsMenu, { type OptionsMenuProps } from '@src/renderer/src/components/OptionsMenu'
import { baseOptionsMenuProps } from './optionsMenuProps'
import { MPV_EXTRA_ARG_MAX_LENGTH } from '@src/shared/playerSettings'
import { APP_NAME } from '@src/shared/appInfo'

const noop = (): void => undefined

function renderMenu(translationEnabled = false, onChangeTranslationEnabled = vi.fn()): void {
  const base = baseOptionsMenuProps()
  render(
    <OptionsMenu
      {...base}
      subtitles={{ ...base.subtitles, translationEnabled, onChangeTranslationEnabled }}
    />
  )
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

function renderMenuWithScreenshot(
  screenshotFolder: string | null,
  onChangeScreenshotFolder = vi.fn()
): void {
  const base = baseOptionsMenuProps()
  render(
    <OptionsMenu
      {...base}
      playback={{ ...base.playback, screenshotFolder, onChangeScreenshotFolder }}
    />
  )
}

describe('OptionsMenu screenshot folder', () => {
  it('shows the stored folder and commits an edited value on blur', () => {
    const onChangeScreenshotFolder = vi.fn()
    renderMenuWithScreenshot('D:\\Shots', onChangeScreenshotFolder)

    fireEvent.click(screen.getByRole('tab', { name: 'Playback' }))
    const input = screen.getByLabelText(/^Screenshot folder/) as HTMLInputElement
    expect(input.value).toBe('D:\\Shots')

    fireEvent.change(input, { target: { value: '  E:\\Caps  ' } })
    fireEvent.blur(input)
    // Committed trimmed, not raw.
    expect(onChangeScreenshotFolder).toHaveBeenCalledWith('E:\\Caps')
  })

  it('commits an emptied field as null (restores the default)', () => {
    const onChangeScreenshotFolder = vi.fn()
    renderMenuWithScreenshot('D:\\Shots', onChangeScreenshotFolder)

    fireEvent.click(screen.getByRole('tab', { name: 'Playback' }))
    const input = screen.getByLabelText(/^Screenshot folder/) as HTMLInputElement
    fireEvent.change(input, { target: { value: '   ' } })
    fireEvent.blur(input)
    expect(onChangeScreenshotFolder).toHaveBeenCalledWith(null)
  })

  it('shows the placeholder and empty value when no folder is set', () => {
    renderMenuWithScreenshot(null)

    fireEvent.click(screen.getByRole('tab', { name: 'Playback' }))
    const input = screen.getByLabelText(/^Screenshot folder/) as HTMLInputElement
    expect(input.value).toBe('')
    expect(input.placeholder).toBe(`Pictures\\${APP_NAME} (default)`)
  })
})

function renderMenuWithPreferredUrlSubtitleLanguage(
  preferredUrlSubtitleLanguage: string,
  onChangePreferredUrlSubtitleLanguage = vi.fn()
): void {
  const base = baseOptionsMenuProps()
  render(
    <OptionsMenu
      {...base}
      playback={{
        ...base.playback,
        preferredUrlSubtitleLanguage,
        onChangePreferredUrlSubtitleLanguage
      }}
    />
  )
}

describe('OptionsMenu preferred online subtitle language', () => {
  it('shows the stored value and commits a normalized edited value on blur', () => {
    const onChangePreferredUrlSubtitleLanguage = vi.fn()
    renderMenuWithPreferredUrlSubtitleLanguage('en', onChangePreferredUrlSubtitleLanguage)

    fireEvent.click(screen.getByRole('tab', { name: 'Playback' }))
    const input = screen.getByLabelText(/^Preferred online subtitle language/) as HTMLInputElement
    expect(input.value).toBe('en')

    fireEvent.change(input, { target: { value: 'ja' } })
    fireEvent.blur(input)
    expect(onChangePreferredUrlSubtitleLanguage).toHaveBeenCalledWith('ja')
  })

  it('reverts the displayed value without committing on Escape', () => {
    const onChangePreferredUrlSubtitleLanguage = vi.fn()
    renderMenuWithPreferredUrlSubtitleLanguage('en', onChangePreferredUrlSubtitleLanguage)

    fireEvent.click(screen.getByRole('tab', { name: 'Playback' }))
    const input = screen.getByLabelText(/^Preferred online subtitle language/) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'ja' } })
    expect(input.value).toBe('ja')

    fireEvent.keyDown(input, { key: 'Escape' })
    expect(input.value).toBe('en')
    expect(onChangePreferredUrlSubtitleLanguage).not.toHaveBeenCalled()
  })
})

function renderMenuWithMpv(overrides: Partial<OptionsMenuProps['playback']>): void {
  const base = baseOptionsMenuProps()
  render(<OptionsMenu {...base} playback={{ ...base.playback, ...overrides }} />)
}

describe('OptionsMenu volume boost', () => {
  it('does not render a volume boost toggle', () => {
    renderMenu()
    fireEvent.click(screen.getByRole('tab', { name: 'Playback' }))
    expect(screen.queryByLabelText(/Enable volume boost/)).toBeNull()
  })
})

describe('OptionsMenu mpv config section', () => {
  it('reflects the enable flag and reports checkbox changes', () => {
    const onChangeMpvUserConfig = vi.fn()
    renderMenuWithMpv({ mpvUserConfig: false, onChangeMpvUserConfig })

    fireEvent.click(screen.getByRole('tab', { name: 'Playback' }))
    const checkbox = screen.getByLabelText(/Load my mpv config folder/) as HTMLInputElement
    expect(checkbox.checked).toBe(false)

    fireEvent.click(checkbox)
    expect(onChangeMpvUserConfig).toHaveBeenCalledWith(true)
  })

  it('shows stored extra args one per line and commits parsed args on blur', () => {
    const onChangeMpvExtraArgs = vi.fn()
    renderMenuWithMpv({
      mpvExtraArgs: ['--hwdec=auto', '--profile=gpu-hq'],
      onChangeMpvExtraArgs
    })

    fireEvent.click(screen.getByRole('tab', { name: 'Playback' }))
    const textarea = screen.getByLabelText(/Extra mpv arguments/) as HTMLTextAreaElement
    expect(textarea.value).toBe('--hwdec=auto\n--profile=gpu-hq')

    // Blank lines and surrounding whitespace are dropped on commit.
    fireEvent.change(textarea, { target: { value: '  --vo=gpu  \n\n--sub-scale=2\n' } })
    fireEvent.blur(textarea)
    expect(onChangeMpvExtraArgs).toHaveBeenCalledWith(['--vo=gpu', '--sub-scale=2'])
  })

  it('drops an over-length argument on commit so it matches what main persists', () => {
    const onChangeMpvExtraArgs = vi.fn()
    renderMenuWithMpv({ mpvExtraArgs: [], onChangeMpvExtraArgs })

    fireEvent.click(screen.getByRole('tab', { name: 'Playback' }))
    const textarea = screen.getByLabelText(/Extra mpv arguments/) as HTMLTextAreaElement
    const tooLong = '--x=' + 'a'.repeat(MPV_EXTRA_ARG_MAX_LENGTH)
    fireEvent.change(textarea, { target: { value: `--hwdec=auto\n${tooLong}` } })
    fireEvent.blur(textarea)
    // Only the in-range arg survives — the renderer never reports the over-long
    // one as saved.
    expect(onChangeMpvExtraArgs).toHaveBeenCalledWith(['--hwdec=auto'])
  })

  it('opens the mpv config folder when the button is clicked', () => {
    const onOpenMpvConfigDir = vi.fn()
    renderMenuWithMpv({ onOpenMpvConfigDir })

    fireEvent.click(screen.getByRole('tab', { name: 'Playback' }))
    fireEvent.click(screen.getByRole('button', { name: 'Open mpv config folder' }))
    expect(onOpenMpvConfigDir).toHaveBeenCalledTimes(1)
  })
})

describe('OptionsMenu experimental translation', () => {
  it('shows the persistent disclosure and reports controlled checkbox changes', () => {
    const onChangeTranslationEnabled = vi.fn()
    renderMenu(false, onChangeTranslationEnabled)

    fireEvent.click(screen.getByRole('tab', { name: 'Subtitles' }))
    const checkbox = screen.getByRole('checkbox', {
      name: 'Enable experimental subtitle translation'
    })
    expect((checkbox as HTMLInputElement).checked).toBe(false)
    expect(screen.getByText(/Google's unofficial online endpoint/)).not.toBeNull()
    expect(screen.getByText(/no API key is used/)).not.toBeNull()

    fireEvent.click(checkbox)
    expect(onChangeTranslationEnabled).toHaveBeenCalledWith(true)

    cleanup()
    renderMenu(true, onChangeTranslationEnabled)
    fireEvent.click(screen.getByRole('tab', { name: 'Subtitles' }))
    fireEvent.click(
      screen.getByRole('checkbox', { name: 'Enable experimental subtitle translation' })
    )
    expect(onChangeTranslationEnabled).toHaveBeenLastCalledWith(false)
    expect(screen.getByText(/Google's unofficial online endpoint/)).not.toBeNull()
  })
})

// OptionsToggleRow's own test covers what a switch-only row does; this is the
// one that says every boolean setting in the dialog actually uses it, so the
// pattern can't come undone one setting at a time.
describe('OptionsMenu boolean rows', () => {
  /** Every OptionsToggle in the dialog, by checkbox id. A new boolean setting
   * belongs here. */
  const TOGGLE_IDS = [
    'auto-play-next-checkbox',
    'right-click-toggle-pause-checkbox',
    'loudness-normalization-checkbox',
    'mpv-user-config-checkbox',
    'subtitle-drag-enabled',
    'translation-enabled',
    'anki-include-audio-checkbox',
    'coloring-enabled-checkbox'
  ]

  it('names every switch from visible text, with no label pointing at it', () => {
    render(<OptionsMenu {...baseOptionsMenuProps()} />)

    const found = new Set<string>()
    // Playback and Subtitles stay mounted once shown; Anki and Known words are
    // separate components, so their tab has to be opened to see their rows.
    for (const tab of ['Playback', 'Subtitles', 'Anki', 'Known words']) {
      fireEvent.click(screen.getByRole('tab', { name: tab }))
      for (const input of document.querySelectorAll('.options-toggle-input')) {
        found.add(input.id)
        const titleId = input.getAttribute('aria-labelledby')
        expect(titleId, `${input.id} has no accessible name`).not.toBeNull()
        expect(document.getElementById(titleId as string)?.textContent).toBeTruthy()
        expect(
          document.querySelector(`label[for="${input.id}"]`),
          `${input.id} is label-associated again, so its row text toggles it`
        ).toBeNull()
      }
    }

    expect([...found].sort()).toEqual([...TOGGLE_IDS].sort())
  })
})

describe('OptionsMenu rebind lifecycle', () => {
  function menu(open: boolean, onChangeKeyBinding = noop): React.JSX.Element {
    return (
      <OptionsMenu
        {...baseOptionsMenuProps()}
        open={open}
        keybindings={{ ...baseOptionsMenuProps().keybindings, onChangeKeyBinding }}
      />
    )
  }

  it('cancels an armed rebind when the dialog closes, and does not capture keys afterwards', () => {
    const onChangeKeyBinding = vi.fn()
    const { rerender } = render(menu(true, onChangeKeyBinding))
    const button = screen.getByLabelText('Rebind Play / Pause')

    fireEvent.click(button)
    expect(button.textContent).toBe('Press a key…')

    rerender(menu(false, onChangeKeyBinding))
    fireEvent.keyDown(window, { code: 'KeyJ' })
    expect(onChangeKeyBinding).not.toHaveBeenCalled()

    rerender(menu(true, onChangeKeyBinding))
    expect(screen.getByLabelText('Rebind Play / Pause').textContent).not.toBe('Press a key…')
  })
})

describe('OptionsMenu audio output', () => {
  const devices = [
    { name: 'auto', description: 'Autoselect device' },
    { name: 'wasapi/{abc}', description: 'Speakers (Realtek)' }
  ]

  function renderAudio(overrides: Partial<OptionsMenuProps['playback']> = {}): void {
    const base = baseOptionsMenuProps()
    render(
      <OptionsMenu {...base} playback={{ ...base.playback, audioDevices: devices, ...overrides }} />
    )
    fireEvent.click(screen.getByRole('tab', { name: 'Playback' }))
  }

  it('lists the auto entry even before mpv reported any device', () => {
    renderAudio({ audioDevices: [] })

    const select = screen.getByLabelText(/Output device/) as HTMLSelectElement
    expect([...select.options].map((o) => o.value)).toEqual(['auto'])
    expect(select.value).toBe('auto')
  })

  it('selects a device by its mpv name', () => {
    const onSelectAudioDevice = vi.fn()
    renderAudio({ onSelectAudioDevice })

    const select = screen.getByLabelText(/Output device/) as HTMLSelectElement
    expect([...select.options].map((o) => o.textContent)).toEqual([
      'Autoselect device',
      'Speakers (Realtek)'
    ])
    fireEvent.change(select, { target: { value: 'wasapi/{abc}' } })

    expect(onSelectAudioDevice).toHaveBeenCalledWith('wasapi/{abc}')
  })

  it('shows the stored device as the selected option', () => {
    renderAudio({ selectedAudioDevice: 'wasapi/{abc}' })

    expect((screen.getByLabelText(/Output device/) as HTMLSelectElement).value).toBe('wasapi/{abc}')
  })

  it('toggles loudness normalization', () => {
    const onToggleLoudnessNorm = vi.fn()
    renderAudio({ loudnessNormalization: true, onToggleLoudnessNorm })

    const checkbox = screen.getByLabelText(/Normalize loudness/) as HTMLInputElement
    expect(checkbox.checked).toBe(true)
    fireEvent.click(checkbox)

    expect(onToggleLoudnessNorm).toHaveBeenCalledOnce()
  })

  it('requests a fresh device list when the Playback tab becomes active', () => {
    const onAudioDevicesRequest = vi.fn()
    const base = baseOptionsMenuProps()
    render(<OptionsMenu {...base} playback={{ ...base.playback, onAudioDevicesRequest }} />)
    // Opens on Keybindings, so nothing is requested until Playback is shown.
    expect(onAudioDevicesRequest).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('tab', { name: 'Playback' }))

    expect(onAudioDevicesRequest).toHaveBeenCalledOnce()
  })

  it('requests a fresh device list when the open dialog is reopened on Playback', () => {
    const onAudioDevicesRequest = vi.fn()
    const base = baseOptionsMenuProps()
    const { rerender } = render(
      <OptionsMenu {...base} open playback={{ ...base.playback, onAudioDevicesRequest }} />
    )

    fireEvent.click(screen.getByRole('tab', { name: 'Playback' }))
    expect(onAudioDevicesRequest).toHaveBeenCalledOnce()

    rerender(
      <OptionsMenu {...base} open={false} playback={{ ...base.playback, onAudioDevicesRequest }} />
    )
    rerender(<OptionsMenu {...base} open playback={{ ...base.playback, onAudioDevicesRequest }} />)
    expect(onAudioDevicesRequest).toHaveBeenCalledTimes(2)
  })

})
