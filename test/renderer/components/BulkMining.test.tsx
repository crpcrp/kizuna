// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import BulkMining, { type BulkMiningProps } from '@src/renderer/src/components/BulkMining'
import type { BulkMiningReadyPhase } from '@src/renderer/src/state/bulkMining'
import { makeLookupResult } from '@test/harness/dictFixtures'
import { makeToken } from '@test/harness/tokenFixtures'

const candidates = [
  {
    lemma: '食べる',
    token: makeToken({ surface: '食べた', lemma: '食べる' }),
    sentence: '食べた',
    count: 2
  },
  { lemma: '猫', token: makeToken({ surface: '猫' }), sentence: '猫', count: 1 }
]
function ready(overrides: Partial<BulkMiningReadyPhase> = {}): BulkMiningReadyPhase {
  return {
    kind: 'ready',
    candidates,
    resolving: false,
    threshold: null,
    minimumCount: null,
    sort: 'count',
    selected: { 食べる: true, 猫: false },
    resolved: {},
    targetDeckMatches: {},
    checkingTargetDeck: false,
    hideTargetDeckMatches: false,
    ...overrides
  }
}
function props(overrides: Partial<BulkMiningProps> = {}): BulkMiningProps {
  return {
    phase: ready(),
    frequencyDictConfigured: true,
    onThresholdChange: vi.fn(),
    onMinimumCountChange: vi.fn(),
    onSortChange: vi.fn(),
    onToggle: vi.fn(),
    onSelectAll: vi.fn(),
    onSelectNone: vi.fn(),
    onSetHideTargetDeckMatches: vi.fn(),
    onStart: vi.fn(),
    onCancel: vi.fn(),
    onClose: vi.fn(),
    onBackToList: vi.fn(),
    onRetry: vi.fn(),
    ...overrides
  }
}
afterEach(cleanup)

