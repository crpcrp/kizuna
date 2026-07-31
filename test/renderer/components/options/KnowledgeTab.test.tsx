import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import KnowledgeTab, {
  toggleDeck,
  parseIntervalDaysInput,
  formatLastSynced,
  formatSyncOutcome,
  runSourceSync,
  describeTokenStorage
} from '@src/renderer/src/components/options/KnowledgeTab'
import type { SyncStatus } from '@src/shared/knowledge'
import { makePublicKnowledgeSettings } from '@test/harness/knowledgeFixtures'

// SSR-only render (no jsdom, no testing-library) per AGENTS.md testing
// policy — same pattern OptionsMenu.test.tsx uses.

function noop(): void {}

const DEFAULT_KNOWLEDGE_SETTINGS = makePublicKnowledgeSettings()

const DEFAULT_SYNC_STATUS: SyncStatus = {
  wanikani: { lastSyncAt: null, count: 0, configured: false },
  anki: { lastSyncAt: null, count: 0, configured: false }
}

function renderTab(overrides: Partial<React.ComponentProps<typeof KnowledgeTab>> = {}): string {
  return renderToStaticMarkup(
    <KnowledgeTab
      wanikaniConfigured={false}
      onSaveWanikaniToken={noop}
      ankiDeckNames={[]}
      ankiModelFields={[]}
      knowledgeSettings={DEFAULT_KNOWLEDGE_SETTINGS}
      onChangeKnowledgeSettings={noop}
      syncStatus={DEFAULT_SYNC_STATUS}
      onSyncNow={async () => DEFAULT_SYNC_STATUS}
      {...overrides}
    />
  )
}

describe('describeTokenStorage', () => {
  it('claims OS-secure-store encryption only when it is actually available', () => {
    expect(describeTokenStorage(true)).toContain("operating system's secure store")
    expect(describeTokenStorage(true)).not.toContain('unencrypted')
  })

  it('warns plainly when there is no secure store', () => {
    expect(describeTokenStorage(false)).toContain('saved unencrypted')
    expect(describeTokenStorage(false)).not.toContain("operating system's secure store")
  })

  it('asserts nothing about encryption when availability is unknown', () => {
    const unknown = describeTokenStorage(undefined)
    expect(unknown).not.toMatch(/unencrypted|secure store|encrypted/)
    expect(unknown).toContain('stored locally')
  })

  it('discloses the WaniKani transmission in every state', () => {
    for (const state of [true, false, undefined]) {
      expect(describeTokenStorage(state)).toContain('sent only to WaniKani over HTTPS')
      expect(describeTokenStorage(state)).not.toContain('never leaves this device')
    }
  })
})

