import type { JimakuEntry, JimakuFileCandidate } from '../../../../shared/jimaku'
import type { JimakuControllerNotice } from '../../state/jimakuController'
import { Notice, ReasonList } from './common'
import { formatBytes, formatLabel, itemState } from './format'
import SuccessActions from './SuccessActions'

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

export default function FileStage({
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
