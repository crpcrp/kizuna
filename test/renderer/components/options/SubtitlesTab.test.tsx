// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SubtitlesTab, {
  describeJimakuKeyStorage,
  describeJimakuTestOutcome,
  describeTranslationKeyStorage
} from '@src/renderer/src/components/options/SubtitlesTab'
import { DEFAULT_SUBTITLE_STYLE } from '@src/shared/playerSettings'
import type { JimakuSettingsStatus } from '@src/shared/jimaku'

afterEach(cleanup)

function renderTab(
  overrides: Partial<React.ComponentProps<typeof SubtitlesTab>> = {}
): ReturnType<typeof render> {
  return render(
    <SubtitlesTab
      active
      subtitleStyle={DEFAULT_SUBTITLE_STYLE}
      subtitleDragEnabled={true}
      translationEnabled={false}
      translationSettings={{ hasAzureKey: false, azureRegion: '' }}
      onChangeSubtitleStyle={vi.fn()}
      onChangeSubtitleDragEnabled={vi.fn()}
      onChangeTranslationEnabled={vi.fn()}
      onSaveAzureTranslationKey={vi.fn(async () => true)}
      onSaveAzureTranslationRegion={vi.fn(async () => true)}
      onSaveJimakuApiKey={vi.fn(async () => undefined)}
      onTestJimakuConnection={vi.fn(async () => undefined)}
      onClearJimakuApiKey={vi.fn(async () => undefined)}
      onOpenJimakuAccount={vi.fn()}
      {...overrides}
    />
  )
}

describe('describeTranslationKeyStorage', () => {
  it('describes secure storage when available', () => {
    const text = describeTranslationKeyStorage(true)
    expect(text).toContain('encrypted with your operating system')
    expect(text).toContain('sent to Microsoft Azure only when you explicitly request translation')
    expect(text).not.toContain('unencrypted')
  })

  it('describes the unencrypted fallback when secure storage is unavailable', () => {
    const text = describeTranslationKeyStorage(false)
    expect(text).toContain('fallback is unencrypted')
    expect(text).not.toContain('encrypted with your operating system')
  })

  it('makes no encryption claim while settings are unknown', () => {
    const text = describeTranslationKeyStorage(undefined)
    expect(text).toContain('stored locally')
    expect(text).not.toMatch(/encrypted|unencrypted|secure store/)
  })
})

describe('Jimaku option helpers', () => {
  it('warns about unavailable storage without making a claim while loading', () => {
    expect(describeJimakuKeyStorage(false)).toContain('without encryption')
    expect(describeJimakuKeyStorage(undefined)).toContain('still being checked')
    expect(describeJimakuKeyStorage(undefined)).not.toContain('without encryption')
  })

  it('sanitizes connection outcomes and includes a valid retry time', () => {
    expect(describeJimakuTestOutcome({ status: 'connected' })).toContain(
      'read-only API check succeeded'
    )
    expect(
      describeJimakuTestOutcome({
        status: 'error',
        error: { code: 'unauthorized' }
      })
    ).toBe('Invalid API key.')
    expect(
      describeJimakuTestOutcome({
        status: 'error',
        error: { code: 'rateLimited', retryAt: '2026-09-09T12:00:00.000Z' }
      })
    ).toContain('Rate limited. Try again after')
    expect(
      describeJimakuTestOutcome({
        status: 'error',
        error: { code: 'network' }
      })
    ).toContain('could not be reached')
  })
})

