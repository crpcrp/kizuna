// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import JlptBulkExportModal, {
  type JlptBulkExportModalProps
} from '@src/renderer/src/components/JlptBulkExportModal'
import type { LookupResult } from '@src/shared/dictionary'
import type { BulkMiningPhase } from '@src/renderer/src/state/bulkMiningController'
import type { JlptMiningCandidate } from '@src/renderer/src/state/jlptMining'
import { makeLookupResult } from '@test/harness/dictFixtures'
import { makeToken } from '@test/harness/tokenFixtures'

afterEach(cleanup)

function candidate(
  expression: string,
  overrides: Partial<JlptMiningCandidate> = {}
): JlptMiningCandidate {
  return {
    lemma: expression,
    token: makeToken({ surface: expression, lemma: expression }),
    sentence: '',
    count: 1,
    kind: 'vocabulary',
    level: 'N3',
    fallbackFrequency: null,
    ...overrides
  }
}

function resolved(
  expression: string,
  frequency: number | null,
  overrides: Partial<LookupResult> = {}
) {
  return {
    entry:
      frequency === null && overrides.expression === undefined && overrides.dictId === undefined
        ? makeLookupResult({ expression, frequency })
        : makeLookupResult({ expression, frequency, ...overrides }),
    frequency
  }
}

function readyPhase(
  candidates: JlptMiningCandidate[],
  overrides: Partial<Extract<BulkMiningPhase, { kind: 'ready' }>> = {}
): Extract<BulkMiningPhase, { kind: 'ready' }> {
  return {
    kind: 'ready',
    candidates,
    resolved: Object.fromEntries(candidates.map((item) => [item.lemma, resolved(item.lemma, 10)])),
    resolving: false,
    selected: Object.fromEntries(candidates.map((item) => [item.lemma, true])),
    threshold: null,
    minimumCount: null,
    sort: 'frequency',
    targetDeckMatches: {},
    checkingTargetDeck: false,
    hideTargetDeckMatches: false,
    ...overrides
  }
}

function modalProps(
  phase: BulkMiningPhase = { kind: 'idle' },
  overrides: Partial<JlptBulkExportModalProps> = {}
): JlptBulkExportModalProps {
  return {
    open: true,
    presentation: 'open',
    throughLevel: 'N3',
    mode: 'vocabulary',
    phase,
    frequencyDictConfigured: true,
    targetDeckName: 'Mining',
    onClose: vi.fn(),
    onRetry: vi.fn(),
    onThroughLevelChange: vi.fn(),
    onModeChange: vi.fn(),
    onToggle: vi.fn(),
    onSelectAll: vi.fn(),
    onSelectNone: vi.fn(),
    onSetHideTargetDeckMatches: vi.fn(),
    onStart: vi.fn(),
    onCancel: vi.fn(),
    onBackToList: vi.fn(),
    ...overrides
  }
}

