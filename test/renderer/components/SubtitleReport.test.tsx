import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import SubtitleReport, { ReportBody } from '@src/renderer/src/components/SubtitleReport'
import type { SubtitleReportPhase } from '@src/renderer/src/state/subtitleReportController'
import type { SubtitleReport as Report } from '@src/renderer/src/state/subtitleReport'

// SSR-only render (no jsdom, no testing-library) per AGENTS.md testing policy —
// same pattern as OptionsMenu/SubtitleSidebar. The Escape-keydown listener and
// backdrop-click handler are client-only effects/handlers this environment
// can't exercise; they were covered by manual QA during feature delivery instead.

function emptyLevels(): Report['tokenLevels'] {
  return { unknown: 0, inDeck: 0, learning: 0, known: 0, wellKnown: 0 }
}

function makeReport(overrides: Partial<Report> = {}): Report {
  return {
    totalTokens: 10,
    uniqueLemmas: 5,
    tokenLevels: { ...emptyLevels(), unknown: 3, learning: 2, known: 4, wellKnown: 1 },
    lemmaLevels: { ...emptyLevels(), unknown: 2, learning: 1, known: 1, wellKnown: 1 },
    provenance: { wanikaniOnly: 1, ankiOnly: 1, both: 1, unsourced: 0 },
    ankiDecks: [{ deck: 'Core 2k', lemmaCount: 3 }],
    topUnknown: [{ lemma: '食べる', surface: '食べた', count: 4 }],
    ...overrides
  }
}

function findElement(
  node: ReactNode,
  predicate: (element: ReactElement) => boolean
): ReactElement | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findElement(child, predicate)
      if (found) return found
    }
    return null
  }
  if (!isValidElement(node)) return null
  if (predicate(node)) return node
  return findElement((node.props as { children?: ReactNode }).children, predicate)
}

describe('SubtitleReport closed state', () => {
  it('lacks the open class and generating state when closed and idle', () => {
    const html = renderToStaticMarkup(
      <SubtitleReport open={false} phase={{ kind: 'idle' }} onClose={() => {}} onRetry={() => {}} />
    )
    expect(html).not.toContain('open')
    expect(html).not.toContain('Generating word report')
  })
})

describe('SubtitleReport phase markers', () => {
  it('renders the generating state immediately when opened while idle', () => {
    const html = renderToStaticMarkup(
      <SubtitleReport open={true} phase={{ kind: 'idle' }} onClose={() => {}} onRetry={() => {}} />
    )
    expect(html).toContain('id="subtitle-report-loading"')
    expect(html).toContain('Generating word report')
    expect(html).toContain('class="report-loading-spinner" aria-hidden="true"')
  })

  it('renders an accessible preparing status with a decorative spinner', () => {
    const html = renderToStaticMarkup(
      <SubtitleReport
        open={true}
        phase={{ kind: 'preparing' }}
        onClose={() => {}}
        onRetry={() => {}}
      />
    )
    expect(html).toContain('id="subtitle-report-loading"')
    expect(html).toContain('role="status"')
    expect(html).toContain('Generating word report')
    expect(html).toContain('class="report-loading-spinner" aria-hidden="true"')
  })

  it('renders the empty marker for noSubtitles', () => {
    const html = renderToStaticMarkup(
      <SubtitleReport
        open={true}
        phase={{ kind: 'noSubtitles' }}
        onClose={() => {}}
        onRetry={() => {}}
      />
    )
    expect(html).toContain('id="subtitle-report-empty"')
  })

  it('renders the empty marker for an all-symbol ready report', () => {
    const phase: SubtitleReportPhase = {
      kind: 'ready',
      report: makeReport({ totalTokens: 0, uniqueLemmas: 0, topUnknown: [], ankiDecks: [] }),
      sources: { wanikani: true, anki: true }
    }
    const html = renderToStaticMarkup(
      <SubtitleReport open={true} phase={phase} onClose={() => {}} onRetry={() => {}} />
    )
    expect(html).toContain('id="subtitle-report-empty"')
  })

  it('renders the error message inside a role=alert block', () => {
    const html = renderToStaticMarkup(
      <SubtitleReport
        open={true}
        phase={{ kind: 'error', message: 'knowledge DB unavailable' }}
        onClose={() => {}}
        onRetry={() => {}}
      />
    )
    expect(html).toContain('role="alert"')
    expect(html).toContain('knowledge DB unavailable')
  })

  it('forwards Retry from an error without opening another surface', () => {
    let retries = 0
    const body = ReportBody({
      open: true,
      phase: { kind: 'error', message: 'knowledge DB unavailable' },
      onRetry: () => {
        retries++
      }
    })
    const retry = findElement(
      body,
      (element) =>
        element.type === 'button' &&
        (element.props as { children?: ReactNode }).children === 'Retry'
    )
    expect(retry).not.toBeNull()
    ;(retry!.props as { onClick: () => void }).onClick()
    expect(retries).toBe(1)
  })
})

