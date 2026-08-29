// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import JlptCoverageReport, {
  type JlptCoverageReportData
} from '@src/renderer/src/components/JlptCoverageReport'
import { JLPT_LEVELS } from '@src/shared/jlpt'
import type { CoverageSlice } from '@src/shared/jlptCoverage'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(Date.parse('2026-08-29T11:30:00.000Z'))
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

function slice(
  total: number,
  buckets: Partial<CoverageSlice['buckets']> = {},
  provenance: Partial<CoverageSlice['provenance']> = {}
): CoverageSlice {
  return {
    total,
    buckets: {
      unknown: 0,
      inDeck: 0,
      learning: 0,
      known: 0,
      wellKnown: 0,
      ...buckets
    },
    provenance: { wanikaniOnly: 0, ankiOnly: 0, both: 0, ...provenance }
  }
}

const DATA: JlptCoverageReportData = {
  dataset: {
    name: 'OpenJLPT',
    version: '2026.08',
    snapshotId: 'abc123',
    license: 'CC-BY-SA-4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    attribution:
      "OpenJLPT contributors; level classifications derived from Jonathan Waller's JLPT Resources.",
    rawRecordCount: 13,
    deduplicatedExpressionCount: 10,
    duplicateCount: 3,
    conflictCount: 0
  },
  bands: {
    N5: slice(2, { known: 1, wellKnown: 1 }, { wanikaniOnly: 1, ankiOnly: 1 }),
    N4: slice(3, { unknown: 1, learning: 1, known: 1 }, { both: 1 }),
    N3: slice(4, { unknown: 1, inDeck: 1, known: 2 }, { ankiOnly: 1, both: 1 }),
    N2: slice(1, { unknown: 1 }),
    N1: slice(0)
  },
  throughLevels: {
    N5: slice(2, { known: 1, wellKnown: 1 }, { wanikaniOnly: 1, ankiOnly: 1 }),
    N4: slice(5, { learning: 1, known: 2, wellKnown: 1, unknown: 1 }, { both: 1 }),
    N3: slice(
      9,
      { unknown: 2, inDeck: 1, learning: 1, known: 4, wellKnown: 1 },
      { wanikaniOnly: 1, ankiOnly: 2, both: 2 }
    ),
    N2: slice(
      10,
      { unknown: 3, inDeck: 1, learning: 1, known: 4, wellKnown: 1 },
      { wanikaniOnly: 1, ankiOnly: 2, both: 2 }
    ),
    N1: slice(
      10,
      { unknown: 3, inDeck: 1, learning: 1, known: 4, wellKnown: 1 },
      { wanikaniOnly: 1, ankiOnly: 2, both: 2 }
    )
  },
  unclassifiedByDataset: slice(3, { unknown: 1, inDeck: 1, learning: 1 }),
  generatedAt: '2026-08-29T11:30:00.000Z',
  sourceStatus: {
    anki: {
      configured: true,
      syncing: false,
      lastSuccessfulSyncAt: '2026-08-29T11:00:00.000Z'
    },
    wanikani: { configured: false, syncing: false, lastSuccessfulSyncAt: null }
  }
}

function renderReport(overrides: Partial<React.ComponentProps<typeof JlptCoverageReport>> = {}) {
  const props: React.ComponentProps<typeof JlptCoverageReport> = {
    open: true,
    phase: 'ready',
    data: DATA,
    selectedLevel: 'N3',
    onClose: vi.fn(),
    onTargetLevelChange: vi.fn(),
    onRetry: vi.fn(),
    onExportUnknowns: vi.fn(),
    ...overrides
  }
  return { ...render(<JlptCoverageReport {...props} />), props }
}