describe('JlptBulkExportModal ready state', () => {
  it('renders the controls, exact rows, frequency order, and selected export count', () => {
    const cat = candidate('猫', {
      token: makeToken({ surface: '猫', reading: 'ねこ' }),
      level: 'N4'
    })
    const dog = candidate('犬', {
      token: makeToken({ surface: '犬', reading: 'いぬ' }),
      level: 'N3'
    })
    const kanji = candidate('日', {
      kind: 'kanji',
      token: makeToken({ surface: '日', reading: '' }),
      level: 'N5'
    })
    const phase = readyPhase([cat, dog, kanji], {
      resolved: {
        猫: resolved('猫', 30, { frequencyDisplay: '30th' }),
        犬: resolved('犬', 5),
        日: resolved('日', 12)
      }
    })

    render(<JlptBulkExportModal {...modalProps(phase)} />)

    expect(screen.getByRole('dialog', { name: 'JLPT unknown-item export' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'JLPT unknown-item export' })).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Through level' })).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Item type' })).toBeTruthy()
    expect(
      Array.from(
        screen.getByRole('combobox', { name: 'Through level' }).querySelectorAll('option')
      ).map((option) => option.textContent)
    ).toEqual(['N5', 'N4', 'N3', 'N2', 'N1'])
    expect(
      Array.from(
        screen.getByRole('combobox', { name: 'Item type' }).querySelectorAll('option')
      ).map((option) => option.textContent)
    ).toEqual(['Vocabulary', 'Kanji', 'Kanji + vocabulary'])

    expect(screen.getByText('Showing 3 of 3 unknown items')).toBeTruthy()
    expect(screen.getByText('30th')).toBeTruthy()
    expect(screen.getByRole('table').querySelector('caption')?.textContent).toBe(
      'Unknown JLPT export candidates'
    )
    const rows = Array.from(screen.getByRole('table').querySelectorAll('tbody tr')) as HTMLElement[]
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining('犬'),
      expect.stringContaining('日'),
      expect.stringContaining('猫')
    ])
    expect(within(rows[0]).getByText('Vocabulary')).toBeTruthy()
    expect(within(rows[1]).getByText('Kanji')).toBeTruthy()
    expect(within(rows[1]).getByText('—')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Export 3 items' })).toBeTruthy()
  })

  it('routes target, mode, selection, target-deck, and export actions', () => {
    const props = modalProps(readyPhase([candidate('猫')]))
    render(<JlptBulkExportModal {...props} />)

    fireEvent.change(screen.getByRole('combobox', { name: 'Through level' }), {
      target: { value: 'N2' }
    })
    fireEvent.change(screen.getByRole('combobox', { name: 'Item type' }), {
      target: { value: 'both' }
    })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Hide items already in target deck' }))
    fireEvent.click(screen.getByRole('button', { name: 'Select all' }))
    fireEvent.click(screen.getByRole('button', { name: 'Select none' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Vocabulary 猫' }))
    fireEvent.click(screen.getByRole('button', { name: 'Export 1 items' }))

    expect(props.onThroughLevelChange).toHaveBeenCalledWith('N2')
    expect(props.onModeChange).toHaveBeenCalledWith('both')
    expect(props.onSetHideTargetDeckMatches).toHaveBeenCalledWith(true)
    expect(props.onSelectAll).toHaveBeenCalledOnce()
    expect(props.onSelectNone).toHaveBeenCalledOnce()
    expect(props.onToggle).toHaveBeenCalledWith('猫')
    expect(props.onStart).toHaveBeenCalledOnce()
  })

  it('shows the no-dictionary advice without disabling vocabulary export', () => {
    const cat = candidate('猫')
    render(
      <JlptBulkExportModal
        {...modalProps(readyPhase([cat], { resolved: { 猫: resolved('猫', null) } }), {
          frequencyDictConfigured: false
        })}
      />
    )

    expect(
      screen.getByText(
        'Choose a frequency dictionary in Options to rank vocabulary. Vocabulary without frequency data appears last.'
      )
    ).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Export 1 items' }).hasAttribute('disabled')).toBe(
      false
    )
  })

  it('disables missing dictionary entries and excludes them from the export count', () => {
    const valid = candidate('猫')
    const missing = candidate('犬')
    const phase = readyPhase([valid, missing], {
      resolved: { 猫: resolved('猫', 4), 犬: { entry: null, frequency: null } },
      selected: { 猫: true, 犬: true }
    })
    render(<JlptBulkExportModal {...modalProps(phase)} />)

    const missingCheckbox = screen.getByRole('checkbox', { name: 'Select Vocabulary 犬' })
    expect(missingCheckbox.hasAttribute('disabled')).toBe(true)
    expect(screen.getByText('No entry')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Export 1 items' })).toBeTruthy()
  })

  it('shows target-deck checking and hidden counts', () => {
    const cat = candidate('猫')
    const dog = candidate('犬')
    const phase = readyPhase([cat, dog], {
      targetDeckMatches: { 猫: { cardId: 1, deckNames: ['Mining'] }, 犬: null },
      hideTargetDeckMatches: true,
      checkingTargetDeck: true,
      selected: { 猫: false, 犬: true }
    })
    render(<JlptBulkExportModal {...modalProps(phase)} />)

    expect(screen.getByText('Checking target deck…')).toBeTruthy()
    expect(screen.getByText('1 already in Mining hidden')).toBeTruthy()
    expect(screen.getByText('Showing 1 of 2 unknown items')).toBeTruthy()
    expect(screen.queryByText('猫')).toBeNull()
  })

  it('renders the empty state and disables export', () => {
    render(
      <JlptBulkExportModal
        {...modalProps(readyPhase([], { selected: {} }), { mode: 'both', throughLevel: 'N3' })}
      />
    )

    expect(screen.getByRole('status', { name: '' }).textContent).toContain(
      'No unknown vocabulary/kanji through N3.'
    )
    expect(screen.getByRole('button', { name: 'Export 0 items' }).hasAttribute('disabled')).toBe(
      true
    )
  })
})

describe('JlptBulkExportModal phases and close policy', () => {
  it('renders loading and error phases with accessible actions', () => {
    const loading = modalProps({ kind: 'preparing' })
    const { unmount } = render(<JlptBulkExportModal {...loading} />)
    expect(screen.getByRole('status').textContent).toContain('Loading unknown JLPT items…')
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(loading.onClose).toHaveBeenCalledOnce()
    unmount()

    const error = modalProps({
      kind: 'error',
      message: 'The local knowledge database is unavailable.'
    })
    render(<JlptBulkExportModal {...error} />)
    expect(screen.getByRole('alert').textContent).toContain(
      'The local knowledge database is unavailable.'
    )
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(error.onRetry).toHaveBeenCalledOnce()
    expect(error.onClose).toHaveBeenCalledOnce()
  })

  it('keeps running exports alive on Escape and backdrop clicks, and exposes Cancel', () => {
    const props = modalProps({
      kind: 'running',
      candidates: [candidate('猫')],
      statuses: { 猫: { kind: 'mining' } },
      cancelling: false
    })
    render(<JlptBulkExportModal {...props} />)

    expect(screen.getByRole('status').textContent).toContain('Exported 0 of 1')
    fireEvent.click(screen.getByRole('dialog', { name: 'JLPT unknown-item export' }))
    fireEvent.keyDown(window, { key: 'Escape' })
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(props.onClose).not.toHaveBeenCalled()
    expect(props.onCancel).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: 'Close JLPT unknown-item export' })).toBeNull()
  })

  it('renders resolving, done, aborted, and cancellation statuses', () => {
    const resolving = readyPhase([candidate('猫')], {
      resolving: true,
      selected: { 猫: true }
    })
    const resolvingProps = modalProps(resolving)
    render(<JlptBulkExportModal {...resolvingProps} />)
    expect(screen.getByRole('status').textContent).toContain(
      'Dictionary entries are being prepared'
    )
    expect(screen.getByRole('button', { name: 'Export 1 items' }).hasAttribute('disabled')).toBe(
      true
    )
    cleanup()

    const doneProps = modalProps({
      kind: 'done',
      candidates: [candidate('猫'), candidate('犬')],
      statuses: {
        猫: { kind: 'added' },
        犬: { kind: 'cancelled' }
      },
      summary: { added: 1, updated: 0, duplicate: 0, noEntry: 0, error: 0, cancelled: 1 },
      abortMessage: 'Anki is unavailable.'
    })
    render(<JlptBulkExportModal {...doneProps} />)
    expect(screen.getByRole('alert').textContent).toContain('Anki is unavailable.')
    expect(screen.getByText('1 added · 1 cancelled')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Back to list' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy()
    expect(screen.getByRole('combobox', { name: 'Through level' }).hasAttribute('disabled')).toBe(
      true
    )
    fireEvent.click(screen.getByRole('button', { name: 'Back to list' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(doneProps.onBackToList).toHaveBeenCalledOnce()
    expect(doneProps.onClose).toHaveBeenCalledOnce()
  })
})
