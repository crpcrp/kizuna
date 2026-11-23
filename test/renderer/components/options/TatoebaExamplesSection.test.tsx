// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import TatoebaExamplesSection from '@src/renderer/src/components/options/TatoebaExamplesSection'
import type { TatoebaExamplesView } from '@src/renderer/src/state/useTatoebaExamples'
import type { GrammarExamplesStatus } from '@src/shared/grammarExamples'

afterEach(cleanup)

const INFO = {
  dictionaryId: 'ipadic' as const,
  builtAt: '2026-11-22T10:00:00.000Z',
  exportDate: 'Sat, 21 Nov 2026 06:30:12 GMT',
  exampleCount: 123456
}

function view(
  status: GrammarExamplesStatus | undefined,
  overrides: Partial<TatoebaExamplesView> = {}
): TatoebaExamplesView {
  return {
    status,
    confirmBytes: undefined,
    checkingSize: false,
    sizeError: undefined,
    onRequestDownload: vi.fn(),
    onConfirmDownload: vi.fn(),
    onDismissDownload: vi.fn(),
    onUpdate: vi.fn(),
    onRebuild: vi.fn(),
    onCancel: vi.fn(),
    onRemove: vi.fn(),
    onOpenTatoeba: vi.fn(),
    onOpenLicense: vi.fn(),
    ...overrides
  }
}

const buttons = (): string[] =>
  screen
    .getAllByRole('button')
    .map((button) => button.textContent ?? '')
    .filter((text) => !['Tatoeba', 'CC BY 2.0 FR'].includes(text))

describe('TatoebaExamplesSection', () => {
  it('offers a download when not installed and confirms its size first', () => {
    const notInstalled = view({ state: 'not-installed', cached: false })
    const { rerender } = render(<TatoebaExamplesSection view={notInstalled} />)
    expect(screen.getByRole('status').textContent).toBe('Not installed')
    fireEvent.click(screen.getByRole('button', { name: 'Download examples' }))
    expect(notInstalled.onRequestDownload).toHaveBeenCalledOnce()

    const confirming = view({ state: 'not-installed', cached: false }, { confirmBytes: 31_714_960 })
    rerender(<TatoebaExamplesSection view={confirming} />)
    fireEvent.click(screen.getByRole('button', { name: 'Download 31.7 MB' }))
    expect(confirming.onConfirmDownload).toHaveBeenCalledOnce()
  })

  it.each([
    [
      { state: 'downloading', cached: false, progress: { done: 2_000_000, total: 31_700_000 } },
      'Downloading… 2.0 MB / 31.7 MB',
      ['Cancel']
    ],
    [
      { state: 'building', cached: true, progress: { done: 40, total: 100 } },
      'Building… 40 %',
      ['Cancel']
    ],
    [
      { state: 'out-of-date', cached: true, info: INFO },
      'Out of date',
      ['Update from Tatoeba', 'Rebuild', 'Remove']
    ],
    [
      { state: 'error', cached: false, error: 'Tatoeba returned HTTP 503' },
      'Error: Tatoeba returned HTTP 503',
      ['Retry']
    ]
  ] as Array<[GrammarExamplesStatus, string, string[]]>)('shows %j', (status, text, actions) => {
    render(<TatoebaExamplesSection view={view(status)} />)
    expect(screen.getByRole('status').textContent).toBe(text)
    expect(buttons()).toEqual(actions)
  })

  it('describes a ready database and its actions', () => {
    const ready = view({ state: 'ready', cached: true, info: INFO })
    window.confirm = vi.fn(() => true)
    render(<TatoebaExamplesSection view={ready} />)

    expect(screen.getByRole('status').textContent).toMatch(
      /^Ready: built with IPADIC from Tatoeba export of .+, 123,456 examples$/
    )
    fireEvent.click(screen.getByRole('button', { name: 'Update from Tatoeba' }))
    fireEvent.click(screen.getByRole('button', { name: 'Rebuild' }))
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    fireEvent.click(screen.getByRole('button', { name: 'CC BY 2.0 FR' }))
    expect(ready.onUpdate).toHaveBeenCalledOnce()
    expect(ready.onRebuild).toHaveBeenCalledOnce()
    expect(ready.onRemove).toHaveBeenCalledOnce()
    expect(ready.onOpenLicense).toHaveBeenCalledOnce()
  })
})