describe('SubtitlesTab Azure Translator controls', () => {
  it('renders an unconfigured password field without a saved key', () => {
    renderTab()

    const input = screen.getByLabelText('Azure Translator API key') as HTMLInputElement
    expect(input.type).toBe('password')
    expect(input.autocomplete).toBe('off')
    expect(input.placeholder).toBe('Paste your API key')
    expect(input.value).toBe('')
    expect(screen.getByText('Not set')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Clear' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows only a fixed mask for a configured key', () => {
    renderTab({
      translationSettings: { hasAzureKey: true, azureRegion: '', encryptionAvailable: true }
    })

    const input = screen.getByLabelText('Azure Translator API key') as HTMLInputElement
    expect(input.placeholder).toBe('••••••••')
    expect(input.value).toBe('')
    expect(screen.getByText('Configured ✓')).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Clear' }) as HTMLButtonElement).disabled).toBe(
      false
    )
    expect(document.body.textContent).not.toContain('test-azure-key')
  })

  it('saves a draft and clears it only after success', async () => {
    const onSaveAzureTranslationKey = vi.fn(async () => true)
    renderTab({ onSaveAzureTranslationKey })

    const input = screen.getByLabelText('Azure Translator API key') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'test-azure-key' } })
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(onSaveAzureTranslationKey).toHaveBeenCalledWith('test-azure-key'))
    await waitFor(() => expect(input.value).toBe(''))
  })

  it('keeps a failed draft and sends an empty patch for Clear', async () => {
    const onSaveAzureTranslationKey = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    renderTab({
      translationSettings: { hasAzureKey: true, azureRegion: '' },
      onSaveAzureTranslationKey
    })

    const input = screen.getByLabelText('Azure Translator API key') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'replacement-key' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSaveAzureTranslationKey).toHaveBeenCalledWith('replacement-key'))
    expect(input.value).toBe('replacement-key')

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    await waitFor(() => expect(onSaveAzureTranslationKey).toHaveBeenLastCalledWith(''))
    expect(input.value).toBe('')
  })

  it('saves and clears the regional-resource header independently of the key', async () => {
    const onSaveAzureTranslationRegion = vi.fn(async () => true)
    renderTab({
      translationSettings: { hasAzureKey: true, azureRegion: 'westeurope' },
      onSaveAzureTranslationRegion
    })

    const input = screen.getByLabelText(/^Azure resource region/) as HTMLInputElement
    expect(document.body.textContent).toContain('enter northeurope')
    expect(document.body.textContent).toContain('North Europe')
    expect(input.value).toBe('westeurope')
    fireEvent.change(input, { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save region' }))

    await waitFor(() => expect(onSaveAzureTranslationRegion).toHaveBeenCalledWith(''))
  })

  it('renders translation load errors', () => {
    renderTab({ translationLoadError: 'Could not load translation settings.' })
    expect(screen.getByRole('alert').textContent).toBe('Could not load translation settings.')
  })
})