describe('SubtitleReport ready phase', () => {
  const phase: SubtitleReportPhase = {
    kind: 'ready',
    report: makeReport(),
    sources: { wanikani: true, anki: true }
  }
  const html = renderToStaticMarkup(
    <SubtitleReport open={true} phase={phase} onClose={() => {}} onRetry={() => {}} />
  )

  it('shows totals and both percentages formatted to one decimal', () => {
    expect(html).toContain('10 words')
    expect(html).toContain('5 unique words')
    // tokenLevels: (4+1)/10 known = 50.0%; lemmaLevels: (1+1)/5 known = 40.0%
    expect(html).toContain('50.0%')
    expect(html).toContain('40.0%')
  })

  it('uses the Word report name throughout the open dialog', () => {
    expect(html).toContain('aria-label="Word report"')
    expect(html).not.toContain('Subtitle report')
  })

  it('renders every legend level', () => {
    expect(html).toContain('Unknown')
    expect(html).toContain('In deck')
    expect(html).toContain('Learning')
    expect(html).toContain('Known')
    expect(html).toContain('Well known')
    expect(html).toContain('data-level="inDeck"')
  })

  it('carries data-level on bar segments and omits zero-count segments', () => {
    const barSegment = (level: string): RegExp =>
      new RegExp(`class="report-bar-segment" data-level="${level}"`, 'g')

    // Both bars (token- and lemma-weighted) have these levels nonzero here.
    expect((html.match(barSegment('unknown')) ?? []).length).toBe(2)
    expect((html.match(barSegment('wellKnown')) ?? []).length).toBe(2)
    // makeReport() carries no in-deck words, so that segment is skipped entirely.
    expect((html.match(barSegment('inDeck')) ?? []).length).toBe(0)

    const zeroPhase: SubtitleReportPhase = {
      kind: 'ready',
      report: makeReport({
        tokenLevels: { ...emptyLevels(), known: 5 },
        lemmaLevels: { ...emptyLevels(), known: 3 }
      }),
      sources: { wanikani: true, anki: true }
    }
    const zeroHtml = renderToStaticMarkup(
      <SubtitleReport open={true} phase={zeroPhase} onClose={() => {}} onRetry={() => {}} />
    )
    expect((zeroHtml.match(barSegment('unknown')) ?? []).length).toBe(0)
    expect((zeroHtml.match(barSegment('inDeck')) ?? []).length).toBe(0)
    expect((zeroHtml.match(barSegment('learning')) ?? []).length).toBe(0)
    expect((zeroHtml.match(barSegment('wellKnown')) ?? []).length).toBe(0)
    // Two bars (token + lemma), one 'known' segment each.
    expect((zeroHtml.match(barSegment('known')) ?? []).length).toBe(2)
  })

  it('renders an inDeck bar segment and the mined share once in-deck words exist', () => {
    const inDeckPhase: SubtitleReportPhase = {
      kind: 'ready',
      report: makeReport({
        tokenLevels: { ...emptyLevels(), unknown: 3, inDeck: 2, known: 5 },
        lemmaLevels: { ...emptyLevels(), unknown: 3, inDeck: 1, known: 4 }
      }),
      sources: { wanikani: true, anki: true }
    }
    const inDeckHtml = renderToStaticMarkup(
      <SubtitleReport open={true} phase={inDeckPhase} onClose={() => {}} onRetry={() => {}} />
    )
    const barSegment = /class="report-bar-segment" data-level="inDeck"/g
    // One segment per bar (token- and lemma-weighted).
    expect((inDeckHtml.match(barSegment) ?? []).length).toBe(2)
    // tokenLevels: 2/10 in deck; lemmaLevels: 1/8 in deck.
    expect(inDeckHtml).toContain('20.0% in deck')
    expect(inDeckHtml).toContain('12.5% in deck')
  })

  it('omits the mined share entirely when no word is in deck', () => {
    expect(html).not.toContain('in deck')
  })

  it('renders deck rows with name and count', () => {
    expect(html).toContain('Core 2k')
    expect(html).toContain('<td>3</td>')
  })

  it('renders topUnknown rows with surface and count only', () => {
    expect(html).toContain('食べた')
    expect(html).toContain('4')
  })

  it('hides the unsourced row when its count is 0', () => {
    expect(html).not.toContain('Unsourced')
  })

  it('shows the unsourced row when its count is nonzero', () => {
    const withUnsourced: SubtitleReportPhase = {
      kind: 'ready',
      report: makeReport({ provenance: { wanikaniOnly: 0, ankiOnly: 0, both: 0, unsourced: 2 } }),
      sources: { wanikani: true, anki: true }
    }
    const withUnsourcedHtml = renderToStaticMarkup(
      <SubtitleReport open={true} phase={withUnsourced} onClose={() => {}} onRetry={() => {}} />
    )
    expect(withUnsourcedHtml).toContain('Unsourced: 2')
  })
})

