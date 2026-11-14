// @vitest-environment happy-dom
import { afterEach, describe, it, expect, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { deferred } from '@test/harness/deferred'
import { renderToStaticMarkup } from 'react-dom/server'
import KnowledgeTab, {
  parseIntervalDaysInput,
  formatLastSynced
} from '@src/renderer/src/components/options/KnowledgeTab'
import type { SyncStatus } from '@src/shared/knowledge'
import { makePublicKnowledgeSettings } from '@test/harness/knowledgeFixtures'

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
})

describe('KnowledgeTab setting descriptions', () => {
  it('explains what the two interval thresholds mean', () => {
    const html = renderTab()
    expect(html).toContain('Cards whose review interval reaches this many days count as known.')
    expect(html).toContain('count as well known')
    expect(html).toContain('those words get no underline')
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('KnowledgeTab controls', () => {
  function renderControls(overrides: Partial<React.ComponentProps<typeof KnowledgeTab>> = {}) {
    return render(
      <KnowledgeTab
        wanikaniConfigured={false}
        onSaveWanikaniToken={vi.fn()}
        ankiDeckNames={['A', 'B']}
        ankiModelFields={[]}
        knowledgeSettings={DEFAULT_KNOWLEDGE_SETTINGS}
        onChangeKnowledgeSettings={vi.fn()}
        syncStatus={DEFAULT_SYNC_STATUS}
        onSyncNow={vi.fn(async () => DEFAULT_SYNC_STATUS)}
        {...overrides}
      />
    )
  }
  it('adds and removes selected decks while retaining decks outside the rendered list', () => {
    const onChangeKnowledgeSettings = vi.fn()
    renderControls({
      knowledgeSettings: { ...DEFAULT_KNOWLEDGE_SETTINGS, ankiKnownDecks: ['A', 'Hidden'] },
      onChangeKnowledgeSettings
    })
    fireEvent.click(screen.getByLabelText('Use B as a known-words source'))
    expect(onChangeKnowledgeSettings).toHaveBeenLastCalledWith({
      ankiKnownDecks: ['A', 'Hidden', 'B']
    })
    fireEvent.click(screen.getByLabelText('Use A as a known-words source'))
    expect(onChangeKnowledgeSettings).toHaveBeenLastCalledWith({ ankiKnownDecks: ['Hidden'] })
  })
  it('tracks source sync independently and renders its completion', async () => {
    const pending = deferred<SyncStatus>()
    const onSyncNow = vi.fn(() => pending.promise)
    renderControls({ onSyncNow })
    fireEvent.click(screen.getByRole('button', { name: 'Sync WaniKani' }))
    expect(onSyncNow).toHaveBeenCalledExactlyOnceWith('wanikani')
    expect(
      (screen.getByRole('button', { name: 'Syncing WaniKani…' }) as HTMLButtonElement).disabled
    ).toBe(true)
    expect((screen.getByRole('button', { name: 'Sync Anki' }) as HTMLButtonElement).disabled).toBe(
      false
    )
    pending.resolve({
      ...DEFAULT_SYNC_STATUS,
      wanikani: { ...DEFAULT_SYNC_STATUS.wanikani, outcome: 'synced' }
    })
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Sync complete'))
    expect(
      (screen.getByRole('button', { name: 'Sync WaniKani' }) as HTMLButtonElement).disabled
    ).toBe(false)
  })
  it.each([
    [{ outcome: 'cooldown', retryAt: '2026-07-10T12:30:00Z' }, 'Sync available in 30m'],
    [{ outcome: 'error', error: 'offline' }, 'Sync failed: offline'],
    [{ outcome: 'unconfigured' }, 'Sync unavailable: source is not configured']
  ] as const)('renders source outcomes from its public status', (outcome, message) => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-07-10T12:00:00Z'))
    renderControls({
      syncStatus: {
        ...DEFAULT_SYNC_STATUS,
        wanikani: { ...DEFAULT_SYNC_STATUS.wanikani, ...outcome }
      }
    })
    expect(screen.getByRole('status').textContent).toBe(message)
  })
})