describe('SubtitlesTab Jimaku controls', () => {
  const configuredStatus = {
    configured: true,
    secretStorageAvailable: true,
    testOutcome: { status: 'notTested' as const }
  }

  it('renders an unconfigured blank key and opens the fixed account link through its callback', () => {
    const onOpenJimakuAccount = vi.fn()
    renderTab({ onOpenJimakuAccount })

    const input = screen.getByLabelText('Paste API key') as HTMLInputElement
    expect(input.type).toBe('password')
    expect(input.value).toBe('')
    expect(screen.getByText('Checking…')).toBeTruthy()
    expect((document.getElementById('jimaku-api-key-save') as HTMLButtonElement).disabled).toBe(
      true
    )
    expect((document.getElementById('jimaku-api-key-test') as HTMLButtonElement).disabled).toBe(
      true
    )

    fireEvent.click(screen.getByRole('button', { name: 'Open Jimaku account' }))
    expect(onOpenJimakuAccount).toHaveBeenCalledOnce()
  })

  it('tests only the saved key and disables testing for an unsaved draft', () => {
    const onTestJimakuConnection = vi.fn(async () => ({
      ...configuredStatus,
      testOutcome: { status: 'connected' as const }
    }))
    renderTab({ jimakuSettings: configuredStatus, onTestJimakuConnection })

    const input = screen.getByLabelText('Paste API key') as HTMLInputElement
    const test = document.getElementById('jimaku-api-key-test') as HTMLButtonElement
    expect(test.disabled).toBe(false)

    fireEvent.change(input, { target: { value: 'replacement-key' } })
    expect(test.disabled).toBe(true)
    expect(screen.getByText(/uses the saved key/)).toBeTruthy()
  })

  it('clears a saved key draft only after a successful save and removal', async () => {
    const onSaveJimakuApiKey = vi.fn(async () => configuredStatus)
    const onClearJimakuApiKey = vi.fn(async () => ({
      ...configuredStatus,
      configured: false
    }))
    renderTab({
      jimakuSettings: configuredStatus,
      onSaveJimakuApiKey,
      onClearJimakuApiKey
    })

    const input = screen.getByLabelText('Paste API key') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'new-key' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save key' }))
    await waitFor(() => expect(onSaveJimakuApiKey).toHaveBeenCalledWith('new-key'))
    await waitFor(() => expect(input.value).toBe(''))

    fireEvent.change(input, { target: { value: 'unfinished' } })
    fireEvent.click(screen.getByRole('button', { name: 'Remove key' }))
    await waitFor(() => expect(onClearJimakuApiKey).toHaveBeenCalledOnce())
    await waitFor(() => expect(input.value).toBe(''))
  })

  it('keeps a failed save draft and ignores a stale test result after a newer edit', async () => {
    let resolveTest!: (status: JimakuSettingsStatus) => void
    const onTestJimakuConnection = vi.fn(
      () => new Promise<JimakuSettingsStatus>((resolve) => (resolveTest = resolve))
    )
    renderTab({
      jimakuSettings: configuredStatus,
      onTestJimakuConnection,
      onSaveJimakuApiKey: vi.fn(async () => undefined)
    })

    const input = screen.getByLabelText('Paste API key') as HTMLInputElement
    fireEvent.click(screen.getByRole('button', { name: 'Test connection' }))
    expect(onTestJimakuConnection).toHaveBeenCalledOnce()

    fireEvent.change(input, { target: { value: 'newer-key' } })
    resolveTest({ ...configuredStatus, testOutcome: { status: 'connected' } })
    await waitFor(() => expect(screen.queryByText(/read-only API check succeeded/)).toBeNull())
    expect(input.value).toBe('newer-key')

    const failedSave = vi.fn(async () => undefined)
    cleanup()
    renderTab({
      jimakuSettings: configuredStatus,
      onSaveJimakuApiKey: failedSave
    })
    const failedInput = screen.getByLabelText('Paste API key') as HTMLInputElement
    fireEvent.change(failedInput, { target: { value: 'keep-me' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save key' }))
    await waitFor(() => expect(failedSave).toHaveBeenCalledWith('keep-me'))
    expect(failedInput.value).toBe('keep-me')
  })

  it('clears the transient input when the dialog closes', () => {
    const base = { ...configuredStatus }
    const { rerender } = render(
      <SubtitlesTab
        key="open"
        active
        subtitleStyle={DEFAULT_SUBTITLE_STYLE}
        subtitleDragEnabled={true}
        translationEnabled={false}
        translationSettings={{ hasAzureKey: false, azureRegion: '' }}
        onChangeSubtitleStyle={vi.fn()}
        onChangeSubtitleDragEnabled={vi.fn()}
        onChangeTranslationEnabled={vi.fn()}
        onSaveAzureTranslationKey={vi.fn(async () => true)}
        onSaveAzureTranslationRegion={vi.fn(async () => true)}
        jimakuSettings={base}
        onSaveJimakuApiKey={vi.fn(async () => undefined)}
        onTestJimakuConnection={vi.fn(async () => undefined)}
        onClearJimakuApiKey={vi.fn(async () => undefined)}
        onOpenJimakuAccount={vi.fn()}
      />
    )
    const input = screen.getByLabelText('Paste API key') as HTMLInputElement
    fireEvent.change(input, { target: { value: 'transient' } })
    rerender(
      <SubtitlesTab
        key="closed"
        active
        subtitleStyle={DEFAULT_SUBTITLE_STYLE}
        subtitleDragEnabled={true}
        translationEnabled={false}
        translationSettings={{ hasAzureKey: false, azureRegion: '' }}
        onChangeSubtitleStyle={vi.fn()}
        onChangeSubtitleDragEnabled={vi.fn()}
        onChangeTranslationEnabled={vi.fn()}
        onSaveAzureTranslationKey={vi.fn(async () => true)}
        onSaveAzureTranslationRegion={vi.fn(async () => true)}
        jimakuSettings={base}
        onSaveJimakuApiKey={vi.fn(async () => undefined)}
        onTestJimakuConnection={vi.fn(async () => undefined)}
        onClearJimakuApiKey={vi.fn(async () => undefined)}
        onOpenJimakuAccount={vi.fn()}
      />
    )
    expect((screen.getByLabelText('Paste API key') as HTMLInputElement).value).toBe('')
  })
})
