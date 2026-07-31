import { useState } from 'react'
import type {
  KnowledgeSource,
  KnowledgeTuning,
  PublicKnowledgeSettings,
  SourceStatus,
  SyncStatus
} from '../../../../shared/knowledge'
import OptionsToggleRow from './OptionsToggleRow'
import type { SettingEntry } from './types'

/** Adds or removes exactly one deck from the known-decks array based on the
 * checkbox's new checked state, leaving every other entry untouched (the
 * regression this guards against: a naive rebuild-from-scratch would drop
 * decks that aren't in the currently-rendered `ankiDeckNames` list). */
export function toggleDeck(decks: string[], deck: string, checked: boolean): string[] {
  if (checked) return decks.includes(deck) ? decks : [...decks, deck]
  return decks.filter((d) => d !== deck)
}

/** Parses a number-input's raw string into a valid interval-days count
 * (finite, >= 1), or null when the input isn't valid yet — mirrors
 * parsePopupCountInput's exact idiom. */
export function parseIntervalDaysInput(rawValue: string): number | null {
  const value = Number(rawValue)
  return Number.isFinite(value) && value >= 1 ? value : null
}

/** Formats a sync source's lastSyncAt as a short relative-time label for
 * display next to "Sync now" (e.g. "3h ago"). Display-only nicety — `nowMs`
 * is passed in explicitly rather than injecting a clock. */
export function formatLastSynced(lastSyncAt: string | null, nowMs: number): string {
  if (lastSyncAt === null) return 'never synced'
  const diffMinutes = Math.floor((nowMs - new Date(lastSyncAt).getTime()) / 60000)
  if (diffMinutes < 1) return 'just now'
  if (diffMinutes < 60) return `${diffMinutes}m ago`
  return `${Math.floor(diffMinutes / 60)}h ago`
}

/** Gives the most recent explicit source-sync outcome a concise, accessible label. */
export function formatSyncOutcome(status: SourceStatus, nowMs: number): string | null {
  switch (status.outcome) {
    case 'synced':
      return 'Sync complete'
    case 'cooldown': {
      const remainingMs = Math.max(0, new Date(status.retryAt ?? nowMs).getTime() - nowMs)
      const minutes = Math.ceil(remainingMs / 60_000)
      return `Sync available in ${minutes < 60 ? `${minutes}m` : `${Math.ceil(minutes / 60)}h`}`
    }
    case 'unconfigured':
      return 'Sync unavailable: source is not configured'
    case 'error':
      return status.error ? `Sync failed: ${status.error}` : 'Sync failed'
    default:
      return null
  }
}

/** Describes where the WaniKani token lives, truthfully in all three states.
 *
 * `undefined` means the knowledge domain hasn't loaded yet (or its IPC load
 * failed) — the tab renders before OptionsMenu's effect resolves. It must not
 * fall back to the `false` wording: on a normal Windows/macOS box safeStorage
 * *is* available, so defaulting to "saved unencrypted" flashes a false security
 * warning on every first open, and a failed load would leave it up for good.
 * The unknown state therefore claims nothing about encryption; only the
 * always-true facts (stored locally, sent to WaniKani) are stated. */
export function describeTokenStorage(encryptionAvailable: boolean | undefined): string {
  if (encryptionAvailable === undefined) {
    return 'It is stored locally and sent only to WaniKani over HTTPS to sync your progress.'
  }
  if (encryptionAvailable) {
    return (
      "It is stored locally, encrypted with your operating system's secure store, and sent" +
      ' only to WaniKani over HTTPS to sync your progress.'
    )
  }
  return (
    'It is stored locally — your system has no secure store available, so it is saved' +
    ' unencrypted — and sent only to WaniKani over HTTPS to sync your progress.'
  )
}

type SourceStateSetter<T> = (
  updater: (current: Partial<Record<KnowledgeSource, T>>) => Partial<Record<KnowledgeSource, T>>
) => void

/** Runs one source independently, exposing its in-flight and final outcome to the tab. */
export async function runSourceSync(
  source: KnowledgeSource,
  onSyncNow: (source: KnowledgeSource) => Promise<SyncStatus>,
  setSyncing: SourceStateSetter<boolean>,
  setSyncOutcomes: SourceStateSetter<SourceStatus>
): Promise<void> {
  setSyncing((current) => ({ ...current, [source]: true }))
  try {
    const status = await onSyncNow(source)
    setSyncOutcomes((current) => ({ ...current, [source]: status[source] }))
  } finally {
    setSyncing((current) => ({ ...current, [source]: false }))
  }
}

export interface KnowledgeTabProps {
  active?: boolean
  wanikaniConfigured: boolean
  onSaveWanikaniToken: (token: string) => void | Promise<void>
  ankiDeckNames: string[]
  ankiModelFields: string[]
  knowledgeSettings: PublicKnowledgeSettings
  onChangeKnowledgeSettings: (patch: Partial<KnowledgeTuning>) => void
  syncStatus: SyncStatus
  onSyncNow: (source: KnowledgeSource) => Promise<SyncStatus>
  /** User-facing error from the last knowledge-domain load. Undefined when there is none. */
  loadError?: string
}

