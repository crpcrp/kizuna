// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { VocabularyMenu } from '@src/renderer/src/components/menu/VocabularyMenu'

const run = (action: () => void): (() => void) => action

afterEach(cleanup)

describe('VocabularyMenu', () => {
  it('owns the word-report, JLPT, and bulk-mining commands, with stable ids', () => {
    const html = renderToStaticMarkup(<VocabularyMenu open onToggle={vi.fn()} run={run} />)

    expect(html).toContain('id="open-word-report"')
    expect(html).toContain('aria-label="Word report"')
    expect(html).toContain('Word report…')
    expect(html).toContain('id="open-jlpt-coverage"')
    expect(html).toContain('aria-label="JLPT coverage"')
    expect(html).toContain('JLPT coverage…')
    expect(html).toContain('id="open-jlpt-bulk-export"')
    expect(html).toContain('aria-label="JLPT bulk export"')
    expect(html).toContain('JLPT bulk export…')
    expect(html).toContain('id="open-bulk-mining"')
    expect(html).toContain('aria-label="Bulk Anki mining"')
    expect(html).toContain('Bulk Anki mining…')
    expect(html).not.toContain('open-subtitle-report')
  })

  it('does not invoke either callback while rendering', () => {
    const onOpenWordReport = vi.fn()
    const onOpenJlptCoverage = vi.fn()
    const onOpenJlptBulkExport = vi.fn()
    const onOpenBulkMining = vi.fn()
    renderToStaticMarkup(
      <VocabularyMenu
        open
        onToggle={vi.fn()}
        run={run}
        onOpenWordReport={onOpenWordReport}
        onOpenJlptCoverage={onOpenJlptCoverage}
        onOpenJlptBulkExport={onOpenJlptBulkExport}
        onOpenBulkMining={onOpenBulkMining}
      />
    )

    expect(onOpenWordReport).not.toHaveBeenCalled()
    expect(onOpenJlptCoverage).not.toHaveBeenCalled()
    expect(onOpenJlptBulkExport).not.toHaveBeenCalled()
    expect(onOpenBulkMining).not.toHaveBeenCalled()
  })

  it('routes the JLPT bulk-export command', () => {
    const onOpenJlptBulkExport = vi.fn()
    render(
      <VocabularyMenu
        open
        onToggle={vi.fn()}
        run={run}
        onOpenJlptBulkExport={onOpenJlptBulkExport}
      />
    )

    fireEvent.click(screen.getByRole('menuitem', { name: 'JLPT bulk export' }))

    expect(onOpenJlptBulkExport).toHaveBeenCalledOnce()
  })
})