describe('BulkMining presentation and controls', () => {
  it('renders preparation and error states with their own actions', () => {
    const callbacks = props({ phase: { kind: 'preparing' } })
    const view = render(<BulkMining {...callbacks} />)
    expect(screen.getByRole('status').textContent).toContain('Preparing')
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(callbacks.onClose).toHaveBeenCalledOnce()
    view.rerender(
      <BulkMining {...callbacks} phase={{ kind: 'error', message: 'Dictionary unavailable' }} />
    )
    expect(screen.getByRole('alert').textContent).toBe('Dictionary unavailable')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(callbacks.onRetry).toHaveBeenCalledOnce()
  })

  it('wires filters, row selection, selection actions, and start through DOM events', () => {
    const callbacks = props()
    render(<BulkMining {...callbacks} />)
    fireEvent.change(screen.getByLabelText('Maximum frequency'), { target: { value: '5000' } })
    fireEvent.change(screen.getByLabelText('Minimum count'), { target: { value: '3' } })
    fireEvent.change(screen.getByLabelText('Sort unknown words'), {
      target: { value: 'frequency' }
    })
    fireEvent.click(screen.getByLabelText('Hide words already in target deck'))
    fireEvent.click(screen.getByLabelText('Mine 猫'))
    fireEvent.click(screen.getByRole('button', { name: 'Select all' }))
    fireEvent.click(screen.getByRole('button', { name: 'Select none' }))
    fireEvent.click(screen.getByRole('button', { name: 'Mine 1 words' }))
    expect(callbacks.onThresholdChange).toHaveBeenCalledWith('5000')
    expect(callbacks.onMinimumCountChange).toHaveBeenCalledWith('3')
    expect(callbacks.onSortChange).toHaveBeenCalledWith('frequency')
    expect(callbacks.onSetHideTargetDeckMatches).toHaveBeenCalledWith(true)
    expect(callbacks.onToggle).toHaveBeenCalledWith('猫')
    expect(callbacks.onSelectAll).toHaveBeenCalledOnce()
    expect(callbacks.onSelectNone).toHaveBeenCalledOnce()
    expect(callbacks.onStart).toHaveBeenCalledOnce()
  })

  it('uses the combined model filters for both rows and the mine count', () => {
    const phase = ready({
      minimumCount: 2,
      threshold: 15,
      hideTargetDeckMatches: true,
      resolved: {
        食べる: {
          entry: makeLookupResult({ expression: '食べる', frequencyDisplay: '12k' }),
          frequency: 12
        }
      },
      targetDeckMatches: { 猫: { cardId: 1, deckNames: ['Mining'] } },
      checkingTargetDeck: true,
      advisoryWarning: 'Could not finish checking Anki.'
    })
    render(<BulkMining {...props({ phase, targetDeckName: 'Mining' })} />)
    expect(screen.getByLabelText('Mine 食べる')).toBeTruthy()
    expect(screen.queryByLabelText('Mine 猫')).toBeNull()
    expect(screen.getByText('12k')).toBeTruthy()
    expect(screen.getByText('Showing 1 of 2 unknown words')).toBeTruthy()
    expect(screen.getByText('Checking target deck…')).toBeTruthy()
    expect(screen.getByText('Could not finish checking Anki.')).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: 'Mine 1 words' }) as HTMLButtonElement).disabled
    ).toBe(false)
  })

  it('passes the chosen sort to the displayed rows', () => {
    const phase = ready({
      resolved: {
        食べる: { entry: makeLookupResult({ expression: '食べる' }), frequency: 20 },
        猫: { entry: makeLookupResult(), frequency: 10 }
      }
    })
    const view = render(<BulkMining {...props({ phase })} />)
    const rowLabels = () =>
      screen
        .getAllByRole('checkbox')
        .slice(1)
        .map((row) => row.getAttribute('aria-label'))
    expect(rowLabels()).toEqual(['Mine 食べる', 'Mine 猫'])
    view.rerender(<BulkMining {...props({ phase: { ...phase, sort: 'frequency' } })} />)
    expect(rowLabels()).toEqual(['Mine 猫', 'Mine 食べる'])
  })

  it('disables only frequency controls without a dictionary and mining while resolving', () => {
    const callbacks = props({ frequencyDictConfigured: false, phase: ready({ resolving: true }) })
    const view = render(<BulkMining {...callbacks} />)
    expect((screen.getByLabelText('Maximum frequency') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByRole('option', { name: 'Frequency' }) as HTMLOptionElement).disabled).toBe(
      true
    )
    expect((screen.getByLabelText('Minimum count') as HTMLInputElement).disabled).toBe(false)
    expect(screen.getByText(/please wait before mining/)).toBeTruthy()
    const button = screen.getByRole('button', { name: 'Mine 1 words' }) as HTMLButtonElement
    fireEvent.click(button)
    expect(callbacks.onStart).not.toHaveBeenCalled()
    expect(button.disabled).toBe(true)
    view.rerender(<BulkMining {...callbacks} phase={ready()} />)
    expect(button.disabled).toBe(false)
  })

  it('renders pending and missing entries, disabling selection only for missing entries', () => {
    render(
      <BulkMining
        {...props({ phase: ready({ resolved: { 猫: { entry: null, frequency: null } } }) })}
      />
    )
    expect(document.querySelector('.bulk-mining-pending')).not.toBeNull()
    expect(screen.getByText('no entry')).toBeTruthy()
    expect((screen.getByLabelText('Mine 猫') as HTMLInputElement).disabled).toBe(true)
    expect((screen.getByLabelText('Mine 食べる') as HTMLInputElement).disabled).toBe(false)
  })

  it('shows hidden-frequency and target-deck explanations and an empty filtered list', () => {
    const phase = ready({
      threshold: 5000,
      hideTargetDeckMatches: true,
      resolved: {
        食べる: { entry: makeLookupResult({ expression: '食べる' }), frequency: null },
        猫: { entry: makeLookupResult(), frequency: 10 }
      },
      targetDeckMatches: { 猫: { cardId: 1, deckNames: ['Mining'] } }
    })
    render(<BulkMining {...props({ phase, targetDeckName: 'Mining' })} />)
    expect(screen.getByText('1 words without frequency data are hidden.')).toBeTruthy()
    expect(screen.getByText('1 already in Mining hidden')).toBeTruthy()
    expect(screen.getByText('No words match the current filters.')).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
    expect(
      (screen.getByRole('button', { name: 'Mine 0 words' }) as HTMLButtonElement).disabled
    ).toBe(true)
  })

  it('keeps progress visible and disables Cancel while cancellation is pending', () => {
    const phase = {
      kind: 'running' as const,
      candidates,
      statuses: { 食べる: { kind: 'added' as const }, 猫: { kind: 'mining' as const } },
      cancelling: false
    }
    const callbacks = props({ phase })
    const view = render(<BulkMining {...callbacks} />)
    expect(screen.getByText('Mined 1 of 2')).toBeTruthy()
    expect(document.querySelector('[data-status="mining"]')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(callbacks.onCancel).toHaveBeenCalledOnce()
    view.rerender(<BulkMining {...callbacks} phase={{ ...phase, cancelling: true }} />)
    expect(
      (screen.getByRole('button', { name: 'Cancelling…' }) as HTMLButtonElement).disabled
    ).toBe(true)
    expect(screen.getByText('Mined 1 of 2')).toBeTruthy()
  })

  it('shows terminal errors and summary buckets and returns to the list without closing', () => {
    const callbacks = props({
      phase: {
        kind: 'done',
        candidates,
        statuses: {
          食べる: { kind: 'error', message: 'Anki disconnected' },
          猫: { kind: 'updated' }
        },
        summary: { added: 0, updated: 1, duplicate: 0, noEntry: 0, error: 1, cancelled: 0 },
        abortMessage: 'Anki is unavailable'
      }
    })
    render(<BulkMining {...callbacks} />)
    expect(screen.getByText('Updated')).toBeTruthy()
    expect(screen.getByText('1 updated · 1 errors')).toBeTruthy()
    expect(screen.getByText(/Anki disconnected/)).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toBe('Anki is unavailable')
    fireEvent.click(screen.getByRole('button', { name: 'Back to word list' }))
    expect(callbacks.onBackToList).toHaveBeenCalledOnce()
    expect(callbacks.onClose).not.toHaveBeenCalled()
  })

  it('renders duplicate provenance as text, including unavailable deck names', () => {
    render(
      <BulkMining
        {...props({
          phase: {
            kind: 'done',
            candidates,
            statuses: {
              食べる: {
                kind: 'duplicate',
                deckNames: ['Long Deck Name That Must Wrap', '<Target Deck>']
              },
              猫: { kind: 'duplicate', deckNames: [] }
            },
            summary: { added: 0, updated: 0, duplicate: 2, noEntry: 0, error: 0, cancelled: 0 }
          }
        })}
      />
    )
    expect(
      screen.getByText('Duplicate in: Long Deck Name That Must Wrap, <Target Deck>')
    ).toBeTruthy()
    expect(screen.getByText('Duplicate (deck unavailable)')).toBeTruthy()
    expect(document.querySelector('target')).toBeNull()
    expect(screen.getByText('2 duplicates')).toBeTruthy()
  })

  it('renders nothing while idle and explains unavailable vocabulary', () => {
    const callbacks = props({ phase: { kind: 'idle' } })
    const view = render(<BulkMining {...callbacks} />)
    expect(view.container.innerHTML).toBe('')
    view.rerender(<BulkMining {...callbacks} phase={{ kind: 'unavailable' }} />)
    expect(screen.getByRole('status').textContent).toContain('No Japanese subtitle vocabulary')
  })
})