export const KNOWLEDGE_SETTING_ENTRIES: SettingEntry[] = [
  {
    id: 'wanikani-token',
    label: 'WaniKani personal access token',
    category: 'knowledge',
    keywords: ['api', 'wk', 'known words'],
    targetId: 'wanikani-token-input'
  },
  {
    id: 'knowledge-anki-decks',
    label: 'Anki known decks',
    category: 'knowledge',
    keywords: ['known words', 'source']
  },
  {
    id: 'knowledge-anki-field',
    label: 'Known-word field',
    category: 'knowledge',
    targetId: 'anki-known-field-select'
  },
  {
    id: 'known-interval',
    label: 'Known after (days)',
    category: 'knowledge',
    keywords: ['threshold', 'srs', 'interval'],
    targetId: 'known-interval-days-input'
  },
  {
    id: 'well-known-interval',
    label: 'Well-known after (days)',
    category: 'knowledge',
    keywords: ['threshold', 'srs', 'interval'],
    targetId: 'well-known-interval-days-input'
  },
  {
    id: 'knowledge-sync',
    label: 'Sync known words',
    category: 'knowledge',
    keywords: ['refresh', 'wanikani', 'anki']
  },
  {
    id: 'coloring-enabled',
    label: 'Color subtitle words by knowledge level',
    category: 'knowledge',
    keywords: ['underline', 'highlight'],
    targetId: 'coloring-enabled-checkbox'
  }
]

/** "Known words" options tab: WaniKani token, Anki known-decks source,
 * known/well-known thresholds, sync controls, and subtitle coloring. Owns
 * the transient WaniKani token draft input. */
