import type { JimakuEntry } from '../../../../shared/jimaku'
import { aliases, categoryLabel } from './format'

export function TitleSummary({
  entry,
  onChangeTitle,
  onOpenSourcePage,
  remembered,
  onRememberTitleChange,
  onClearRememberedTitle
}: {
  entry: JimakuEntry
  onChangeTitle: () => void
  onOpenSourcePage: (entryId: number) => void | Promise<void>
  remembered: boolean
  onRememberTitleChange?: (remember: boolean) => void | Promise<void>
  onClearRememberedTitle?: () => void | Promise<void>
}): React.JSX.Element {
  const entryAliases = aliases(entry)
  return (
    <section className="jimaku-title-summary" aria-label="Chosen title">
      <div className="jimaku-title-summary-copy">
        <p className="jimaku-section-label">Chosen title</p>
        <h3>{entry.name}</h3>
        {(entryAliases.japanese || entryAliases.english) && (
          <dl className="jimaku-aliases">
            {entryAliases.japanese && (
              <div>
                <dt>Japanese</dt>
                <dd>{entryAliases.japanese}</dd>
              </div>
            )}
            {entryAliases.english && (
              <div>
                <dt>English</dt>
                <dd>{entryAliases.english}</dd>
              </div>
            )}
          </dl>
        )}
      </div>
      <div className="jimaku-title-summary-preferences">
        {onRememberTitleChange && (
          <label className="jimaku-remember-title">
            <input
              type="checkbox"
              checked={remembered}
              onChange={(event) => void onRememberTitleChange(event.target.checked)}
            />
            <span>Remember this title for this folder</span>
          </label>
        )}
        {remembered && (
          <p className="jimaku-remembered-title" role="status">
            Using remembered title
          </p>
        )}
      </div>
      <div className="jimaku-inline-actions">
        <button type="button" className="jimaku-link-button" onClick={onChangeTitle}>
          Change title
        </button>
        {remembered && onClearRememberedTitle && (
          <button
            type="button"
            className="jimaku-link-button"
            onClick={() => void onClearRememberedTitle()}
          >
            Clear remembered title
          </button>
        )}
        <button
          type="button"
          className="jimaku-link-button"
          onClick={() => void onOpenSourcePage(entry.id)}
        >
          Open on Jimaku
        </button>
      </div>
    </section>
  )
}

function PartialWarning({
  failedCategories,
  onRetry
}: {
  failedCategories: Array<'anime' | 'liveAction'>
  onRetry: () => void | Promise<void>
}): React.JSX.Element {
  const categories = failedCategories.map((category) => categoryLabel(category)).join(' and ')
  return (
    <div className="jimaku-partial-warning" role="alert">
      <p>
        {categories || 'Some categories'} could not be searched. Available titles are still shown.
      </p>
      <button type="button" className="jimaku-button" onClick={() => void onRetry()}>
        Retry
      </button>
    </div>
  )
}

export default function TitleStage({
  entries,
  selectedEntry,
  partial,
  failedCategories,
  onChooseTitle,
  onRefresh
}: {
  entries: JimakuEntry[]
  selectedEntry?: JimakuEntry
  partial: boolean
  failedCategories: Array<'anime' | 'liveAction'>
  onChooseTitle: (entry: number | JimakuEntry) => void | Promise<void>
  onRefresh: () => void | Promise<void>
}): React.JSX.Element {
  return (
    <section className="jimaku-stage" aria-label="Matching Jimaku titles">
      <div className="jimaku-stage-heading">
        <div>
          <p className="jimaku-section-label">Title stage</p>
          <h3>Matching works</h3>
        </div>
        <button type="button" className="jimaku-button" onClick={() => void onRefresh()}>
          Refresh results
        </button>
      </div>
      {partial && <PartialWarning failedCategories={failedCategories} onRetry={onRefresh} />}
      {entries.length === 0 ? (
        <p className="jimaku-empty" role="status">
          Check the title and category, then search Jimaku.
        </p>
      ) : (
        <ul className="jimaku-title-list">
          {entries.map((entry) => {
            const entryAliases = aliases(entry)
            const selected = selectedEntry?.id === entry.id
            return (
              <li key={entry.id}>
                <button
                  type="button"
                  className="jimaku-title-option"
                  data-selected={selected ? '' : undefined}
                  aria-pressed={selected}
                  onClick={() => void onChooseTitle(entry.id)}
                >
                  <span className="jimaku-title-option-main">
                    <strong>{entry.name}</strong>
                    <span className="jimaku-title-option-meta">
                      {entry.flags.movie ? 'Movie' : entry.flags.anime ? 'Anime' : 'Live action'}
                    </span>
                  </span>
                  {(entryAliases.japanese || entryAliases.english) && (
                    <span className="jimaku-title-option-aliases">
                      {[entryAliases.japanese, entryAliases.english].filter(Boolean).join(' · ')}
                    </span>
                  )}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