describe('KnowledgeTab markup', () => {
  it('renders a WaniKani section', () => {
    expect(renderTab()).toContain('WaniKani')
  })

  it('renders a password-type token input and a Save button', () => {
    const html = renderTab()
    expect(html).toMatch(/type="password"[^>]*id="wanikani-token-input"/)
    expect(html).toContain('id="wanikani-token-save"')
  })

  it('renders a Clear button, disabled until a token is configured', () => {
    expect(renderTab({ wanikaniConfigured: false })).toMatch(
      /id="wanikani-token-clear"[^>]*disabled=""/
    )
    expect(renderTab({ wanikaniConfigured: true })).not.toMatch(
      /id="wanikani-token-clear"[^>]*disabled=""/
    )
  })

  it('token hint is honest: no false "never leaves this device", discloses the WaniKani transmission', () => {
    const html = renderTab()
    expect(html).not.toContain('never leaves this device')
    expect(html).toContain('sent only to WaniKani')
  })

  it('token hint says "encrypted" when the OS secure store is available', () => {
    const html = renderTab({
      knowledgeSettings: { ...DEFAULT_KNOWLEDGE_SETTINGS, encryptionAvailable: true }
    })
    expect(html).toContain('encrypted with your operating system')
    expect(html).not.toContain('saved unencrypted')
  })

  it('token hint says "saved unencrypted" when no secure store is available', () => {
    const html = renderTab({
      knowledgeSettings: { ...DEFAULT_KNOWLEDGE_SETTINGS, encryptionAvailable: false }
    })
    expect(html).toContain('saved unencrypted')
    expect(html).not.toContain('encrypted with your operating system')
  })

  // Regression: the knowledge domain loads after this tab first renders, so the
  // fallback settings reach KnowledgeTab with encryptionAvailable undefined.
  // Claiming "saved unencrypted" there is a false warning on any normal
  // Windows/macOS box, and it would stick forever if the IPC load failed.
  it('token hint makes no encryption claim while the knowledge domain is still loading', () => {
    const { encryptionAvailable: _omitted, ...loading } = DEFAULT_KNOWLEDGE_SETTINGS
    const html = renderTab({ knowledgeSettings: loading })
    expect(html).not.toContain('saved unencrypted')
    expect(html).not.toContain('no secure store')
    expect(html).not.toContain('encrypted with your operating system')
    expect(html).toContain('sent only to WaniKani')
  })

  it('does not fire onSaveWanikaniToken merely by rendering the Clear button', () => {
    const onSaveWanikaniToken = vi.fn()
    renderTab({ onSaveWanikaniToken, wanikaniConfigured: true })
    expect(onSaveWanikaniToken).not.toHaveBeenCalled()
  })

  it('shows "Not configured" when no token is stored', () => {
    const html = renderTab({ wanikaniConfigured: false })
    expect(html).toMatch(/id="wanikani-token-status"[^>]*data-configured="false"/)
    expect(html).toContain('Not configured')
  })

  it('shows "Configured ✓" when a token is stored', () => {
    const html = renderTab({ wanikaniConfigured: true })
    expect(html).toMatch(/id="wanikani-token-status"[^>]*data-configured="true"/)
    expect(html).toContain('Configured ✓')
  })

  it('does not fire onSaveWanikaniToken merely by rendering', () => {
    const onSaveWanikaniToken = vi.fn()
    renderTab({ onSaveWanikaniToken })
    expect(onSaveWanikaniToken).not.toHaveBeenCalled()
  })

  it('never renders a stored token value — only the draft state and a placeholder', () => {
    const html = renderTab({ wanikaniConfigured: true })
    expect(html).not.toContain('value="some-secret-token"')
    expect(html).toMatch(/id="wanikani-token-input"[^>]*value=""/)
  })

  it('renders one checkbox per anki deck name, checked to match ankiKnownDecks', () => {
    const html = renderTab({
      ankiDeckNames: ['Core 2k', 'Mining', 'Extra'],
      knowledgeSettings: { ...DEFAULT_KNOWLEDGE_SETTINGS, ankiKnownDecks: ['Mining'] }
    })
    expect(html).not.toMatch(/aria-label="Use Core 2k as a known-words source" checked=""/)
    expect(html).toMatch(/aria-label="Use Mining as a known-words source" checked=""/)
    expect(html).not.toMatch(/aria-label="Use Extra as a known-words source" checked=""/)
  })

  it('populates the shared known-word field select from ankiModelFields', () => {
    const html = renderTab({ ankiModelFields: ['Front', 'Back', 'Reading'] })
    expect(html).toContain('id="anki-known-field-select"')
    expect(html).toContain('<option value="Front">Front</option>')
    expect(html).toContain('<option value="Back">Back</option>')
    expect(html).toContain('<option value="Reading">Reading</option>')
  })

  it('does not fire onSyncNow merely by rendering', () => {
    const onSyncNow = vi.fn()
    renderTab({ onSyncNow: onSyncNow.mockResolvedValue(DEFAULT_SYNC_STATUS) })
    expect(onSyncNow).not.toHaveBeenCalled()
  })

  it('renders separately addressed source sync buttons', () => {
    const html = renderTab()
    expect(html).toContain('id="knowledge-sync-wanikani"')
    expect(html).toContain('Sync WaniKani')
    expect(html).toContain('id="knowledge-sync-anki"')
    expect(html).toContain('Sync Anki')
  })

  it('renders an accessible cooldown notification', () => {
    const html = renderTab({
      syncStatus: {
        ...DEFAULT_SYNC_STATUS,
        wanikani: {
          ...DEFAULT_SYNC_STATUS.wanikani,
          outcome: 'cooldown',
          retryAt: '2026-07-10T12:30:00Z'
        }
      }
    })
    expect(html).toContain('role="status"')
    expect(html).toContain('Sync available in')
  })

  it('renders each source relative to a clock sampled at mount, not per render', () => {
    const now = Date.parse('2026-07-22T12:00:00Z')
    vi.spyOn(Date, 'now').mockReturnValue(now)
    const html = renderTab({
      syncStatus: {
        wanikani: { lastSyncAt: '2026-07-22T09:00:00Z', count: 12, configured: true },
        anki: { lastSyncAt: null, count: 0, configured: false }
      }
    })
    // One sample serves the whole render: `Date.now` is impure and must not be
    // called from the render path more than the single lazy state initializer.
    expect(Date.now).toHaveBeenCalledTimes(1)
    expect(html).toContain('12 words (3h ago)')
    expect(html).toContain('0 words (never synced)')
    vi.restoreAllMocks()
  })

  it('lists every colored level in the coloring legend, including In deck', () => {
    const html = renderTab()
    expect(html).toContain('>Unknown</span>')
    expect(html).toContain('>In deck</span>')
    expect(html).toContain('>Learning</span>')
    expect(html).toContain('>Known</span>')
    expect(html).toContain('>Well known</span>')
    expect(html).toContain('mined, but not yet learned')
    expect(html).toContain('Suspended cards are treated as well known.')
  })

  it('shows the load error when set, and renders no error markup when omitted', () => {
    expect(renderTab({ loadError: 'Could not read knowledge settings' })).toMatch(
      /id="knowledge-load-error"[^>]*>Could not read knowledge settings/
    )
    expect(renderTab()).not.toContain('options-error')
  })
})

