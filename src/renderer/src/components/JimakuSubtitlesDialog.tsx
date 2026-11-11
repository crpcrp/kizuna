import { useRef } from 'react'
import type { JimakuEntry } from '../../../shared/jimaku'
import type {
  JimakuControllerPhase,
  JimakuEpisodeEdit,
  JimakuIdentityPatch,
  JimakuControllerState
} from '../state/jimakuController'
import ModalOverlay from './ModalOverlay'
import ArchiveStage from './jimaku/ArchiveStage'
import { BusyPanel } from './jimaku/common'
import ErrorStage from './jimaku/ErrorStage'
import FileStage from './jimaku/FileStage'
import IdentityEditor from './jimaku/IdentityEditor'
import TitleStage, { TitleSummary } from './jimaku/TitleStage'
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
  onRememberTitleChange?(remember: boolean): void | Promise<void>
  onClearRememberedTitle?(): void | Promise<void>
  onChangeTitle?(): void
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

const BUSY_PHASES = new Set<JimakuControllerPhase['kind']>([
  'identifying',
  'searchingTitles',
  'loadingFiles',
  'downloading',
  'applying'
])

export default function JimakuSubtitlesDialog({
  open,
  phase,
  identity,
  category,
  shownEntries,
  selectedEntry,
  rememberedTitle,
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
  onRememberTitleChange,
  onClearRememberedTitle,
  onChangeTitle,
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
    onChangeTitle?.()
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
          rememberedTitle={rememberedTitle !== undefined}
          onClearRememberedTitle={onClearRememberedTitle}
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
            remembered={rememberedTitle !== undefined}
            onRememberTitleChange={onRememberTitleChange}
            onClearRememberedTitle={onClearRememberedTitle}
          />
        )}
        {body}
      </div>
    </ModalOverlay>
  )
}
