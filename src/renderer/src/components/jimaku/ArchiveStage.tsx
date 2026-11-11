import type { JimakuArchiveMembersResult, JimakuFileCandidate } from '../../../../shared/jimaku'
import { CommonSecondaryActions, ReasonList } from './common'
import { archiveMemberHint, formatBytes, itemState } from './format'

export default function ArchiveStage({
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