describe('KnowledgeTab pure helpers', () => {
  it('toggleDeck adds the deck when checked and it is missing', () => {
    expect(toggleDeck(['A'], 'B', true)).toEqual(['A', 'B'])
  })

  it('toggleDeck is a no-op when checked and already present', () => {
    expect(toggleDeck(['A', 'B'], 'B', true)).toEqual(['A', 'B'])
  })

  it('toggleDeck removes only the named deck when unchecked, keeping the rest', () => {
    expect(toggleDeck(['A', 'B', 'C'], 'B', false)).toEqual(['A', 'C'])
  })

  it('parseIntervalDaysInput accepts finite values >= 1 and rejects everything else', () => {
    expect(parseIntervalDaysInput('21')).toBe(21)
    expect(parseIntervalDaysInput('1')).toBe(1)
    expect(parseIntervalDaysInput('0')).toBeNull()
    expect(parseIntervalDaysInput('-5')).toBeNull()
    expect(parseIntervalDaysInput('abc')).toBeNull()
    expect(parseIntervalDaysInput('')).toBeNull()
  })

  it('formatLastSynced returns "never synced" for null', () => {
    expect(formatLastSynced(null, Date.now())).toBe('never synced')
  })

  it('formatLastSynced returns "just now" for sub-minute gaps', () => {
    const now = Date.parse('2026-07-10T12:00:00Z')
    expect(formatLastSynced(new Date(now - 10_000).toISOString(), now)).toBe('just now')
  })

  it('formatLastSynced returns minutes for sub-hour gaps', () => {
    const now = Date.parse('2026-07-10T12:00:00Z')
    expect(formatLastSynced(new Date(now - 5 * 60_000).toISOString(), now)).toBe('5m ago')
  })

  it('formatLastSynced returns hours for gaps an hour or more', () => {
    const now = Date.parse('2026-07-10T12:00:00Z')
    expect(formatLastSynced(new Date(now - 3 * 3600_000).toISOString(), now)).toBe('3h ago')
  })

  it('formats sync outcomes without concealing cooldown or error states', () => {
    const now = Date.parse('2026-07-10T12:00:00Z')
    expect(
      formatSyncOutcome({ lastSyncAt: null, count: 0, configured: true, outcome: 'synced' }, now)
    ).toBe('Sync complete')
    expect(
      formatSyncOutcome(
        {
          lastSyncAt: null,
          count: 0,
          configured: true,
          outcome: 'cooldown',
          retryAt: '2026-07-10T12:30:00Z'
        },
        now
      )
    ).toBe('Sync available in 30m')
    expect(
      formatSyncOutcome(
        { lastSyncAt: null, count: 0, configured: true, outcome: 'error', error: 'offline' },
        now
      )
    ).toBe('Sync failed: offline')
  })

  it('runs only the selected source and records its independent lifecycle', async () => {
    let syncing: Partial<Record<'wanikani' | 'anki', boolean>> = {}
    let outcomes: Partial<Record<'wanikani' | 'anki', SyncStatus['wanikani']>> = {}
    const onSyncNow = vi.fn().mockResolvedValue({
      wanikani: {
        lastSyncAt: '2026-07-10T12:00:00Z',
        count: 5,
        configured: true,
        outcome: 'synced'
      },
      anki: DEFAULT_SYNC_STATUS.anki
    } satisfies SyncStatus)
    const setSyncing = (updater: (current: typeof syncing) => typeof syncing): void => {
      syncing = updater(syncing)
    }
    const setOutcomes = (updater: (current: typeof outcomes) => typeof outcomes): void => {
      outcomes = updater(outcomes)
    }

    await runSourceSync('wanikani', onSyncNow, setSyncing, setOutcomes)

    expect(onSyncNow).toHaveBeenCalledExactlyOnceWith('wanikani')
    expect(syncing).toEqual({ wanikani: false })
    expect(outcomes.wanikani?.outcome).toBe('synced')
    expect(outcomes.anki).toBeUndefined()
  })
})

describe('KnowledgeTab setting descriptions', () => {
  it('explains what the two interval thresholds mean', () => {
    const html = renderTab()
    expect(html).toContain('Cards whose review interval reaches this many days count as known.')
    expect(html).toContain('count as well known')
    expect(html).toContain('those words get no underline')
  })
})
