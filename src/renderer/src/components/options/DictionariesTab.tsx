import { useState } from 'react'
import type { PopupSettings } from '../../../../shared/playerSettings'
import type { McDict } from '../../../../shared/mecab'
import type { DictInfo, ImportProgress } from '../../../../shared/dictionary'

/** Progress shown by the "please wait" overlay while importing dictionaries. */
interface ImportStatus {
  fileName: string
  current: number
  total: number
  /** Advisory progress for the file currently importing, if any progress
   * messages have arrived yet for it. */
  terms?: ImportProgress
}

/**
 * Formats an advisory import progress reading as "1,000 / 5,000 rows", or null
 * when there's nothing worth showing yet (no rows, or done reached total so the
 * overlay is about to close anyway).
 *
 * "rows", not "terms": the total now counts frequency rows too. A frequency
 * dictionary has no term rows at all, so totalling only those meant BCCWJ's
 * million-row import displayed no progress for its entire duration.
 */
export function formatImportProgress(progress: ImportProgress | undefined): string | null {
  if (!progress || progress.total <= 0 || progress.done >= progress.total) return null
  return `${progress.done.toLocaleString()} / ${progress.total.toLocaleString()} rows`
}

/** Maps the "Frequency dictionary" select's raw value ("" or a dict id
 * string) to the partial PopupSettings update it should apply. */
export function frequencyDictSelection(rawValue: string): Partial<PopupSettings> {
  return { frequencyDictId: rawValue === '' ? null : Number(rawValue) }
}

/** Maps the "Sort order" select's raw value to the partial PopupSettings
 * update it should apply, falling back to 'auto' for any unrecognized value. */
export function sortOrderSelection(rawValue: string): Partial<PopupSettings> {
  return {
    sortOrder: rawValue === 'rank-based' || rawValue === 'occurrence-based' ? rawValue : 'auto'
  }
}

/** Parses a number-input's raw string value into a valid popup-settings
 * count (finite, >= 1), or null when the input isn't a valid count yet
 * (e.g. mid-edit empty string) — callers should skip dispatching on null. */
export function parsePopupCountInput(rawValue: string): number | null {
  const value = Number(rawValue)
  return Number.isFinite(value) && value >= 1 ? value : null
}

export interface DictionariesTabProps {
  mecabDicts: McDict[]
  currentMecabDictId: 'ipadic' | 'unidic'
  yomitanDicts: DictInfo[]
  popupSettings: PopupSettings
  /** User-facing error from the last dictionaries-domain load. Undefined when there is none. */
  loadError?: string
  onSelectMecabDict: (id: 'ipadic' | 'unidic') => void
  onImportYomitanDict: (bytes: Uint8Array) => Promise<void>
  /** Subscribes to advisory term-row progress for the in-flight import;
   * returns an unsubscribe function. Optional — omitting it just leaves the
   * file-count overlay without a terms line (e.g. in tests). */
  subscribeImportProgress?: (cb: (progress: ImportProgress) => void) => () => void
  onSetYomitanEnabled: (id: number, enabled: boolean) => void
  onSetYomitanFallbackOnly: (id: number, fallbackOnly: boolean) => void
  onReorderYomitanDicts: (orderedIds: number[]) => void
  onRemoveYomitanDict: (id: number) => void
  onChangePopupSettings: (value: Partial<PopupSettings>) => void
}

/** "Parser & Dictionaries" options tab: MeCab dictionary selection, Yomitan
 * dictionary import/management, and word-popup display settings. Owns its
 * own import-progress overlay state — App/OptionsMenu don't need to know a
 * multi-file import is in flight. */
