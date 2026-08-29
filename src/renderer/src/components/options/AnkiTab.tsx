import { useState } from 'react'
import {
  defaultAnkiSettings,
  type AnkiJlptSetupResult,
  type AnkiField,
  type AnkiSettings,
  type AnkiPing
} from '../../../../shared/anki'
import type { SettingEntry } from './types'
import OptionsToggleRow from './OptionsToggleRow'

/** Splits a comma-separated tags input into trimmed, non-empty tags. */
export function parseTagsInput(rawValue: string): string[] {
  return rawValue
    .split(',')
    .map((tag) => tag.trim())
    .filter((tag) => tag !== '')
}

/**
 * True when `url` points at this machine — the only case in which mined note
 * content (words, readings, sentences) never leaves it. Anything else, including
 * a URL too malformed to parse, is treated as non-loopback so the warning errs
 * toward being shown. An empty URL is "not configured yet", not a warning.
 */
export function isLoopbackAnkiUrl(url: string): boolean {
  if (url.trim() === '') return true
  let hostname: string
  try {
    hostname = new URL(url).hostname
  } catch {
    return false
  }
  // URL keeps IPv6 hosts bracketed; 127.0.0.0/8 is loopback in full.
  return hostname === 'localhost' || hostname === '[::1]' || /^127\.\d+\.\d+\.\d+$/.test(hostname)
}

/** Row order + display label for each mapped Anki field. */
const ANKI_FIELD_ROWS: { field: AnkiField; label: string }[] = [
  { field: 'word', label: 'Word' },
  { field: 'reading', label: 'Reading' },
  { field: 'definition', label: 'Definition' },
  { field: 'sentence', label: 'Sentence' },
  { field: 'frequency', label: 'Frequency' },
  { field: 'pitchAccent', label: 'Pitch accent' },
  { field: 'jlptLevel', label: 'JLPT level (approx.)' },
  { field: 'wordAudio', label: 'Word audio' },
  { field: 'picture', label: 'Picture' },
  { field: 'sentenceAudio', label: 'Sentence audio' }
]

export interface AnkiTabProps {
  active?: boolean
  ankiSettings?: AnkiSettings
  ankiDeckNames?: string[]
  ankiModelNames?: string[]
  ankiModelFields?: string[]
  ankiPing: () => Promise<AnkiPing>
  onSetupJlptField: () => Promise<AnkiJlptSetupResult>
  onChangeAnkiSettings: (patch: Partial<AnkiSettings>) => void
  /** User-facing error from the last anki-domain load (e.g. "Is Anki
   * running?"). Undefined when there is none. */
  loadError?: string
}

export const ANKI_SETTING_ENTRIES: SettingEntry[] = [
  {
    id: 'anki-url',
    label: 'AnkiConnect URL',
    category: 'anki',
    keywords: ['connection', 'localhost', 'port'],
    targetId: 'anki-url-input'
  },
  {
    id: 'anki-api-key',
    label: 'AnkiConnect API key',
    category: 'anki',
    keywords: ['password', 'secret'],
    targetId: 'anki-api-key-input'
  },
  {
    id: 'anki-deck',
    label: 'Anki deck',
    category: 'anki',
    keywords: ['mining', 'target deck'],
    targetId: 'anki-deck-select'
  },
  {
    id: 'anki-model',
    label: 'Anki note type',
    category: 'anki',
    keywords: ['model', 'template'],
    targetId: 'anki-model-select'
  },
  {
    id: 'anki-test-connection',
    label: 'Test Anki connection',
    category: 'anki',
    keywords: ['ping', 'check'],
    targetId: 'anki-test-connection'
  },
  {
    id: 'anki-fields',
    label: 'Anki field mapping',
    category: 'anki',
    keywords: [
      'word',
      'reading',
      'sentence',
      'audio',
      'screenshot',
      'frequency',
      'pitch accent',
      'jlpt',
      'approximate'
    ]
  },
  {
    id: 'anki-duplicate-policy',
    label: 'Duplicate policy',
    category: 'anki',
    keywords: ['skip', 'allow', 'existing note'],
    targetId: 'anki-duplicate-policy-select'
  },
  { id: 'anki-tags', label: 'Anki tags', category: 'anki', targetId: 'anki-tags-input' },
  {
    id: 'anki-include-audio',
    label: 'Include word audio (JapanesePod101)',
    category: 'anki',
    keywords: ['pronunciation', 'sound'],
    targetId: 'anki-include-audio-checkbox'
  }
]

/** "Anki" options tab: AnkiConnect connection, note-type field mapping, and
 * card-creation settings. Owns the transient "Test connection" result. */