describe('JlptCoverageReport ready state', () => {
  it('renders the target percentage and per-level table without the removed summaries', () => {
    renderReport()

    expect(screen.getByRole('dialog', { name: 'JLPT vocabulary coverage' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'JLPT vocabulary coverage' })).toBeTruthy()
    expect(screen.getByText('55.6%')).toBeTruthy()
    expect(screen.getAllByText('1 / 9 (11.1%)').length).toBeGreaterThan(0)
    expect(screen.getByRole('img', { name: /Mastered 5 \/ 9 \(55\.6%\)/ })).toBeTruthy()
    expect(screen.queryByText('5 / 9 mastered through N3')).toBeNull()
    expect(document.querySelector('.jlpt-coverage-supporting-counts')).toBeNull()
    expect(screen.queryByRole('heading', { name: 'By JLPT level' })).toBeNull()

    const n3 = screen.getByRole('row', { name: /N3/ })
    expect(n3.getAttribute('aria-current')).toBe('true')
    expect(within(n3).getByText('4')).toBeTruthy()
    expect(within(n3).getByText('2 / 4 (50.0%)')).toBeTruthy()
    expect(within(n3).getByText('5 / 9 (55.6%)')).toBeTruthy()
    expect(screen.getByRole('table').querySelector('caption')?.textContent).toContain(
      'Individual JLPT bands and cumulative mastered-through-level counts.'
    )

    const select = screen.getByRole('combobox', { name: 'Target level' })
    expect(
      Array.from(select.querySelectorAll('option')).map((option) => option.textContent)
    ).toEqual([...JLPT_LEVELS])
  })

  it('shows mutually exclusive provenance, unclassified counts, dataset identity, and freshness', () => {
    renderReport()

    expect(
      screen.getByText(
        'These counts cover vocabulary currently tracked by Kizuna. Both is counted once.'
      )
    ).toBeTruthy()
    expect(screen.getByText('WaniKani only: 1')).toBeTruthy()
    expect(screen.getByText('Anki only: 2')).toBeTruthy()
    expect(screen.getByText('Both: 2')).toBeTruthy()
    expect(
      screen.getByRole('heading', { name: 'Not classified by this approximate dataset' })
    ).toBeTruthy()
    expect(screen.getByText('3 tracked vocabulary items are outside the dataset.')).toBeTruthy()
    expect(screen.getByText('OpenJLPT')).toBeTruthy()
    expect(screen.getByText('2026.08')).toBeTruthy()
    expect(screen.getByText('abc123')).toBeTruthy()
    expect(screen.getByText(DATA.generatedAt)).toBeTruthy()
    expect(screen.getByText('CC-BY-SA-4.0')).toBeTruthy()
    expect(screen.getByText(/Jonathan Waller's JLPT Resources/)).toBeTruthy()
    expect(screen.getByText('not configured')).toBeTruthy()
    expect(screen.getByText('30m ago')).toBeTruthy()
    expect(
      screen.getByText(/Approximate vocabulary classification; not an official JLPT list/)
    ).toBeTruthy()
    expect(screen.getByRole('link', { name: 'CC-BY-SA-4.0' }).getAttribute('href')).toBe(
      DATA.dataset.licenseUrl
    )
    expect(screen.getByRole('link', { name: 'CC-BY-SA-4.0' }).getAttribute('target')).toBe('_blank')
    expect(screen.getByText('30m ago').getAttribute('title')).toBe(
      DATA.sourceStatus?.anki.lastSuccessfulSyncAt
    )
  })

  it('uses each fresh report timestamp for relative sync age', () => {
    const { rerender, props } = renderReport()
    const refreshed = {
      ...DATA,
      generatedAt: '2026-08-29T13:30:00.000Z'
    }

    rerender(<JlptCoverageReport {...props} data={refreshed} />)

    expect(screen.getByText('2h ago')).toBeTruthy()
  })

  it('routes target changes and close through callbacks', () => {
    const { props } = renderReport()

    fireEvent.change(screen.getByRole('combobox', { name: 'Target level' }), {
      target: { value: 'N2' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Close JLPT vocabulary coverage' }))

    expect(props.onTargetLevelChange).toHaveBeenCalledWith('N2')
    expect(props.onClose).toHaveBeenCalledOnce()
  })

  it('routes export through the selected target level action', () => {
    const { props } = renderReport()

    fireEvent.click(screen.getByRole('button', { name: 'Export unknown items through N3' }))

    expect(props.onExportUnknowns).toHaveBeenCalledOnce()
  })
})

describe('JlptCoverageReport loading and error states', () => {
  it('keeps the modal shell and exposes an accessible loading status', () => {
    renderReport({ phase: 'loading', data: null })

    expect(screen.getByRole('dialog', { name: 'JLPT vocabulary coverage' })).toBeTruthy()
    expect(screen.getByRole('status').textContent).toContain('Loading JLPT vocabulary coverage')
    expect(screen.queryByText('mastered through')).toBeNull()
  })

  it('shows safe error text with retry while retaining close', () => {
    const { props } = renderReport({
      phase: 'error',
      data: null,
      errorText: 'Knowledge data unavailable.'
    })

    expect(screen.getByRole('alert').textContent).toContain('Knowledge data unavailable.')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    fireEvent.click(screen.getByRole('button', { name: 'Close JLPT vocabulary coverage' }))
    expect(props.onRetry).toHaveBeenCalledOnce()
    expect(props.onClose).toHaveBeenCalledOnce()
  })

  it('distinguishes a configured source that has never synced and handles zero denominators', () => {
    const zero: JlptCoverageReportData = {
      ...DATA,
      bands: Object.fromEntries(
        JLPT_LEVELS.map((level) => [level, slice(0)])
      ) as JlptCoverageReportData['bands'],
      throughLevels: Object.fromEntries(
        JLPT_LEVELS.map((level) => [level, slice(0)])
      ) as JlptCoverageReportData['throughLevels'],
      unclassifiedByDataset: slice(0),
      sourceStatus: {
        anki: { configured: true, syncing: false, lastSuccessfulSyncAt: null },
        wanikani: { configured: false, syncing: false, lastSuccessfulSyncAt: null }
      }
    }
    renderReport({ data: zero })

    expect(screen.getByText('never synced')).toBeTruthy()
    expect(screen.getAllByText('0.0%').length).toBeGreaterThan(0)
    expect(document.body.textContent).not.toMatch(/NaN|Infinity/)
  })

  it('shows the setup hint when neither source is configured', () => {
    const data: JlptCoverageReportData = {
      ...DATA,
      sourceStatus: {
        anki: { configured: false, syncing: false, lastSuccessfulSyncAt: null },
        wanikani: { configured: false, syncing: false, lastSuccessfulSyncAt: null }
      }
    }
    renderReport({ data })

    expect(screen.getByRole('status').textContent).toContain('No knowledge source is configured')
    expect(screen.getByText(/every vocabulary item is counted as unknown/)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Export unknown items through N3' })).toBeTruthy()
  })
})
