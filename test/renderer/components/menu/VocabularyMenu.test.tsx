import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { VocabularyMenu } from '@src/renderer/src/components/menu/VocabularyMenu'

const run = (action: () => void): (() => void) => action

describe('VocabularyMenu', () => {
  it('owns the word-report, JLPT-coverage, and bulk-mining commands, with stable ids', () => {
    const html = renderToStaticMarkup(<VocabularyMenu open onToggle={vi.fn()} run={run} />)

    expect(html).toContain('id="open-word-report"')
    expect(html).toContain('aria-label="Word report"')
    expect(html).toContain('Word report…')
    expect(html).toContain('id="open-jlpt-coverage"')
    expect(html).toContain('aria-label="JLPT coverage"')
    expect(html).toContain('JLPT coverage…')
    expect(html).toContain('id="open-bulk-mining"')
    expect(html).toContain('aria-label="Bulk Anki mining"')
    expect(html).toContain('Bulk Anki mining…')
    expect(html).not.toContain('open-subtitle-report')
  })

  it('does not invoke either callback while rendering', () => {
    const onOpenWordReport = vi.fn()
    const onOpenJlptCoverage = vi.fn()
    const onOpenBulkMining = vi.fn()
    renderToStaticMarkup(
      <VocabularyMenu
        open
        onToggle={vi.fn()}
        run={run}
        onOpenWordReport={onOpenWordReport}
        onOpenJlptCoverage={onOpenJlptCoverage}
        onOpenBulkMining={onOpenBulkMining}
      />
    )

    expect(onOpenWordReport).not.toHaveBeenCalled()
    expect(onOpenJlptCoverage).not.toHaveBeenCalled()
    expect(onOpenBulkMining).not.toHaveBeenCalled()
  })
})
