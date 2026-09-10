import { useRef, useState } from 'react'
import type {
  JimakuArchiveMember,
  JimakuArchiveMembersResult,
  JimakuEntry,
  JimakuFileCandidate,
  JimakuSearchCategory
} from '../../../shared/jimaku'
import type {
  JimakuControllerErrorCode,
  JimakuControllerNotice,
  JimakuControllerPhase,
  JimakuEpisodeEdit,
  JimakuIdentityPatch,
  JimakuControllerState
} from '../state/jimakuController'
import type { JimakuVideoIdentity } from '../../../shared/jimakuMatching'
import ModalOverlay from './ModalOverlay'
import { SUBTITLE_OFFSET_STEP_MS } from './menu/utils'
import './JimakuSubtitlesDialog.css'

export interface JimakuSubtitlesDialogProps extends JimakuControllerState {
  open: boolean
  onClose(): void
  onEditIdentity(patch: JimakuIdentityPatch): void
  onEditEpisode(value: JimakuEpisodeEdit): void
  onSearch(): void | Promise<void>
  onChooseTitle(entry: number | JimakuEntry): void | Promise<void>
  onShowMoreFiles(): void
  onShowAllFiles(): void
  onChooseFile(candidateId: string): void | Promise<void>
  onChooseMember(memberId: string): void | Promise<void>
  onCancelOperation(): void
  onTryAnother(): void
  onRevert(): void | Promise<void>
  onRefresh(): void | Promise<void>
  onOpenSourcePage(entryId?: number): void | Promise<void>
  /** Supplied by the settings entry point; omitted until that slice is wired. */
  onOpenSettings?(): void
  /** Supplied by the subtitle timing controls; omitted until that slice is wired. */
  onAdjustTiming?(): void
  subtitleOffsetMs?: number
  onChangeSubtitleOffset?: (value: number) => void
  /** Existing local subtitle picker, supplied by the media-session owner. */
  onLoadLocalFile?(): void
  /** Optional retry timestamp when the controller exposes one. */
  retryAt?: string
}

const CATEGORY_OPTIONS: readonly { value: JimakuSearchCategory; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'anime', label: 'Anime' },
  { value: 'liveAction', label: 'Live action' }
]

const BUSY_PHASES = new Set<JimakuControllerPhase['kind']>([
  'identifying',
  'searchingTitles',
  'loadingFiles',
  'downloading',
  'applying'
])

const TITLE_RETRY_ERRORS = new Set<JimakuControllerErrorCode>([
  'timeout',
  'network',
  'rateLimited',
  'serviceUnavailable',
  'invalidResponse',
  'invalidSession',
  'expired'
])

const FILE_RETRY_ERRORS = new Set<JimakuControllerErrorCode>([
  'timeout',
  'network',
  'rateLimited',
  'serviceUnavailable',
  'invalidResponse',
  'invalidSession',
  'expired',
  'storage'
])

function episodeText(identity: JimakuVideoIdentity | undefined): string {
  if (!identity) return ''
  if (identity.episodeRange) return `${identity.episodeRange.start}-${identity.episodeRange.end}`
  return identity.episode === undefined ? '' : String(identity.episode)
}

function identityHints(identity: JimakuVideoIdentity | undefined): string[] {
  if (!identity) return []
  const hints: string[] = []
  if (identity.season !== undefined) hints.push(`Season ${identity.season}`)
  if (identity.year !== undefined) hints.push(`Year ${identity.year}`)
  if (identity.releaseGroup) hints.push(`Release group: ${identity.releaseGroup}`)
  if (identity.source) hints.push(`Source: ${identity.source}`)
  return hints
}

