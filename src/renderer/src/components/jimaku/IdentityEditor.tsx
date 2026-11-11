import type { JimakuSearchCategory } from '../../../../shared/jimaku'
import type { JimakuVideoIdentity } from '../../../../shared/jimakuMatching'
import type { JimakuEpisodeEdit, JimakuIdentityPatch } from '../../state/jimakuController'
import { CATEGORY_OPTIONS, episodeText, identityHints } from './format'

export default function IdentityEditor({
  identity,
  category,
  movie,
  disabled,
  inputRef,
  onEditIdentity,
  onEditEpisode,
  onSearch
}: {
  identity?: JimakuVideoIdentity
  category: JimakuSearchCategory
  movie: boolean
  disabled: boolean
  inputRef: React.RefObject<HTMLInputElement | null>
  onEditIdentity: (patch: JimakuIdentityPatch) => void
  onEditEpisode: (value: JimakuEpisodeEdit) => void
  onSearch: () => void | Promise<void>
}): React.JSX.Element | null {
  if (!identity) return null
  const titleEmpty = identity.titleQuery.trim() === ''
  const hints = identityHints(identity)
  const episodeUnknown = identity.unknowns.some((unknown) => unknown.field === 'episode')

  return (
    <form
      className="jimaku-identity-editor"
      aria-label="Subtitle search"
      onSubmit={(event) => {
        event.preventDefault()
        if (!disabled && !titleEmpty) void onSearch()
      }}
    >
      <div className="jimaku-identity-grid">
        <label className="jimaku-field jimaku-title-field" htmlFor="jimaku-title-query">
          Title query
          <input
            ref={inputRef}
            id="jimaku-title-query"
            type="text"
            value={identity.titleQuery}
            disabled={disabled}
            aria-describedby="jimaku-title-hint"
            onChange={(event) => onEditIdentity({ titleQuery: event.target.value })}
          />
        </label>
        <button
          type="submit"
          className="jimaku-button jimaku-primary"
          disabled={disabled || titleEmpty}
        >
          Search
        </button>
        <label className="jimaku-field" htmlFor="jimaku-category">
          Category
          <select
            id="jimaku-category"
            value={category}
            disabled={disabled}
            onChange={(event) =>
              onEditIdentity({ category: event.target.value as JimakuSearchCategory })
            }
          >
            {CATEGORY_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <label className="jimaku-field" htmlFor="jimaku-episode">
          Episode
          <input
            id="jimaku-episode"
            type="text"
            inputMode="numeric"
            value={episodeText(identity)}
            disabled={disabled || movie}
            aria-describedby="jimaku-episode-hint"
            onChange={(event) => onEditEpisode(event.target.value)}
          />
        </label>
      </div>
      <div className="jimaku-identity-hints">
        <p
          id="jimaku-title-hint"
          className={titleEmpty ? 'jimaku-hint jimaku-warning' : 'jimaku-hint'}
        >
          {titleEmpty
            ? 'Enter a title to search Jimaku.'
            : 'Edit the detected title, then select Search.'}
        </p>
        <p id="jimaku-episode-hint" className="jimaku-hint">
          {movie
            ? 'Movies do not use episode filtering.'
            : episodeUnknown
              ? 'Episode was not detected; enter one if known.'
              : 'Season and episode hints are never changed silently.'}
        </p>
        {hints.length > 0 && (
          <p className="jimaku-identity-hint" aria-label="Detected identity hints">
            {hints.join(' · ')}
          </p>
        )}
      </div>
    </form>
  )
}
