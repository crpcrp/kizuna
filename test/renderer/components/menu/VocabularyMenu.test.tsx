import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { VocabularyMenu } from '@src/renderer/src/components/menu/VocabularyMenu'

const run = (action: () => void): (() => void) => action

describe('VocabularyMenu', () => {
  it('owns the word-report and bulk-mining commands', () => {
    const html = renderToStaticMarkup(<VocabularyMenu open onToggle={vi.fn()} run={run} />)

    expect(html).toContain('aria-label="Word report"')
    expect(html).toContain('aria-label="Bulk Anki mining"')
  })
})
