import { describe, expect, it } from 'vitest'
import { isValidElement, type ReactElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import BulkMining, { type BulkMiningProps } from '@src/renderer/src/components/BulkMining'
import type { LookupResult } from '@src/shared/dictionary'

const token = (surface: string, lemma = surface) => ({
  surface,
  lemma,
  reading: '',
  pos: 'noun' as const,
  startOffset: 0
})
const entry = (frequency: number | null, frequencyDisplay: string | null = null): LookupResult => ({
  expression: 'x',
  reading: '',
  glossary: '',
  dictTitle: 'test',
  dictId: 1,
  stylesCss: null,
  frequency,
  frequencyDisplay,
  pitchAccent: null,
  defTags: '',
  termTags: '',
  score: 0,
  rules: ''
})
const candidates = [
  { lemma: '食べる', token: token('食べた', '食べる'), sentence: '食べた', count: 2 },
  { lemma: '猫', token: token('猫'), sentence: '猫', count: 1 }
]
const callbacks = {
  onThresholdChange: () => {},
  onMinimumCountChange: () => {},
  onSortChange: () => {},
  onToggle: () => {},
  onSelectAll: () => {},
  onSelectNone: () => {},
  onSetHideTargetDeckMatches: () => {},
  onStart: () => {},
  onCancel: () => {},
  onClose: () => {},
  onBackToList: () => {},
  onRetry: () => {}
}
function render(props: Partial<Omit<BulkMiningProps, 'phase'>> & { phase?: unknown }): string {
  return renderToStaticMarkup(
    <BulkMining
      {...({
        ...callbacks,
        frequencyDictConfigured: true,
        phase: { kind: 'idle' },
        ...props
      } as BulkMiningProps)}
    />
  )
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

describe('BulkMining SSR', () => {
  it('renders preparation status with Close only, and error controls that invoke Retry', () => {
    const preparing = render({ phase: { kind: 'preparing' } })
    expect(preparing).toContain('role="status"')
    expect(preparing).toContain('>Close</button>')
    expect(preparing).not.toContain('>Retry</button>')
    expect(preparing).not.toContain('Mine 0 words')

    let retries = 0
    const tree = BulkMining({
      ...callbacks,
      phase: { kind: 'error', message: 'Dictionary unavailable' },
      frequencyDictConfigured: true,
      onRetry: () => {
        retries++
      }
    })
    const retry = findElement(
      tree,
      (element) =>
        element.type === 'button' &&
        (element.props as { children?: ReactNode }).children === 'Retry'
    )
    expect(retry).not.toBeNull()
    ;(retry!.props as { onClick: () => void }).onClick()
    expect(retries).toBe(1)
    expect(render({ phase: { kind: 'error', message: 'Dictionary unavailable' } })).toContain(
      'role="alert"'
    )
  })

  it('renders the ready threshold enabled or disabled with resolution markers', () => {
    const phase = {
      kind: 'ready' as const,
      candidates,
      resolving: true,
      threshold: 5000,
      selected: { 食べる: true, 猫: false },
      resolved: {
        食べる: { entry: entry(12, '12k'), frequency: 12 },
        猫: { entry: null, frequency: null }
      }
    }
    const html = render({ phase })
    expect(html).toContain('id="bulk-mining-threshold"')
    expect(html).toContain('value="5000"')
    expect(html).toContain('12k')
    expect(html).toContain('words without frequency data are hidden')
    expect(html).toContain('Resolving frequencies')
    expect(render({ phase, frequencyDictConfigured: false })).toContain('disabled=""')
  })

  it('disables Mine and asks the user to wait while resolution is running', () => {
    const phase = {
      kind: 'ready' as const,
      candidates,
      resolving: true,
      threshold: null,
      minimumCount: null,
      sort: 'count' as const,
      selected: { 食べる: true, 猫: true },
      resolved: {
        食べる: { entry: entry(12, '12k'), frequency: 12 },
        猫: { entry: entry(3), frequency: 3 }
      },
      targetDeckMatches: {},
      checkingTargetDeck: false,
      hideTargetDeckMatches: false
    }
    const resolvingHtml = render({ phase })
    expect(resolvingHtml).toContain('please wait before mining')
    expect(resolvingHtml).toContain('id="bulk-mining-start" disabled=""')
    // The same selection becomes mineable once resolution finishes.
    expect(render({ phase: { ...phase, resolving: false } })).not.toContain(
      'id="bulk-mining-start" disabled=""'
    )
  })

  it('shows pending entries, hidden-no-data note, and the selected mine count', () => {
    const phase = {
      kind: 'ready' as const,
      candidates,
      resolving: false,
      threshold: 5000,
      selected: { 食べる: true, 猫: true },
      resolved: { 猫: { entry: entry(null), frequency: null } }
    }
    const html = render({ phase })
    expect(html).toContain('bulk-mining-pending')
    expect(html).toContain('words without frequency data are hidden')
    expect(html).toContain('Mine 1 words')
    expect(render({ phase: { ...phase, selected: { 食べる: false, 猫: false } } })).toContain(
      'id="bulk-mining-start" disabled=""'
    )
  })

  it('forwards the minimum count and keeps rows and Mine N on the same combined filter set', () => {
    const composedCandidates = [
      { lemma: 'target', token: token('target'), sentence: '', count: 2 },
      { lemma: 'included', token: token('included'), sentence: '', count: 2 },
      { lemma: 'below-minimum', token: token('below-minimum'), sentence: '', count: 1 }
    ]
    const phase = {
      kind: 'ready' as const,
      candidates: composedCandidates,
      resolving: false,
      threshold: 15,
      minimumCount: 2,
      sort: 'count' as const,
      selected: { target: true, included: true, 'below-minimum': true },
      resolved: {
        target: { entry: entry(12), frequency: 12 },
        included: { entry: entry(10), frequency: 10 },
        'below-minimum': { entry: entry(10), frequency: 10 }
      },
      targetDeckMatches: { target: { cardId: 1, deckNames: ['Mining'] } },
      checkingTargetDeck: false,
      hideTargetDeckMatches: true
    }
    const html = render({ phase })
    expect(html).toContain('id="bulk-mining-minimum-count"')
    expect(html).toContain('value="2"')
    expect(html).toContain('included')
    expect(html).not.toContain('aria-label="Mine target"')
    expect(html).not.toContain('aria-label="Mine below-minimum"')
    expect(html).toContain('Mine 1 words')

    let raw: string | undefined
    const tree = BulkMining({
      ...callbacks,
      phase,
      frequencyDictConfigured: false,
      onMinimumCountChange: (value) => {
        raw = value
      }
    })
    const minimumCount = findElement(
      tree,
      (element) =>
        element.type === 'input' &&
        (element.props as { id?: string }).id === 'bulk-mining-minimum-count'
    )
    expect(minimumCount).not.toBeNull()
    expect((minimumCount!.props as { disabled?: boolean }).disabled).toBeUndefined()
    ;(minimumCount!.props as { onChange: (event: { target: { value: string } }) => void }).onChange(
      { target: { value: '3' } }
    )
    expect(raw).toBe('3')

    const cleared = render({
      phase: { ...phase, minimumCount: null, threshold: null, hideTargetDeckMatches: false }
    })
    expect(cleared).toContain('target')
    expect(cleared).toContain('included')
    expect(cleared).toContain('below-minimum')
    expect(cleared).toContain('Mine 3 words')
  })

  it('shows concise copy instead of an empty table when filters hide every candidate', () => {
    const html = render({
      phase: {
        kind: 'ready',
        candidates,
        resolving: false,
        threshold: null,
        minimumCount: 3,
        selected: { [candidates[0].lemma]: true, [candidates[1].lemma]: true },
        resolved: {},
        targetDeckMatches: {},
        checkingTargetDeck: false,
        hideTargetDeckMatches: false
      }
    })
    expect(html).toContain('No words match the current filters.')
    expect(html).not.toContain('bulk-mining-table')
    expect(html).toContain('Mine 0 words')
  })

  it('filters target-deck matches while keeping the advisory scan non-blocking', () => {
    const phase = {
      kind: 'ready' as const,
      candidates,
      resolving: false,
      threshold: null,
      selected: { [candidates[0].lemma]: false, [candidates[1].lemma]: true },
      resolved: {
        [candidates[0].lemma]: { entry: entry(12), frequency: 12 },
        [candidates[1].lemma]: { entry: entry(20), frequency: 20 }
      },
      targetDeckMatches: {
        [candidates[0].lemma]: { cardId: 1, deckNames: ['Mining'] },
        [candidates[1].lemma]: null
      },
      checkingTargetDeck: true,
      hideTargetDeckMatches: true,
      advisoryWarning: 'Could not finish checking Anki.'
    }
    const html = render({ phase, targetDeckName: 'Mining' })
    expect(html).toContain('checked=""')
    expect(html).toContain('Hide words already in target deck')
    expect(html).toContain('Checking target deck')
    expect(html).toContain('1 already in Mining hidden')
    expect(html).toContain('Could not finish checking Anki.')
    expect(html).not.toContain(candidates[0].token.surface)
    expect(html).toContain(candidates[1].token.surface)
    expect(html).toContain('Mine 1 words')

    const unfiltered = render({
      phase: { ...phase, hideTargetDeckMatches: false, checkingTargetDeck: false }
    })
    expect(unfiltered).toContain(candidates[0].token.surface)
  })

  it('forwards target-deck filter changes through the required controller seam', () => {
    let nextValue: boolean | undefined
    const phase = {
      kind: 'ready' as const,
      candidates,
      resolving: false,
      threshold: null,
      minimumCount: null,
      sort: 'count' as const,
      selected: {},
      resolved: {},
      targetDeckMatches: {},
      checkingTargetDeck: false,
      hideTargetDeckMatches: true
    }
    const tree = BulkMining({
      ...callbacks,
      phase,
      frequencyDictConfigured: true,
      onSetHideTargetDeckMatches: (hide) => {
        nextValue = hide
      }
    })
    const checkbox = findElement(
      tree,
      (element) =>
        element.type === 'input' && (element.props as { checked?: boolean }).checked === true
    )
    expect(checkbox).not.toBeNull()
    ;(checkbox!.props as { onChange: (event: { target: { checked: boolean } }) => void }).onChange({
      target: { checked: false }
    })
    expect(nextValue).toBe(false)
  })

  it('groups Select all and Select none below the sort and target-deck controls', () => {
    const html = render({
      phase: {
        kind: 'ready',
        candidates,
        resolving: false,
        threshold: null,
        minimumCount: null,
        sort: 'count',
        selected: {},
        resolved: {},
        targetDeckMatches: {},
        checkingTargetDeck: false,
        hideTargetDeckMatches: false
      }
    })
    const actions =
      '<div class="bulk-mining-selection-actions"><button type="button">Select all</button><button type="button">Select none</button></div>'
    expect(html).toContain(actions)
    expect(html.indexOf('Hide words already in target deck')).toBeLessThan(html.indexOf(actions))
  })

  it('forwards sort choices and renders Count and Frequency in different orders', () => {
    const ordered = [
      {
        lemma: 'count-first',
        token: token('count-first'),
        sentence: '',
        count: 3,
        firstOccurrence: 0
      },
      {
        lemma: 'frequency-first',
        token: token('frequency-first'),
        sentence: '',
        count: 1,
        firstOccurrence: 1
      },
      { lemma: 'pending', token: token('pending'), sentence: '', count: 2, firstOccurrence: 2 },
      { lemma: 'no-data', token: token('no-data'), sentence: '', count: 1, firstOccurrence: 3 }
    ]
    const phase = {
      kind: 'ready' as const,
      candidates: ordered,
      resolving: false,
      threshold: null,
      minimumCount: null,
      sort: 'count' as const,
      selected: {},
      resolved: {
        'count-first': { entry: entry(20), frequency: 20 },
        'frequency-first': { entry: entry(10), frequency: 10 },
        'no-data': { entry: entry(null), frequency: null }
      },
      targetDeckMatches: {},
      checkingTargetDeck: false,
      hideTargetDeckMatches: false
    }
    const countHtml = render({ phase })
    const frequencyHtml = render({ phase: { ...phase, sort: 'frequency' as const } })
    expect(countHtml.indexOf('count-first')).toBeLessThan(countHtml.indexOf('pending'))
    expect(frequencyHtml.indexOf('frequency-first')).toBeLessThan(
      frequencyHtml.indexOf('count-first')
    )

    let requested: string | undefined
    const tree = BulkMining({
      ...callbacks,
      phase,
      frequencyDictConfigured: true,
      onSortChange: (sort) => {
        requested = sort
      }
    })
    const select = findElement(
      tree,
      (element) =>
        element.type === 'select' && (element.props as { id?: string }).id === 'bulk-mining-sort'
    )
    expect(select).not.toBeNull()
    ;(select!.props as { onChange: (event: { target: { value: string } }) => void }).onChange({
      target: { value: 'frequency' }
    })
    expect(requested).toBe('frequency')
  })

  it('renders running status markers, progress, and cancel', () => {
    const html = render({
      phase: {
        kind: 'running',
        candidates,
        statuses: { 食べる: { kind: 'added' }, 猫: { kind: 'mining' } },
        cancelling: false
      }
    })
    expect(html).toContain('Mined 1 of 2')
    expect(html).toContain('data-status="added"')
    expect(html).toContain('data-status="mining"')
    expect(html).toContain('id="bulk-mining-cancel"')
  })

  it('renders separate updated rows and summary buckets', () => {
    const html = render({
      phase: {
        kind: 'done',
        candidates,
        statuses: { 食べる: { kind: 'updated' }, 猫: { kind: 'added' } },
        summary: { added: 1, updated: 1, duplicate: 0, noEntry: 0, error: 0, cancelled: 0 }
      }
    })
    expect(html).toContain('data-status="updated"')
    expect(html).toContain('>Updated<')
    expect(html).toContain('1 added · 1 updated')
  })

  it('keeps the running surface mounted while cancellation is pending', () => {
    const html = render({ phase: { kind: 'running', candidates, statuses: {}, cancelling: true } })
    expect(html).toContain('Cancelling…')
    expect(html).toContain('id="bulk-mining-cancel" disabled=""')
    expect(html).not.toContain('Back to report')
  })

  it('renders done summaries without zero buckets, errors, and abort alerts', () => {
    const html = render({
      phase: {
        kind: 'done',
        candidates,
        statuses: {
          食べる: { kind: 'error', message: 'Anki disconnected' },
          猫: { kind: 'cancelled' }
        },
        summary: { added: 0, updated: 0, duplicate: 0, noEntry: 0, error: 1, cancelled: 1 },
        abortMessage: 'Anki is unavailable'
      }
    })
    expect(html).toContain('1 errors · 1 cancelled')
    expect(html).not.toContain('0 duplicates')
    expect(html).toContain('Anki disconnected')
    expect(html).toContain('role="alert"')
    expect(html).toContain('id="bulk-mining-back"')
    expect(html).toContain('>Back to word list</button>')
  })

  it('fires onBackToList from the done-phase footer instead of discarding the session', () => {
    let backs = 0
    let closes = 0
    const tree = BulkMining({
      ...callbacks,
      frequencyDictConfigured: true,
      onBackToList: () => {
        backs++
      },
      onClose: () => {
        closes++
      },
      phase: {
        kind: 'done',
        candidates,
        statuses: { 食べる: { kind: 'added' }, 猫: { kind: 'added' } },
        summary: { added: 2, updated: 0, duplicate: 0, noEntry: 0, error: 0, cancelled: 0 }
      }
    })
    const back = findElement(
      tree,
      (element) =>
        element.type === 'button' &&
        (element.props as { children?: ReactNode }).children === 'Back to word list'
    )
    expect(back).not.toBeNull()
    ;(back!.props as { onClick: () => void }).onClick()
    expect(backs).toBe(1)
    expect(closes).toBe(0)
  })

  it('renders duplicate deck provenance as escaped, wrapping status text', () => {
    const html = render({
      phase: {
        kind: 'done',
        candidates,
        statuses: {
          [candidates[0].lemma]: {
            kind: 'duplicate',
            deckNames: ['Long Deck Name That Must Wrap', '<Target Deck>']
          },
          [candidates[1].lemma]: { kind: 'duplicate', deckNames: [] }
        },
        summary: { added: 0, updated: 0, duplicate: 2, noEntry: 0, error: 0, cancelled: 0 }
      }
    })
    expect(html).toContain('Duplicate in: Long Deck Name That Must Wrap, &lt;Target Deck&gt;')
    expect(html).toContain('Duplicate (deck unavailable)')
    expect(html).toContain('bulk-mining-status')
    expect(html).toContain('2 duplicates')
  })

  it('renders a direct ready surface without report-navigation wording', () => {
    const html = render({
      phase: {
        kind: 'ready',
        candidates,
        resolving: false,
        threshold: null,
        selected: {},
        resolved: {},
        targetDeckMatches: {},
        checkingTargetDeck: false,
        hideTargetDeckMatches: false
      }
    })
    expect(html).toContain('Bulk Anki mining')
    expect(html).not.toContain('id="bulk-mining-close"')
    expect(html).not.toContain('Back to report')
  })

  it('renders nothing while idle', () => expect(render({ phase: { kind: 'idle' } })).toBe(''))
})
