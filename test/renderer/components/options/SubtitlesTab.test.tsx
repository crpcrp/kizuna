// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import SubtitlesTab, {
  describeTranslationKeyStorage
} from '@src/renderer/src/components/options/SubtitlesTab'
import { DEFAULT_SUBTITLE_STYLE } from '@src/shared/playerSettings'

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
      translationSettings={{ hasAzureKey: false }}
      onChangeSubtitleStyle={vi.fn()}
      onChangeSubtitleDragEnabled={vi.fn()}
      onChangeTranslationEnabled={vi.fn()}
      onSaveAzureTranslationKey={vi.fn(async () => true)}
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
      translationSettings: { hasAzureKey: true, encryptionAvailable: true }
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
      translationSettings: { hasAzureKey: true },
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

  it('renders translation load errors', () => {
    renderTab({ translationLoadError: 'Could not load translation settings.' })
    expect(screen.getByRole('alert').textContent).toBe('Could not load translation settings.')
  })
})