describe('SubtitleReport unconfigured banner', () => {
  it('shows the banner and hides provenance, but keeps totals visible', () => {
    const phase: SubtitleReportPhase = {
      kind: 'ready',
      report: makeReport(),
      sources: { wanikani: false, anki: false }
    }
    const html = renderToStaticMarkup(
      <SubtitleReport open={true} phase={phase} onClose={() => {}} onRetry={() => {}} />
    )
    expect(html).toContain('id="subtitle-report-unconfigured"')
    expect(html).not.toContain('Via WaniKani only')
    expect(html).toContain('10 words')
  })
})

describe('SubtitleReport topUnknown formatting', () => {
  it('renders no parenthesized text after the surface (QA-2: readings dropped)', () => {
    const phase: SubtitleReportPhase = {
      kind: 'ready',
      report: makeReport({
        topUnknown: [
          { lemma: 'a', surface: 'ですね', count: 2 },
          { lemma: 'b', surface: '猫', count: 1 }
        ]
      }),
      sources: { wanikani: true, anki: true }
    }
    const html = renderToStaticMarkup(
      <SubtitleReport open={true} phase={phase} onClose={() => {}} onRetry={() => {}} />
    )
    const rows = html.match(/<li>.*?<\/li>/g) ?? []
    expect(rows.some((row) => row.includes('ですね'))).toBe(true)
    expect(rows.some((row) => /\(/.test(row))).toBe(false)
  })
})

describe('SubtitleReport independent mining surface', () => {
  const phase: SubtitleReportPhase = {
    kind: 'ready',
    report: makeReport(),
    sources: { wanikani: true, anki: true }
  }

  it('contains no mining entry whether unknown lemmas are present or absent', () => {
    const unknownHtml = renderToStaticMarkup(
      <SubtitleReport open={true} phase={phase} onClose={() => {}} onRetry={() => {}} />
    )
    const noUnknownHtml = renderToStaticMarkup(
      <SubtitleReport
        open={true}
        phase={{
          ...phase,
          report: makeReport({
            lemmaLevels: { ...emptyLevels(), learning: 1, known: 1, wellKnown: 1 }
          })
        }}
        onClose={() => {}}
        onRetry={() => {}}
      />
    )

    expect(unknownHtml).not.toContain('subtitle-report-mine')
    expect(noUnknownHtml).not.toContain('id="subtitle-report-mine"')
    expect(unknownHtml).not.toContain('Bulk Anki mining')
  })
})