export default function DictionariesTab({
  mecabDicts,
  currentMecabDictId,
  yomitanDicts,
  popupSettings,
  loadError,
  onSelectMecabDict,
  onImportYomitanDict,
  subscribeImportProgress,
  onSetYomitanEnabled,
  onSetYomitanFallbackOnly,
  onReorderYomitanDicts,
  onRemoveYomitanDict,
  onChangePopupSettings
}: DictionariesTabProps): React.JSX.Element {
  const [importStatus, setImportStatus] = useState<ImportStatus | null>(null)

  // Imports one or more selected files in sequence, updating the "please
  // wait" overlay's progress between each so a large batch doesn't look
  // frozen. Sequential (not Promise.all) because importDict writes to the
  // same SQLite file — concurrent writes would just serialize anyway.
  const handleImportFiles = async (files: File[]): Promise<void> => {
    if (files.length === 0) return
    const total = files.length
    for (let index = 0; index < total; index++) {
      const file = files[index]
      setImportStatus({ fileName: file.name, current: index + 1, total })
      const unsubscribe = subscribeImportProgress?.((terms) =>
        setImportStatus((status) => (status ? { ...status, terms } : status))
      )
      try {
        const bytes = new Uint8Array(await file.arrayBuffer())
        await onImportYomitanDict(bytes)
      } finally {
        unsubscribe?.()
      }
    }
    setImportStatus(null)
  }

  return (
    <section className="options-tab active" aria-hidden="false">
      <div
        className={importStatus ? 'options-import-overlay open' : 'options-import-overlay'}
        aria-hidden={!importStatus}
      >
        {importStatus && (
          <div className="options-import-overlay-card">
            <div className="options-import-spinner" aria-hidden="true" />
            <p>
              Reading &ldquo;{importStatus.fileName}&rdquo;, please wait…
              {importStatus.total > 1 && (
                <span className="options-import-count">
                  {' '}
                  ({importStatus.current} of {importStatus.total})
                </span>
              )}
            </p>
            {formatImportProgress(importStatus.terms) && (
              <p className="options-import-terms">{formatImportProgress(importStatus.terms)}</p>
            )}
          </div>
        )}
      </div>

      {loadError && (
        <p className="options-error" id="dictionaries-load-error" role="alert">
          {loadError}
        </p>
      )}
      <div className="options-section">
        <h3>MeCab dictionary</h3>
        <p className="options-description">
          The parser dictionary that splits Japanese subtitles into words — different from a Yomitan
          definition dictionary.
        </p>
        {mecabDicts.map((dict) => (
          <div className="options-row" key={dict.id}>
            <button
              type="button"
              className="menu-item"
              role="menuitemradio"
              aria-checked={dict.installed && dict.id === currentMecabDictId}
              aria-label={`Select ${dict.label} dictionary`}
              disabled={!dict.installed}
              aria-disabled={!dict.installed}
              onClick={() => {
                if (dict.installed) onSelectMecabDict(dict.id)
              }}
            >
              <span className="menu-item-check">
                {dict.installed && dict.id === currentMecabDictId ? '✓' : ''}
              </span>
              <span className="menu-item-label">{dict.label}</span>
            </button>
            <span
              className={dict.installed ? 'state-badge installed' : 'state-badge missing'}
              aria-label={`${dict.label} ${dict.installed ? 'installed' : 'missing'}`}
            >
              {dict.installed ? 'Installed' : 'Missing'}
            </span>
          </div>
        ))}
        <p className="options-hint">
          UniDic is a separate download. Install a compatible MeCab UniDic folder at{' '}
          <code>resources/mecab/unidic</code>, then restart Kizuna.
        </p>
      </div>

      <div className="options-section">
        <h3>Yomitan dictionaries</h3>
        <p className="options-description">
          Dictionary order is the final lookup tie-breaker, after match quality, priority tags,
          frequency, and score. It is not a strict override; use the arrows to change it.
        </p>

        <div className="yomitan-import-row">
          <input
            type="file"
            id="yomitan-import-input"
            className="yomitan-import-input"
            accept=".zip"
            multiple
            onChange={async (e) => {
              // Snapshot into a plain array before resetting the input —
              // e.target.files is a live FileList tied to the input, so
              // clearing .value right after reading it would empty this
              // reference too.
              const files = Array.from(e.target.files ?? [])
              e.target.value = ''
              await handleImportFiles(files)
            }}
          />
          <label htmlFor="yomitan-import-input" className="yomitan-import-button">
            <span className="yomitan-import-icon" aria-hidden="true">
              +
            </span>
            Import dictionaries…
          </label>
        </div>

        {yomitanDicts.map((dict, index) => (
          <div className="options-row" key={dict.id}>
            <label className="options-row-label">
              <input
                type="checkbox"
                checked={dict.enabled}
                onChange={(e) => onSetYomitanEnabled(dict.id, e.target.checked)}
                aria-label={`Enable ${dict.title}`}
              />
              <span className="yomitan-dict-order" aria-label={`Dictionary order ${index + 1}`}>
                {index + 1}.
              </span>{' '}
              {dict.title} ({dict.revision})
              {dict.needsReimport && (
                <span
                  className="yomitan-reimport-badge"
                  title="This dictionary was imported before newer features (frequency data, etc.) were added. Re-import it to use them."
                  aria-label={`${dict.title} needs re-import for new features`}
                >
                  &#9888; re-import for new features
                </span>
              )}
            </label>
            <label className="options-row-label">
              <input
                type="checkbox"
                checked={dict.fallbackOnly}
                onChange={(e) => onSetYomitanFallbackOnly(dict.id, e.target.checked)}
                aria-label={`Show ${dict.title} as names-only fallback`}
              />
              Names only (fallback){' '}
              <span
                title="Results from this dictionary appear after regular dictionary results. Use this for name dictionaries so normal definitions are preferred."
                aria-label="About names-only fallback"
                role="img"
              >
                (?)
              </span>
            </label>
            <div className="yomitan-dict-actions">
              <button
                type="button"
                aria-label={`Move ${dict.title} up`}
                disabled={index === 0}
                onClick={() => {
                  const reordered = [...yomitanDicts.map((d) => d.id)]
                  ;[reordered[index - 1], reordered[index]] = [
                    reordered[index],
                    reordered[index - 1]
                  ]
                  onReorderYomitanDicts(reordered)
                }}
              >
                &#x2191;
              </button>
              <button
                type="button"
                aria-label={`Move ${dict.title} down`}
                disabled={index === yomitanDicts.length - 1}
                onClick={() => {
                  const reordered = [...yomitanDicts.map((d) => d.id)]
                  ;[reordered[index], reordered[index + 1]] = [
                    reordered[index + 1],
                    reordered[index]
                  ]
                  onReorderYomitanDicts(reordered)
                }}
              >
                &#x2193;
              </button>
              <button
                type="button"
                className="yomitan-dict-remove"
                aria-label={`Remove ${dict.title}`}
                onClick={() => {
                  if (window.confirm(`Remove "${dict.title}"? This cannot be undone.`)) {
                    onRemoveYomitanDict(dict.id)
                  }
                }}
              >
                &#x2715;
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="options-section">
        <h3>Word popup</h3>
        <div className="options-row">
          <label htmlFor="popup-freq-dict-select" className="options-row-label">
            Frequency dictionary
            <span className="options-row-description">
              Supplies the frequency number shown next to each word in the popup.
            </span>
          </label>
          <select
            id="popup-freq-dict-select"
            value={popupSettings.frequencyDictId ?? ''}
            onChange={(e) => onChangePopupSettings(frequencyDictSelection(e.target.value))}
          >
            <option value="">None</option>
            {yomitanDicts.map((dict) => (
              <option key={dict.id} value={dict.id}>
                {dict.title}
              </option>
            ))}
          </select>
        </div>
        <div className="options-row">
          <label htmlFor="popup-sort-order-select" className="options-row-label">
            Sort order
            <span className="options-row-description">
              How the word popup ranks entries when the frequency dictionary has data for them.
            </span>
          </label>
          <select
            id="popup-sort-order-select"
            value={popupSettings.sortOrder}
            onChange={(e) => onChangePopupSettings(sortOrderSelection(e.target.value))}
          >
            <option value="auto">Auto (dictionary default)</option>
            <option value="rank-based">Rank-based (lower rank first)</option>
            <option value="occurrence-based">Occurrence-based (lower value first)</option>
          </select>
        </div>
        <div className="options-row">
          <label htmlFor="popup-max-entries-input" className="options-row-label">
            Max entries shown
            <span className="options-row-description">
              Most dictionary entries the word popup lists for one word.
            </span>
          </label>
          <input
            type="number"
            id="popup-max-entries-input"
            min={1}
            max={50}
            value={popupSettings.maxEntries}
            onChange={(e) => {
              const value = parsePopupCountInput(e.target.value)
              if (value !== null) onChangePopupSettings({ maxEntries: value })
            }}
          />
        </div>
        <div className="options-row">
          <label htmlFor="popup-max-meanings-input" className="options-row-label">
            Max meanings per entry
            <span className="options-row-description">
              Most definitions the word popup lists under a single entry.
            </span>
          </label>
          <input
            type="number"
            id="popup-max-meanings-input"
            min={1}
            max={50}
            value={popupSettings.maxMeanings}
            onChange={(e) => {
              const value = parsePopupCountInput(e.target.value)
              if (value !== null) onChangePopupSettings({ maxMeanings: value })
            }}
          />
        </div>
      </div>
    </section>
  )
}
