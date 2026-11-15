// @vitest-environment happy-dom
import { afterEach, describe, it, expect, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import SubtitleReport from '@src/renderer/src/components/SubtitleReport'
import type { SubtitleReportPhase } from '@src/renderer/src/state/subtitleReportController'
import type { SubtitleReport as Report } from '@src/renderer/src/state/subtitleReport'

function emptyLevels(): Report['tokenLevels'] {
  return { unknown: 0, inDeck: 0, learning: 0, known: 0, wellKnown: 0 }
}

function makeReport(overrides: Partial<Report> = {}): Report {
  return {
    totalTokens: 10,
    uniqueLemmas: 5,
    tokenLevels: { ...emptyLevels(), unknown: 3, learning: 2, known: 4, wellKnown: 1 },
    lemmaLevels: { ...emptyLevels(), unknown: 2, learning: 1, known: 1, wellKnown: 1 },
    provenance: { wanikaniOnly: 1, ankiOnly: 1, both: 1, grammar: 0, unsourced: 0 },
    ankiDecks: [{ deck: 'Core 2k', lemmaCount: 3 }],
    topUnknown: [{ lemma: '食べる', surface: '食べた', count: 4 }],
    ...overrides
  }
}

function ready(
  report: Partial<Report> = {},
  sources = { wanikani: true, anki: true }
): SubtitleReportPhase {
  return { kind: 'ready', report: makeReport(report), sources }
}
function markup(phase: SubtitleReportPhase = ready(), open = true): string {
  return renderToStaticMarkup(
    <SubtitleReport open={open} phase={phase} onClose={() => {}} onRetry={() => {}} />
  )
}
afterEach(cleanup)

describe('SubtitleReport presentation', () => {
  it('hides a closed report and shows accessible progress for idle and preparing opens', () => {
    const closed = markup({ kind: 'idle' }, false)
    expect(closed).not.toContain('open')
    expect(closed).not.toContain('Generating word report')
    for (const kind of ['idle', 'preparing'] as const) {
      const html = markup({ kind })
      expect(html).toContain('id="subtitle-report-loading"')
      expect(html).toContain('role="status"')
      expect(html).toContain('Generating word report')
      expect(html).toContain('class="report-loading-spinner" aria-hidden="true"')
    }
  })

  it('shows the empty state for absent subtitles and an all-symbol report', () => {
    for (const phase of [
      { kind: 'noSubtitles' } as const,
      ready({ totalTokens: 0, uniqueLemmas: 0, topUnknown: [], ankiDecks: [] })
    ]) {
      expect(markup(phase)).toContain('id="subtitle-report-empty"')
    }
  })

  it('announces errors and wires Retry and Close', () => {
    const onRetry = vi.fn()
    const onClose = vi.fn()
    render(
      <SubtitleReport
        open
        phase={{ kind: 'error', message: 'knowledge DB unavailable' }}
        onClose={onClose}
        onRetry={onRetry}
      />
    )
    expect(screen.getByRole('alert').textContent).toContain('knowledge DB unavailable')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(onRetry).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: /close/i }))
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('renders report totals, formatted percentages, legends, decks, and unknown surfaces', () => {
    const html = markup()
    for (const text of [
      '10 words',
      '5 unique words',
      '50.0%',
      '40.0%',
      'aria-label="Word report"',
      'Unknown',
      'In deck',
      'Learning',
      'Known',
      'Well known',
      'Core 2k',
      '<td>3</td>',
      '食べた'
    ]) {
      expect(html).toContain(text)
    }
    for (const text of [
      'Subtitle report',
      'in deck',
      'Unsourced',
      'Grammar words',
      'subtitle-report-mine',
      'Bulk Anki mining'
    ]) {
      expect(html).not.toContain(text)
    }
    const rows = html.match(/<li>.*?<\/li>/g) ?? []
    expect(rows.some((row) => row.includes('食べた') && row.includes('4'))).toBe(true)
    expect(rows.some((row) => /\(/.test(row))).toBe(false)
  })

  it('renders only nonzero bar segments for both weightings', () => {
    const html = markup(
      ready({
        tokenLevels: { ...emptyLevels(), known: 5 },
        lemmaLevels: { ...emptyLevels(), known: 3 }
      })
    )
    expect(html.match(/class="report-bar-segment" data-level="known"/g)).toHaveLength(2)
    for (const level of ['unknown', 'inDeck', 'learning', 'wellKnown']) {
      expect(html).not.toContain(`class="report-bar-segment" data-level="${level}"`)
    }
  })

  it('renders in-deck segments and their formatted share independently of understanding', () => {
    const html = markup(
      ready({
        tokenLevels: { ...emptyLevels(), unknown: 3, inDeck: 2, known: 5 },
        lemmaLevels: { ...emptyLevels(), unknown: 3, inDeck: 1, known: 4 }
      })
    )
    expect(html.match(/class="report-bar-segment" data-level="inDeck"/g)).toHaveLength(2)
    expect(html).toContain('20.0% in deck')
    expect(html).toContain('12.5% in deck')
  })

  it('shows grammar provenance but hides diagnostic unsourced counts', () => {
    const html = markup(
      ready({ provenance: { wanikaniOnly: 1, ankiOnly: 1, both: 1, grammar: 2, unsourced: 2 } })
    )
    expect(html).toContain('Grammar words (always counted as known): 2')
    expect(html).not.toContain('Unsourced')
  })

  it('shows an unconfigured banner without provenance while retaining totals', () => {
    const html = markup(ready({}, { wanikani: false, anki: false }))
    expect(html).toContain('id="subtitle-report-unconfigured"')
    expect(html).not.toContain('Via WaniKani only')
    expect(html).toContain('10 words')
  })
})