export default function AnkiTab({
  active = true,
  ankiSettings,
  ankiDeckNames = [],
  ankiModelNames = [],
  ankiModelFields = [],
  ankiPing,
  onSetupJlptField,
  onChangeAnkiSettings,
  loadError
}: AnkiTabProps): React.JSX.Element {
  ankiSettings ??= defaultAnkiSettings
  const [ankiPingResult, setAnkiPingResult] = useState<AnkiPing | null>(null)
  const [jlptSetupResult, setJlptSetupResult] = useState<AnkiJlptSetupResult | null>(null)
  const [jlptSetupPending, setJlptSetupPending] = useState(false)
  // The API key is a secret credential whose change triggers a network reload
  // (deckNames/modelNames). Mirroring the WaniKani token field, it lives in a
  // local draft committed only on "Save" — never per keystroke. Otherwise, when
  // AnkiConnect already requires a key, every partial prefix would force a reload
  // that rejects on the incomplete key, and optionsData would revert the field to
  // the previous value, making the key impossible to type in.
  const [apiKeyDraft, setApiKeyDraft] = useState('')
  const apiKeyConfigured = ankiSettings.apiKey !== ''

  const setupJlptField = async (): Promise<void> => {
    if (
      !window.confirm(
        `Set up the JLPT field on "${ankiSettings.modelName}"?\n\n` +
          'This changes the configured note type for every note that uses it. ' +
          'Let Anki create its normal backup or export the note type first.\n\n' +
          'This adds presentation only and does not populate existing notes.'
      )
    ) {
      return
    }

    setJlptSetupPending(true)
    setJlptSetupResult(null)
    try {
      setJlptSetupResult(await onSetupJlptField())
    } catch {
      setJlptSetupResult({
        status: 'api-failure',
        modelName: ankiSettings.modelName,
        message: 'Could not complete the JLPT field setup.'
      })
    } finally {
      setJlptSetupPending(false)
    }
  }

  const jlptSetupMessage =
    jlptSetupResult === null
      ? null
      : jlptSetupResult.status === 'changed'
        ? `JLPT field set up on ${jlptSetupResult.modelName}.`
        : jlptSetupResult.status === 'already-configured'
          ? `JLPT field is already set up on ${jlptSetupResult.modelName}.`
          : jlptSetupResult.message

  const jlptSetupFailed =
    jlptSetupResult?.status === 'preflight-failure' ||
    jlptSetupResult?.status === 'api-failure' ||
    jlptSetupResult?.status === 'verification-failure'

  return (
    <section className={active ? 'options-tab active' : 'options-tab'} aria-hidden={!active}>
      {loadError && (
        <p className="options-error" id="anki-load-error" role="alert">
          {loadError}
        </p>
      )}
      <div className="options-section">
        <h3>AnkiConnect</h3>
        <div className="options-row">
          <label htmlFor="anki-url-input" className="options-row-label">
            AnkiConnect URL
            <span className="options-row-description">
              Where the AnkiConnect add-on listens. Anki must be running for mining to work.
            </span>
          </label>
          <input
            type="text"
            id="anki-url-input"
            value={ankiSettings.url}
            onChange={(e) => onChangeAnkiSettings({ url: e.target.value })}
          />
        </div>
        {!isLoopbackAnkiUrl(ankiSettings.url) && (
          <p className="options-warning" id="anki-url-warning">
            This AnkiConnect URL is not on this machine. Everything mined — words, readings and
            example sentences — is sent to that host in cleartext over plain HTTP.
          </p>
        )}
        <div className="options-row">
          <label htmlFor="anki-api-key-input" className="options-row-label">
            API key
          </label>
          <input
            type="password"
            id="anki-api-key-input"
            autoComplete="off"
            placeholder={apiKeyConfigured ? '••••••••' : 'Only if AnkiConnect requires one'}
            value={apiKeyDraft}
            onChange={(e) => setApiKeyDraft(e.target.value)}
          />
        </div>
        <div className="options-row">
          <span
            id="anki-api-key-status"
            className="options-row-label"
            data-configured={apiKeyConfigured}
          >
            {apiKeyConfigured ? 'Configured ✓' : 'Not set'}
          </span>
          <button
            type="button"
            id="anki-api-key-save"
            className="options-keybind-button"
            disabled={apiKeyDraft === ''}
            onClick={() => {
              onChangeAnkiSettings({ apiKey: apiKeyDraft })
              setApiKeyDraft('')
            }}
          >
            Save
          </button>
          <button
            type="button"
            id="anki-api-key-clear"
            className="options-keybind-button"
            disabled={!apiKeyConfigured}
            onClick={() => {
              onChangeAnkiSettings({ apiKey: '' })
              setApiKeyDraft('')
            }}
          >
            Clear
          </button>
        </div>
        <p className="options-hint" id="anki-api-key-storage-hint">
          Only needed if you set an <code>apiKey</code> in AnkiConnect&apos;s add-on config. It is
          stored unencrypted in Kizuna&apos;s local settings file; leave it blank otherwise.
        </p>
        <div className="options-row">
          <label htmlFor="anki-deck-select" className="options-row-label">
            Deck
            <span className="options-row-description">Mined notes are added to this deck.</span>
          </label>
          <select
            id="anki-deck-select"
            value={ankiSettings.deckName}
            onChange={(e) => onChangeAnkiSettings({ deckName: e.target.value })}
          >
            <option value="">Unset</option>
            {ankiDeckNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div className="options-row">
          <label htmlFor="anki-model-select" className="options-row-label">
            Note type
            <span className="options-row-description">
              The note type mined cards use; its fields fill the mapping below.
            </span>
          </label>
          <select
            id="anki-model-select"
            value={ankiSettings.modelName}
            onChange={(e) => onChangeAnkiSettings({ modelName: e.target.value })}
          >
            <option value="">Unset</option>
            {ankiModelNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <button
            type="button"
            id="anki-setup-jlpt-field"
            className="options-button"
            disabled={jlptSetupPending || ankiSettings.modelName.trim() === ''}
            onClick={() => void setupJlptField()}
          >
            {jlptSetupPending ? 'Setting up…' : 'Set up JLPT field'}
          </button>
        </div>
        {jlptSetupMessage !== null && (
          <p
            id="anki-jlpt-setup-result"
            className={jlptSetupFailed ? 'options-error' : 'options-hint'}
            role={jlptSetupFailed ? 'alert' : undefined}
          >
            {jlptSetupMessage}
          </p>
        )}
        <div className="options-row">
          <span className="options-row-label">Connection</span>
          <button
            type="button"
            id="anki-test-connection"
            className="options-keybind-button"
            onClick={async () => setAnkiPingResult(await ankiPing())}
          >
            Test connection
          </button>
        </div>
        {ankiPingResult && (
          <p id="anki-ping-result" className="options-hint">
            {ankiPingResult.ok
              ? `Anki ${ankiPingResult.version} ✓`
              : (ankiPingResult.error ?? 'Is Anki running?')}
          </p>
        )}
      </div>

      <div className="options-section">
        <h3>Field mapping</h3>
        <p id="anki-media-mapping-hint" className="options-hint">
          Mapping Picture asks you to crop the current frame when you mine with a video loaded;
          mapping Sentence audio clips the subtitle line out of a local file. Leave either unset to
          turn that off.
        </p>
        {ANKI_FIELD_ROWS.map(({ field, label }) => (
          <div className="options-row" key={field}>
            <label htmlFor={`anki-field-${field}-select`} className="options-row-label">
              {label}
            </label>
            <select
              id={`anki-field-${field}-select`}
              value={ankiSettings.fieldMap[field]}
              onChange={(e) =>
                onChangeAnkiSettings({
                  fieldMap: { ...ankiSettings.fieldMap, [field]: e.target.value }
                })
              }
            >
              <option value="">Unset</option>
              {ankiModelFields.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </div>
        ))}
      </div>

      <div className="options-section">
        <h3>Cards</h3>
        <div className="options-row">
          <label htmlFor="anki-duplicate-policy-select" className="options-row-label">
            Duplicate policy
          </label>
          <select
            id="anki-duplicate-policy-select"
            value={ankiSettings.duplicatePolicy}
            onChange={(e) =>
              onChangeAnkiSettings({
                duplicatePolicy: e.target.value as AnkiSettings['duplicatePolicy']
              })
            }
          >
            <option value="prevent-global">Prevent duplicates globally</option>
            <option value="prevent-deck">Prevent duplicates in selected deck</option>
            <option value="overwrite">Overwrite existing note</option>
            <option value="allow">Allow duplicates</option>
          </select>
        </div>
        <div className="options-row">
          <label htmlFor="anki-tags-input" className="options-row-label">
            Tags (comma-separated)
          </label>
          <input
            type="text"
            id="anki-tags-input"
            value={ankiSettings.tags.join(', ')}
            onChange={(e) => onChangeAnkiSettings({ tags: parseTagsInput(e.target.value) })}
          />
        </div>
        <OptionsToggleRow
          id="anki-include-audio-checkbox"
          title="Include word audio (JapanesePod101)"
          checked={ankiSettings.includeWordAudio}
          onChange={(includeWordAudio) => onChangeAnkiSettings({ includeWordAudio })}
        />
        <p className="options-hint" id="jpod101-network-disclosure">
          When enabled, mining a card asks AnkiConnect to download audio from JapanesePod101 using
          the word and reading in the request URL.
        </p>
      </div>
    </section>
  )
}