export default function KnowledgeTab({
  active = true,
  wanikaniConfigured,
  onSaveWanikaniToken,
  ankiDeckNames,
  ankiModelFields,
  knowledgeSettings,
  onChangeKnowledgeSettings,
  syncStatus,
  onSyncNow,
  loadError
}: KnowledgeTabProps): React.JSX.Element {
  const [wanikaniTokenDraft, setWanikaniTokenDraft] = useState('')
  const [syncing, setSyncing] = useState<Partial<Record<KnowledgeSource, boolean>>>({})
  const [syncOutcomes, setSyncOutcomes] = useState<Partial<Record<KnowledgeSource, SourceStatus>>>(
    {}
  )
  // Wall clock the relative-time labels below are rendered against. Reading
  // `Date.now()` inline would make the render impure; it is sampled once on
  // mount and re-sampled after each sync instead, which is the only moment a
  // fresher "…ago"/"available in…" label actually matters.
  const [nowMs, setNowMs] = useState(() => Date.now())

  const syncNow = (source: KnowledgeSource): void => {
    void runSourceSync(source, onSyncNow, setSyncing, setSyncOutcomes).finally(() => {
      setNowMs(Date.now())
    })
  }

  const renderSyncControl = (
    source: KnowledgeSource,
    label: string,
    status: SourceStatus
  ): React.JSX.Element => {
    const isSyncing = syncing[source] === true
    const outcome = syncOutcomes[source] ?? status
    const message = isSyncing ? 'Syncing…' : outcome && formatSyncOutcome(outcome, nowMs)
    return (
      <div className="options-row knowledge-sync-control">
        <button
          type="button"
          id={`knowledge-sync-${source}`}
          className="options-keybind-button"
          disabled={isSyncing}
          onClick={() => syncNow(source)}
        >
          {isSyncing ? `Syncing ${label}…` : `Sync ${label}`}
        </button>
        <span className="options-row-label" id={`${source}-sync-status`}>
          {label}: {status.count} words ({formatLastSynced(status.lastSyncAt, nowMs)})
        </span>
        {message && (
          <span className="knowledge-sync-toast" role="status">
            {message}
          </span>
        )}
      </div>
    )
  }

  return (
    <section className={active ? 'options-tab active' : 'options-tab'} aria-hidden={!active}>
      {loadError && (
        <p className="options-error" id="knowledge-load-error" role="alert">
          {loadError}
        </p>
      )}
      <div className="options-section">
        <h3>WaniKani</h3>
        <div className="options-row">
          <label htmlFor="wanikani-token-input" className="options-row-label">
            Personal access token
          </label>
          <input
            type="password"
            id="wanikani-token-input"
            autoComplete="off"
            placeholder={wanikaniConfigured ? '••••••••' : 'Paste your token'}
            value={wanikaniTokenDraft}
            onChange={(e) => setWanikaniTokenDraft(e.target.value)}
          />
        </div>
        <div className="options-row">
          <span
            id="wanikani-token-status"
            className="options-row-label"
            data-configured={wanikaniConfigured}
          >
            {wanikaniConfigured ? 'Configured ✓' : 'Not configured'}
          </span>
          <button
            type="button"
            id="wanikani-token-save"
            className="options-keybind-button"
            disabled={wanikaniTokenDraft === ''}
            onClick={() => {
              onSaveWanikaniToken(wanikaniTokenDraft)
              setWanikaniTokenDraft('')
            }}
          >
            Save
          </button>
          <button
            type="button"
            id="wanikani-token-clear"
            className="options-keybind-button"
            disabled={!wanikaniConfigured}
            onClick={() => {
              onSaveWanikaniToken('')
              setWanikaniTokenDraft('')
            }}
          >
            Clear
          </button>
        </div>
        <p className="options-hint">
          Read-only token from your WaniKani account settings
          (wanikani.com/settings/personal_access_tokens).{' '}
          {describeTokenStorage(knowledgeSettings.encryptionAvailable)}
        </p>
      </div>

      <div className="options-section">
        <h3>Anki known decks</h3>
        {ankiDeckNames.length === 0 && (
          <p className="options-hint">No decks found — configure the Anki tab first.</p>
        )}
        {ankiDeckNames.map((deckName) => (
          <div className="options-row" key={deckName}>
            <label className="options-row-label">
              <input
                type="checkbox"
                checked={knowledgeSettings.ankiKnownDecks.includes(deckName)}
                onChange={(e) =>
                  onChangeKnowledgeSettings({
                    ankiKnownDecks: toggleDeck(
                      knowledgeSettings.ankiKnownDecks,
                      deckName,
                      e.target.checked
                    )
                  })
                }
                aria-label={`Use ${deckName} as a known-words source`}
              />
              {deckName}
            </label>
          </div>
        ))}
        <div className="options-row">
          <label htmlFor="anki-known-field-select" className="options-row-label">
            Known-word field
          </label>
          {/* Reuses the Anki tab's configured note type's fields — there is no
              per-deck field list available. */}
          <select
            id="anki-known-field-select"
            value={knowledgeSettings.ankiKnownField}
            onChange={(e) => onChangeKnowledgeSettings({ ankiKnownField: e.target.value })}
          >
            <option value="">Unset</option>
            {ankiModelFields.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="options-section">
        <h3>Thresholds</h3>
        <div className="options-row">
          <label htmlFor="known-interval-days-input" className="options-row-label">
            Known after (days)
            <span className="options-row-description">
              Cards whose review interval reaches this many days count as known.
            </span>
          </label>
          <input
            type="number"
            id="known-interval-days-input"
            min={1}
            value={knowledgeSettings.knownIntervalDays}
            onChange={(e) => {
              const value = parseIntervalDaysInput(e.target.value)
              if (value !== null) onChangeKnowledgeSettings({ knownIntervalDays: value })
            }}
          />
        </div>
        <div className="options-row">
          <label htmlFor="well-known-interval-days-input" className="options-row-label">
            Well-known after (days)
            <span className="options-row-description">
              Cards whose review interval reaches this many days count as well known — those words
              get no underline.
            </span>
          </label>
          <input
            type="number"
            id="well-known-interval-days-input"
            min={1}
            value={knowledgeSettings.wellKnownIntervalDays}
            onChange={(e) => {
              const value = parseIntervalDaysInput(e.target.value)
              if (value !== null) onChangeKnowledgeSettings({ wellKnownIntervalDays: value })
            }}
          />
        </div>
      </div>

      <div className="options-section">
        <h3>Sync</h3>
        {renderSyncControl('wanikani', 'WaniKani', syncStatus.wanikani)}
        {renderSyncControl('anki', 'Anki', syncStatus.anki)}
      </div>

      <div className="options-section">
        <h3>Coloring</h3>
        <OptionsToggleRow
          id="coloring-enabled-checkbox"
          title="Color subtitle words by knowledge level"
          checked={knowledgeSettings.coloringEnabled}
          onChange={(coloringEnabled) => onChangeKnowledgeSettings({ coloringEnabled })}
        />
        <div className="options-row knowledge-legend">
          <span style={{ borderBottom: '2px solid var(--level-unknown)' }}>Unknown</span>
          <span style={{ borderBottom: '2px solid var(--level-in-deck)' }}>In deck</span>
          <span style={{ borderBottom: '2px solid var(--level-learning)' }}>Learning</span>
          <span style={{ borderBottom: '2px solid var(--level-known)' }}>Known</span>
          <span style={{ borderBottom: '2px solid transparent' }}>Well known</span>
        </div>
        <p className="options-hint">
          WaniKani and the selected Anki decks are additive knowledge sources — a word need only be
          known in one to color as known, and being known in more than one just keeps the higher
          level. A word whose Anki card is still new or buried colors as &quot;in deck&quot; —
          mined, but not yet learned. Suspended cards are treated as well known.
        </p>
      </div>
    </section>
  )
}