function aliases(entry: JimakuEntry): { japanese?: string; english?: string } {
  return {
    ...(entry.japaneseName && entry.japaneseName !== entry.name
      ? { japanese: entry.japaneseName }
      : {}),
    ...(entry.englishName && entry.englishName !== entry.name ? { english: entry.englishName } : {})
  }
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) return 'Size unknown'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`
}

function formatLabel(format: JimakuFileCandidate['format']): string {
  return format === 'unsupported' ? 'Unsupported format' : format.toUpperCase()
}

function categoryLabel(category: JimakuSearchCategory): string {
  return CATEGORY_OPTIONS.find((option) => option.value === category)?.label ?? category
}

function errorMessage(
  phase: Extract<JimakuControllerPhase, { kind: 'error' }>,
  retryAt?: string
): string {
  if (phase.code === 'notConfigured') return 'Jimaku setup is required before searching subtitles.'
  if (phase.code === 'unauthorized') return 'The Jimaku API key is invalid. Update it in Settings.'
  if (phase.code === 'rateLimited') {
    if (retryAt) {
      const timestamp = new Date(retryAt)
      if (!Number.isNaN(timestamp.getTime())) {
        return `Jimaku is rate-limited. Try again after ${timestamp.toLocaleTimeString([], {
          hour: 'numeric',
          minute: '2-digit'
        })}.`
      }
    }
    return 'Jimaku is rate-limited. Try again later.'
  }
  if (phase.code === 'notFound' && phase.recovery === 'titles') {
    return 'No matching titles. Edit the title or category and search again.'
  }
  if (phase.code === 'notFound' && phase.recovery === 'files') {
    return 'No usable subtitles were found for this title. Try another title or refresh results.'
  }
  if (phase.code === 'noMedia')
    return 'No video is open. You can load a local subtitle file instead.'
  if (phase.code === 'invalidSubtitle' || phase.code === 'unsupportedDownload') {
    return 'This subtitle cannot be used. Choose another file.'
  }
  if (
    phase.code === 'invalidArchive' ||
    phase.code === 'unsupportedArchive' ||
    phase.code === 'tooLarge'
  ) {
    return 'This archive cannot be used. Choose another file.'
  }
  if (phase.code === 'selection') return 'Kizuna could not load this subtitle. Choose another file.'
  if (phase.code === 'openExternalFailed') return 'Jimaku could not be opened. Try again.'
  if (phase.code === 'staleMedia') return 'The video changed. Close and reopen subtitle search.'
  if (phase.code === 'invalidRequest')
    return 'Check the title, category, and episode, then search again.'
  if (phase.code === 'storage')
    return 'The subtitle could not be saved. Choose another file or try again.'
  return 'Jimaku is temporarily unavailable. Try again.'
}

function statusMessage(notice: JimakuControllerNotice | undefined): string | null {
  if (notice === 'applied') return 'Subtitle loaded.'
  if (notice === 'sameContent') return 'This subtitle is already in use.'
  if (notice === 'loadedButNotSaved')
    return 'Subtitle loaded, but the selection could not be saved.'
  return null
}

function IdentityEditor({
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

function TitleSummary({
  entry,
  onChangeTitle,
  onOpenSourcePage
}: {
  entry: JimakuEntry
  onChangeTitle: () => void
  onOpenSourcePage: (entryId: number) => void | Promise<void>
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
      <div className="jimaku-inline-actions">
        <button type="button" className="jimaku-link-button" onClick={onChangeTitle}>
          Change title
        </button>
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

function BusyPanel({
  message,
  onCancel
}: {
  message: string
  onCancel?: () => void
}): React.JSX.Element {
  return (
    <section className="jimaku-busy" role="status" aria-live="polite" aria-busy="true">
      <span className="jimaku-spinner" aria-hidden="true" />
      <p>{message}</p>
      {onCancel && (
        <button type="button" className="jimaku-button" onClick={onCancel}>
          Cancel
        </button>
      )}
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

function TitleStage({
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

function itemState(
  itemKey: string,
  currentVersionId: string | undefined,
  triedVersionIds: string[],
  appliedVersionByItem: Record<string, string>
): { inUse: boolean; previouslyTried: boolean } {
  const version = appliedVersionByItem[itemKey]
  return {
    inUse: version !== undefined && version === currentVersionId,
    previouslyTried:
      version !== undefined && version !== currentVersionId && triedVersionIds.includes(version)
  }
}

function ReasonList({ reasons }: { reasons: string[] }): React.JSX.Element | null {
  if (reasons.length === 0) return null
  return (
    <ul className="jimaku-reasons" aria-label="Match reasons">
      {reasons.map((reason) => (
        <li key={reason}>{reason}</li>
      ))}
    </ul>
  )
}

function FileRow({
  entry,
  file,
  itemKey,
  currentVersionId,
  triedVersionIds,
  appliedVersionByItem,
  onChooseFile,
  onOpenSourcePage
}: {
  entry: JimakuEntry
  file: JimakuFileCandidate
  itemKey: string
  currentVersionId?: string
  triedVersionIds: string[]
  appliedVersionByItem: Record<string, string>
  onChooseFile: (candidateId: string) => void | Promise<void>
  onOpenSourcePage: (entryId: number) => void | Promise<void>
}): React.JSX.Element {
  const state = itemState(itemKey, currentVersionId, triedVersionIds, appliedVersionByItem)
  const unsupported = file.format === 'unsupported' || entry.flags.external
  const excluded = file.status === 'excluded'
  const reasonId = `jimaku-file-reasons-${file.candidateId.replace(/[^a-zA-Z0-9_-]/gu, '-')}`
  let action: React.JSX.Element
  if (unsupported) {
    action = (
      <button
        type="button"
        className="jimaku-button"
        onClick={() => void onOpenSourcePage(file.sourcePage.entryId)}
      >
        Open on Jimaku
      </button>
    )
  } else if (excluded) {
    action = (
      <button
        type="button"
        className="jimaku-button"
        disabled
        aria-describedby={file.reasons.length > 0 ? reasonId : undefined}
      >
        Not recommended
      </button>
    )
  } else if (file.format === 'zip') {
    action = (
      <button
        type="button"
        className="jimaku-button jimaku-primary"
        onClick={() => void onChooseFile(file.candidateId)}
      >
        Choose file…
      </button>
    )
  } else {
    action = (
      <button
        type="button"
        className="jimaku-button jimaku-primary"
        onClick={() => void onChooseFile(file.candidateId)}
      >
        Download and use
      </button>
    )
  }

  return (
    <li
      className="jimaku-file-row"
      data-status={file.status}
      data-selected={state.inUse ? '' : undefined}
    >
      <div className="jimaku-file-copy">
        <p className="jimaku-file-name" title={file.name}>
          {file.name}
        </p>
        <div className="jimaku-file-meta">
          <span className="jimaku-format">{formatLabel(file.format)}</span>
          <span>{formatBytes(file.size)}</span>
          {state.inUse && <span className="jimaku-status-chip jimaku-status-current">In use</span>}
          {state.previouslyTried && <span className="jimaku-status-chip">Previously tried</span>}
        </div>
        <ReasonList reasons={file.reasons} />
      </div>
      <div className="jimaku-file-actions">
        {action}
        <button
          type="button"
          className="jimaku-link-button"
          aria-label={`Open ${file.name} source on Jimaku`}
          onClick={() => void onOpenSourcePage(file.sourcePage.entryId)}
        >
          Source
        </button>
        {file.reasons.length > 0 && (
          <span id={reasonId} className="jimaku-visually-hidden">
            {file.reasons.join(', ')}
          </span>
        )}
      </div>
    </li>
  )
}

function Notice({ notice }: { notice?: JimakuControllerNotice }): React.JSX.Element | null {
  const message = statusMessage(notice)
  if (!message) return null
  return (
    <p className="jimaku-notice" role="status" aria-live="polite">
      {message}
    </p>
  )
}

function CommonSecondaryActions({
  onTryAnother,
  onLoadLocalFile
}: {
  onTryAnother: () => void
  onLoadLocalFile?: () => void
}): React.JSX.Element {
  return (
    <div className="jimaku-dialog-actions">
      <button type="button" className="jimaku-button" onClick={onTryAnother}>
        Try another
      </button>
      {onLoadLocalFile && (
        <button type="button" className="jimaku-button" onClick={onLoadLocalFile}>
          Load local file…
        </button>
      )}
    </div>
  )
}

function FileStage({
  selectedEntry,
  files,
  shownFiles,
  showingMoreFiles,
  showingAllFiles,
  currentVersionId,
  triedVersionIds,
  appliedVersionByItem,
  notice,
  canRevert,
  onAdjustTiming,
  subtitleOffsetMs,
  onChangeSubtitleOffset,
  onRevert,
  onShowMoreFiles,
  onShowAllFiles,
  onChooseFile,
  onRefresh,
  onTryAnother,
  onOpenSourcePage,
  onLoadLocalFile
}: {
  selectedEntry: JimakuEntry
  files: JimakuFileCandidate[]
  shownFiles: JimakuFileCandidate[]
  showingMoreFiles: boolean
  showingAllFiles: boolean
  currentVersionId?: string
  triedVersionIds: string[]
  appliedVersionByItem: Record<string, string>
  notice?: JimakuControllerNotice
  canRevert: boolean
  onAdjustTiming?: () => void
  subtitleOffsetMs?: number
  onChangeSubtitleOffset?: (value: number) => void
  onRevert: () => void | Promise<void>
  onShowMoreFiles: () => void
  onShowAllFiles: () => void
  onChooseFile: (candidateId: string) => void | Promise<void>
  onRefresh: () => void | Promise<void>
  onTryAnother: () => void
  onOpenSourcePage: (entryId: number) => void | Promise<void>
  onLoadLocalFile?: () => void
}): React.JSX.Element {
  const recommendedCount = files.filter((file) => file.status !== 'excluded').length
  const hasMoreRecommended = recommendedCount > shownFiles.length && !showingMoreFiles
  const hasHiddenFiles =
    !showingAllFiles &&
    (files.some((file) => file.status === 'excluded') || recommendedCount > shownFiles.length)

  return (
    <section className="jimaku-stage" aria-label={`Subtitle files for ${selectedEntry.name}`}>
      <div className="jimaku-stage-heading">
        <div>
          <p className="jimaku-section-label">File stage</p>
          <h3>Subtitle files</h3>
        </div>
        <button type="button" className="jimaku-button" onClick={() => void onRefresh()}>
          Refresh results
        </button>
      </div>
      <Notice notice={notice} />
      {selectedEntry.flags.external && (
        <p className="jimaku-inline-warning" role="status">
          This title is hosted externally. Open it on Jimaku to choose a subtitle.
        </p>
      )}
      {shownFiles.length === 0 ? (
        <p className="jimaku-empty" role="status">
          No recommended files are available. Show all files to inspect excluded entries.
        </p>
      ) : (
        <ul className="jimaku-file-list">
          {shownFiles.map((file) => (
            <FileRow
              key={file.candidateId}
              entry={selectedEntry}
              file={file}
              itemKey={file.candidateId}
              currentVersionId={currentVersionId}
              triedVersionIds={triedVersionIds}
              appliedVersionByItem={appliedVersionByItem}
              onChooseFile={onChooseFile}
              onOpenSourcePage={onOpenSourcePage}
            />
          ))}
        </ul>
      )}
      <div className="jimaku-list-actions">
        {hasMoreRecommended && (
          <button type="button" className="jimaku-button" onClick={onShowMoreFiles}>
            Show more
          </button>
        )}
        {hasHiddenFiles && (
          <button type="button" className="jimaku-button" onClick={onShowAllFiles}>
            Show all files
          </button>
        )}
      </div>
      <SuccessActions
        canRevert={canRevert}
        onAdjustTiming={onAdjustTiming}
        subtitleOffsetMs={subtitleOffsetMs}
        onChangeSubtitleOffset={onChangeSubtitleOffset}
        onTryAnother={onTryAnother}
        onRevert={onRevert}
        onLoadLocalFile={onLoadLocalFile}
      />
    </section>
  )
}

function archiveMemberHint(member: JimakuArchiveMember): string {
  if (member.inferredEpisode !== undefined) return `Episode ${member.inferredEpisode}`
  if (member.inferredEpisodeRange) {
    return `Episodes ${member.inferredEpisodeRange.start}-${member.inferredEpisodeRange.end}`
  }
  return 'Timing unknown'
}

function ArchiveStage({
  archive,
  showingAllFiles,
  currentVersionId,
  triedVersionIds,
  appliedVersionByItem,
  selectedFile,
  onChooseMember,
  onTryAnother,
  onOpenSourcePage,
  onLoadLocalFile
}: {
  archive: JimakuArchiveMembersResult
  showingAllFiles: boolean
  currentVersionId?: string
  triedVersionIds: string[]
  appliedVersionByItem: Record<string, string>
  selectedFile?: JimakuFileCandidate
  onChooseMember: (memberId: string) => void | Promise<void>
  onTryAnother: () => void
  onOpenSourcePage: (entryId: number) => void | Promise<void>
  onLoadLocalFile?: () => void
}): React.JSX.Element {
  const members = showingAllFiles
    ? archive.members
    : archive.members.filter((member) => member.status !== 'excluded')
  return (
    <section className="jimaku-stage" aria-label="Choose a subtitle from the archive">
      <div className="jimaku-stage-heading">
        <div>
          <p className="jimaku-section-label">Archive stage</p>
          <h3>Choose a subtitle</h3>
        </div>
        <button
          type="button"
          className="jimaku-link-button"
          onClick={() => void onOpenSourcePage(archive.sourcePage.entryId)}
        >
          Open on Jimaku
        </button>
      </div>
      <p className="jimaku-hint">
        Choose a member from <strong>{archive.sourceFileName}</strong>. Kizuna will not guess
        between ambiguous members.
      </p>
      {members.length === 0 ? (
        <p className="jimaku-empty" role="status">
          No usable archive members are available.
        </p>
      ) : (
        <ul className="jimaku-file-list">
          {members.map((member) => {
            const itemKey = `${selectedFile?.candidateId ?? 'archive'}:${member.memberId}`
            const state = itemState(
              itemKey,
              currentVersionId,
              triedVersionIds,
              appliedVersionByItem
            )
            const excluded = member.status === 'excluded'
            return (
              <li className="jimaku-file-row" data-status={member.status} key={member.memberId}>
                <div className="jimaku-file-copy">
                  <p className="jimaku-file-name" title={member.displayName}>
                    {member.displayName}
                  </p>
                  <div className="jimaku-file-meta">
                    <span className="jimaku-format">{member.format.toUpperCase()}</span>
                    <span>{formatBytes(member.size)}</span>
                    <span>{archiveMemberHint(member)}</span>
                    {state.inUse && (
                      <span className="jimaku-status-chip jimaku-status-current">In use</span>
                    )}
                    {state.previouslyTried && (
                      <span className="jimaku-status-chip">Previously tried</span>
                    )}
                  </div>
                  <ReasonList reasons={member.reasons} />
                </div>
                <div className="jimaku-file-actions">
                  <button
                    type="button"
                    className="jimaku-button jimaku-primary"
                    disabled={excluded}
                    onClick={() => void onChooseMember(member.memberId)}
                  >
                    Download and use
                  </button>
                  <button
                    type="button"
                    className="jimaku-link-button"
                    aria-label={`Open ${member.displayName} source on Jimaku`}
                    onClick={() => void onOpenSourcePage(archive.sourcePage.entryId)}
                  >
                    Source
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      <CommonSecondaryActions onTryAnother={onTryAnother} onLoadLocalFile={onLoadLocalFile} />
    </section>
  )
}

function ErrorStage({
  phase,
  retryAt,
  onOpenSettings,
  onRefresh,
  onTryAnother,
  onLoadLocalFile,
  onOpenSourcePage,
  onFocusTitle
}: {
  phase: Extract<JimakuControllerPhase, { kind: 'error' }>
  retryAt?: string
  onOpenSettings?: () => void
  onRefresh: () => void | Promise<void>
  onTryAnother: () => void
  onLoadLocalFile?: () => void
  onOpenSourcePage: (entryId?: number) => void | Promise<void>
  onFocusTitle: () => void
}): React.JSX.Element {
  const retryTitles = phase.recovery === 'titles' && TITLE_RETRY_ERRORS.has(phase.code)
  const retryFiles = phase.recovery === 'files' && FILE_RETRY_ERRORS.has(phase.code)
  const noTitles = phase.code === 'notFound' && phase.recovery === 'titles'
  const settings = phase.code === 'notConfigured' || phase.code === 'unauthorized'
  const chooseAnother = phase.recovery === 'files' && !retryFiles
  const localFileRelevant =
    phase.code === 'noMedia' ||
    phase.recovery === 'files' ||
    phase.code === 'invalidSubtitle' ||
    phase.code === 'unsupportedDownload'

  return (
    <section className="jimaku-error-stage" aria-label="Jimaku subtitle search error">
      <div className="jimaku-error" role="alert">
        <p>{errorMessage(phase, retryAt)}</p>
      </div>
      <div className="jimaku-dialog-actions">
        {settings && onOpenSettings && (
          <button type="button" className="jimaku-button jimaku-primary" onClick={onOpenSettings}>
            Settings
          </button>
        )}
        {noTitles && (
          <button type="button" className="jimaku-button jimaku-primary" onClick={onFocusTitle}>
            Edit title or category
          </button>
        )}
        {(retryTitles || retryFiles) && (
          <button
            type="button"
            className="jimaku-button jimaku-primary"
            onClick={() => void onRefresh()}
          >
            Retry
          </button>
        )}
        {phase.code === 'openExternalFailed' && (
          <button
            type="button"
            className="jimaku-button jimaku-primary"
            onClick={() => void onOpenSourcePage()}
          >
            Try again
          </button>
        )}
        {chooseAnother && (
          <button type="button" className="jimaku-button" onClick={onTryAnother}>
            Choose another file
          </button>
        )}
        {localFileRelevant && onLoadLocalFile && (
          <button type="button" className="jimaku-button" onClick={onLoadLocalFile}>
            Load local file…
          </button>
        )}
      </div>
    </section>
  )
}

function SuccessActions({
  canRevert,
  onAdjustTiming,
  subtitleOffsetMs,
  onChangeSubtitleOffset,
  onTryAnother,
  onRevert,
  onLoadLocalFile
}: {
  canRevert: boolean
  onAdjustTiming?: () => void
  subtitleOffsetMs?: number
  onChangeSubtitleOffset?: (value: number) => void
  onTryAnother: () => void
  onRevert: () => void | Promise<void>
  onLoadLocalFile?: () => void
}): React.JSX.Element {
  const [adjusting, setAdjusting] = useState(false)
  const canAdjust =
    onAdjustTiming !== undefined ||
    (onChangeSubtitleOffset !== undefined && subtitleOffsetMs !== undefined)
  return (
    <div className="jimaku-dialog-actions">
      {canAdjust && (
        <button
          type="button"
          className="jimaku-button"
          onClick={() => {
            setAdjusting(true)
            onAdjustTiming?.()
          }}
        >
          Adjust timing
        </button>
      )}
      {adjusting && onChangeSubtitleOffset && subtitleOffsetMs !== undefined && (
        <div className="jimaku-timing-controls" aria-label="Subtitle timing controls">
          <span>{subtitleOffsetMs} ms</span>
          <button
            type="button"
            className="jimaku-button"
            aria-label="Show subtitles earlier"
            title="Show subtitles earlier"
            onClick={() => onChangeSubtitleOffset(subtitleOffsetMs - SUBTITLE_OFFSET_STEP_MS)}
          >
            Earlier
          </button>
          <button
            type="button"
            className="jimaku-button"
            aria-label="Show subtitles later"
            title="Show subtitles later"
            onClick={() => onChangeSubtitleOffset(subtitleOffsetMs + SUBTITLE_OFFSET_STEP_MS)}
          >
            Later
          </button>
        </div>
      )}
      <button type="button" className="jimaku-button" onClick={onTryAnother}>
        Try another
      </button>
      {canRevert && (
        <button type="button" className="jimaku-button" onClick={() => void onRevert()}>
          Revert to previous subtitles
        </button>
      )}
      {onLoadLocalFile && (
        <button type="button" className="jimaku-button" onClick={onLoadLocalFile}>
          Load local file…
        </button>
      )}
    </div>
  )
}

export default function JimakuSubtitlesDialog({
  open,
  phase,
  identity,
  category,
  shownEntries,
  selectedEntry,
  files,
  shownFiles,
  showingMoreFiles,
  showingAllFiles,
  selectedFile,
  archive,
  currentVersionId,
  triedVersionIds,
  appliedVersionByItem,
  notice,
  canRevert,
  partial,
  failedCategories,
  onClose,
  onEditIdentity,
  onEditEpisode,
  onSearch,
  onChooseTitle,
  onShowMoreFiles,
  onShowAllFiles,
  onChooseFile,
  onChooseMember,
  onCancelOperation,
  onTryAnother,
  onRevert,
  onRefresh,
  onOpenSourcePage,
  onOpenSettings,
  onAdjustTiming,
  subtitleOffsetMs,
  onChangeSubtitleOffset,
  onLoadLocalFile,
  retryAt
}: JimakuSubtitlesDialogProps): React.JSX.Element {
  const titleInputRef = useRef<HTMLInputElement>(null)
  const busy = BUSY_PHASES.has(phase.kind)
  const movie = selectedEntry?.flags.movie ?? false
  const focusTitle = (): void => {
    titleInputRef.current?.focus()
    titleInputRef.current?.select()
  }

  let body: React.JSX.Element | null = null
  switch (phase.kind) {
    case 'idle':
      body = open ? <BusyPanel message="Preparing subtitle search…" /> : null
      break
    case 'identifying':
      body = <BusyPanel message="Preparing subtitle search…" />
      break
    case 'setupRequired':
      body = (
        <section className="jimaku-error-stage" aria-label="Jimaku setup required">
          <div className="jimaku-error" role="alert">
            <p>Jimaku setup is required before searching subtitles.</p>
          </div>
          <div className="jimaku-dialog-actions">
            {onOpenSettings && (
              <button
                type="button"
                className="jimaku-button jimaku-primary"
                onClick={onOpenSettings}
              >
                Settings
              </button>
            )}
            {onLoadLocalFile && (
              <button type="button" className="jimaku-button" onClick={onLoadLocalFile}>
                Load local file…
              </button>
            )}
          </div>
        </section>
      )
      break
    case 'searchingTitles':
      body = <BusyPanel message="Searching Jimaku titles…" onCancel={onCancelOperation} />
      break
    case 'choosingTitle':
      body = (
        <TitleStage
          entries={shownEntries}
          selectedEntry={selectedEntry}
          partial={partial}
          failedCategories={failedCategories}
          onChooseTitle={onChooseTitle}
          onRefresh={onRefresh}
        />
      )
      break
    case 'loadingFiles':
      body = <BusyPanel message="Loading subtitle files…" onCancel={onCancelOperation} />
      break
    case 'choosingFile':
      body = selectedEntry ? (
        <>
          <FileStage
            selectedEntry={selectedEntry}
            files={files}
            shownFiles={shownFiles}
            showingMoreFiles={showingMoreFiles}
            showingAllFiles={showingAllFiles}
            currentVersionId={currentVersionId}
            triedVersionIds={triedVersionIds}
            appliedVersionByItem={appliedVersionByItem}
            notice={notice}
            canRevert={canRevert}
            onAdjustTiming={onAdjustTiming}
            subtitleOffsetMs={subtitleOffsetMs}
            onChangeSubtitleOffset={onChangeSubtitleOffset}
            onRevert={onRevert}
            onShowMoreFiles={onShowMoreFiles}
            onShowAllFiles={onShowAllFiles}
            onChooseFile={onChooseFile}
            onRefresh={onRefresh}
            onTryAnother={onTryAnother}
            onOpenSourcePage={(entryId) => onOpenSourcePage(entryId)}
            onLoadLocalFile={onLoadLocalFile}
          />
        </>
      ) : null
      break
    case 'downloading':
      body = <BusyPanel message="Downloading subtitle…" onCancel={onCancelOperation} />
      break
    case 'choosingArchiveMember':
      body = archive ? (
        <ArchiveStage
          archive={archive}
          showingAllFiles={showingAllFiles}
          currentVersionId={currentVersionId}
          triedVersionIds={triedVersionIds}
          appliedVersionByItem={appliedVersionByItem}
          selectedFile={selectedFile}
          onChooseMember={onChooseMember}
          onTryAnother={onTryAnother}
          onOpenSourcePage={(entryId) => onOpenSourcePage(entryId)}
          onLoadLocalFile={onLoadLocalFile}
        />
      ) : null
      break
    case 'applying':
      body = <BusyPanel message="Applying subtitle…" onCancel={onCancelOperation} />
      break
    case 'error':
      body = (
        <ErrorStage
          phase={phase}
          retryAt={retryAt}
          onOpenSettings={onOpenSettings}
          onRefresh={onRefresh}
          onTryAnother={onTryAnother}
          onLoadLocalFile={onLoadLocalFile}
          onOpenSourcePage={onOpenSourcePage}
          onFocusTitle={focusTitle}
        />
      )
      break
  }

  return (
    <ModalOverlay
      id="jimaku-subtitles-dialog"
      open={open}
      label="Find Japanese subtitles"
      onClose={onClose}
    >
      <div className="jimaku-dialog" aria-busy={busy}>
        <IdentityEditor
          identity={identity}
          category={category}
          movie={movie}
          disabled={busy}
          inputRef={titleInputRef}
          onEditIdentity={onEditIdentity}
          onEditEpisode={onEditEpisode}
          onSearch={onSearch}
        />
        {selectedEntry && (
          <TitleSummary
            entry={selectedEntry}
            onChangeTitle={focusTitle}
            onOpenSourcePage={onOpenSourcePage}
          />
        )}
        {body}
      </div>
    </ModalOverlay>
  )
}
