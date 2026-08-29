import { JLPT_LEVELS, type JlptLevel } from '../../../shared/jlpt'
import type { JlptExportMode } from '../../../shared/jlptExport'
import type { JlptBulkExportViewModel } from '../state/useJlptBulkExport'
import {
  displayedCandidates,
  miningSet,
  type BulkMiningFilters,
  type MiningCandidate,
  type MiningWordStatus,
  type ResolvedEntry
} from '../state/bulkMining'
import type { BulkMiningPhase } from '../state/bulkMiningController'
import type { JlptMiningCandidate } from '../state/jlptMining'
import ModalOverlay, { type ModalCloseSource } from './ModalOverlay'
import { BulkMiningStatusMarker, BulkMiningSummary } from './BulkMiningStatus'
import './JlptBulkExportModal.css'

export type JlptBulkExportModalProps = JlptBulkExportViewModel

const MODE_OPTIONS: readonly { value: JlptExportMode; label: string }[] = [
  { value: 'vocabulary', label: 'Vocabulary' },
  { value: 'kanji', label: 'Kanji' },
  { value: 'both', label: 'Kanji + vocabulary' }
]

interface ExportControlsProps {
  phase: BulkMiningPhase
  throughLevel: JlptLevel
  mode: JlptExportMode
  onThroughLevelChange: (level: JlptLevel) => void
  onModeChange: (mode: JlptExportMode) => void
  onSelectAll: () => void
  onSelectNone: () => void
}

function asJlptCandidates(candidates: MiningCandidate[]): JlptMiningCandidate[] {
  return candidates as JlptMiningCandidate[]
}

function filtersFor(
  phase: Extract<BulkMiningPhase, { kind: 'ready' }>,
  frequencyDictConfigured: boolean
): BulkMiningFilters {
  return {
    maximumFrequency: null,
    minimumCount: null,
    frequencyDictConfigured,
    targetDeckMatches: phase.targetDeckMatches,
    hideTargetDeckMatches: phase.hideTargetDeckMatches
  }
}

function itemType(candidate: JlptMiningCandidate): 'Kanji' | 'Vocabulary' {
  return candidate.kind === 'kanji' ? 'Kanji' : 'Vocabulary'
}

function frequencyCell(
  resolved: ResolvedEntry | undefined,
  noEntry: boolean,
  fixedFrequency: boolean
): React.JSX.Element {
  const value =
    resolved === undefined ? (
      <span className="jlpt-bulk-export-pending" aria-label="Frequency pending">
        …
      </span>
    ) : resolved.frequency === null ? (
      <span>&mdash;</span>
    ) : (
      <span>
        {fixedFrequency
          ? resolved.frequency
          : (resolved.entry?.frequencyDisplay ?? resolved.frequency)}
      </span>
    )

  return (
    <>
      {value}
      {noEntry && (
        <>
          <span aria-hidden="true"> · </span>
          <span className="jlpt-bulk-export-no-entry">No entry</span>
        </>
      )}
    </>
  )
}

function CandidateTable({
  candidates,
  resolved = {},
  selected = {},
  statuses,
  onToggle
}: {
  candidates: JlptMiningCandidate[]
  resolved?: Record<string, ResolvedEntry>
  selected?: Record<string, boolean>
  statuses?: Record<string, MiningWordStatus>
  onToggle?: (lemma: string) => void
}): React.JSX.Element {
  const showStatuses = statuses !== undefined

  return (
    <div className="jlpt-bulk-export-table-wrap">
      <table className="jlpt-bulk-export-table">
        <caption>Unknown JLPT export candidates</caption>
        <thead>
          <tr>
            <th scope="col">{showStatuses ? 'Status' : 'Select'}</th>
            <th scope="col">Type</th>
            <th scope="col">Expression</th>
            <th scope="col">Reading</th>
            <th scope="col">JLPT level</th>
            <th scope="col">Frequency</th>
          </tr>
        </thead>
        <tbody>
          {candidates.map((candidate) => {
            const type = itemType(candidate)
            const result = resolved[candidate.lemma]
            const noEntry = !showStatuses && result?.entry === null
            const status = statuses?.[candidate.lemma]
            return (
              <tr key={candidate.lemma} data-no-entry={noEntry || undefined}>
                <td>
                  {showStatuses ? (
                    <div className="jlpt-bulk-export-status-cell">
                      <BulkMiningStatusMarker status={status} />
                      {status?.kind === 'error' && (
                        <span className="jlpt-bulk-export-status-detail">{status.message}</span>
                      )}
                    </div>
                  ) : (
                    <input
                      type="checkbox"
                      aria-label={`Select ${type} ${candidate.lemma}`}
                      checked={!noEntry && (selected[candidate.lemma] ?? false)}
                      disabled={noEntry}
                      onChange={() => onToggle?.(candidate.lemma)}
                    />
                  )}
                </td>
                <td>{type}</td>
                <td>{candidate.lemma}</td>
                <td>{candidate.token.reading || <span>&mdash;</span>}</td>
                <td>{candidate.level}</td>
                <td>
                  {showStatuses ? (
                    <span>&mdash;</span>
                  ) : (
                    frequencyCell(result, noEntry, candidate.kind === 'kanji')
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function ExportControls({
  phase,
  throughLevel,
  mode,
  onThroughLevelChange,
  onModeChange,
  onSelectAll,
  onSelectNone
}: ExportControlsProps): React.JSX.Element | null {
  const ready = phase.kind === 'ready'
  const locked = phase.kind === 'running' || phase.kind === 'done'
  if (!ready && !locked) return null

  return (
    <section className="jlpt-bulk-export-controls" aria-label="JLPT export controls">
      <div className="jlpt-bulk-export-control-row">
        <div className="jlpt-bulk-export-control">
          <label htmlFor="jlpt-bulk-export-through-level">Through level</label>
          <select
            id="jlpt-bulk-export-through-level"
            value={throughLevel}
            disabled={locked}
            onChange={(event) => onThroughLevelChange(event.target.value as JlptLevel)}
          >
            {JLPT_LEVELS.map((level) => (
              <option key={level} value={level}>
                {level}
              </option>
            ))}
          </select>
        </div>
        <div className="jlpt-bulk-export-control">
          <label htmlFor="jlpt-bulk-export-mode">Item type</label>
          <select
            id="jlpt-bulk-export-mode"
            value={mode}
            disabled={locked}
            onChange={(event) => onModeChange(event.target.value as JlptExportMode)}
          >
            {MODE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
      </div>
      {ready && (
        <div className="jlpt-bulk-export-selection-actions">
          <button type="button" onClick={onSelectAll}>
            Select all
          </button>
          <button type="button" onClick={onSelectNone}>
            Select none
          </button>
        </div>
      )}
    </section>
  )
}

function closeButton(onClose: () => void): React.JSX.Element {
  return (
    <button type="button" onClick={onClose}>
      Close
    </button>
  )
}

function LoadingBody({ onClose }: { onClose: () => void }): React.JSX.Element {
  return (
    <section className="jlpt-bulk-export-phase" aria-label="JLPT unknown-item export">
      <p className="jlpt-bulk-export-loading" role="status" aria-live="polite">
        Loading unknown JLPT items…
      </p>
      <footer className="jlpt-bulk-export-footer">{closeButton(onClose)}</footer>
    </section>
  )
}

function ErrorBody({
  message,
  onRetry,
  onClose
}: {
  message: string
  onRetry: () => void
  onClose: () => void
}): React.JSX.Element {
  return (
    <section className="jlpt-bulk-export-phase" aria-label="JLPT unknown-item export">
      <p className="jlpt-bulk-export-error" role="alert">
        {message}
      </p>
      <footer className="jlpt-bulk-export-footer">
        <button type="button" onClick={onRetry}>
          Retry
        </button>
        {closeButton(onClose)}
      </footer>
    </section>
  )
}

function emptyText(mode: JlptExportMode, throughLevel: JlptLevel): string {
  const itemLabel = mode === 'both' ? 'vocabulary/kanji' : mode
  return `No unknown ${itemLabel} through ${throughLevel}.`
}

function ReadyBody(
  props: JlptBulkExportModalProps & { phase: Extract<BulkMiningPhase, { kind: 'ready' }> }
): React.JSX.Element {
  const {
    phase,
    throughLevel,
    mode,
    frequencyDictConfigured,
    onThroughLevelChange,
    onModeChange,
    onToggle,
    onSelectAll,
    onSelectNone,
    onStart,
    onClose
  } = props
  const filters = filtersFor(phase, frequencyDictConfigured)
  const displayed = asJlptCandidates(
    displayedCandidates(phase.candidates, phase.resolved, filters, 'frequency')
  )
  const exportCount = miningSet(phase.candidates, phase.resolved, phase.selected, filters).length

  return (
    <section className="jlpt-bulk-export-phase" aria-label="JLPT unknown-item export">
      <ExportControls
        phase={phase}
        throughLevel={throughLevel}
        mode={mode}
        onThroughLevelChange={onThroughLevelChange}
        onModeChange={onModeChange}
        onSelectAll={onSelectAll}
        onSelectNone={onSelectNone}
      />
      {!frequencyDictConfigured && (
        <p className="jlpt-bulk-export-hint">
          Choose a frequency dictionary in Options to rank vocabulary. Vocabulary without frequency
          data appears last.
        </p>
      )}
      {phase.resolving && (
        <p className="jlpt-bulk-export-resolving" role="status" aria-live="polite">
          Dictionary entries are being prepared. Export is disabled until every row is ready.
        </p>
      )}
      <p className="jlpt-bulk-export-hint">
        Showing {displayed.length} of {phase.candidates.length} unknown items
      </p>
      {phase.candidates.length === 0 ? (
        <p className="jlpt-bulk-export-empty" role="status">
          {emptyText(mode, throughLevel)}
        </p>
      ) : displayed.length === 0 ? (
        <p className="jlpt-bulk-export-empty" role="status">
          No items match the current target-deck filter.
        </p>
      ) : (
        <CandidateTable
          candidates={displayed}
          resolved={phase.resolved}
          selected={phase.selected}
          onToggle={onToggle}
        />
      )}
      <footer className="jlpt-bulk-export-footer">
        <button
          type="button"
          id="jlpt-bulk-export-start"
          className="jlpt-bulk-export-primary"
          disabled={exportCount === 0 || phase.resolving}
          onClick={onStart}
        >
          Export {exportCount} items
        </button>
        {closeButton(onClose)}
      </footer>
    </section>
  )
}

function terminalStatusCount(statuses: Record<string, MiningWordStatus>): number {
  return Object.values(statuses).filter(
    (status) => status.kind !== 'queued' && status.kind !== 'mining'
  ).length
}

function RunningBody(
  props: JlptBulkExportModalProps & { phase: Extract<BulkMiningPhase, { kind: 'running' }> }
): React.JSX.Element {
  const { phase } = props
  return (
    <section className="jlpt-bulk-export-phase" aria-label="JLPT unknown-item export">
      <ExportControls {...props} />
      <p className="jlpt-bulk-export-progress" role="status" aria-live="polite">
        Exported {terminalStatusCount(phase.statuses)} of {phase.candidates.length}
      </p>
      <CandidateTable candidates={asJlptCandidates(phase.candidates)} statuses={phase.statuses} />
      <footer className="jlpt-bulk-export-footer">
        <button
          type="button"
          id="jlpt-bulk-export-cancel"
          disabled={phase.cancelling}
          onClick={props.onCancel}
        >
          {phase.cancelling ? 'Cancelling…' : 'Cancel'}
        </button>
      </footer>
    </section>
  )
}

function DoneBody(
  props: JlptBulkExportModalProps & { phase: Extract<BulkMiningPhase, { kind: 'done' }> }
): React.JSX.Element {
  const { phase } = props
  return (
    <section className="jlpt-bulk-export-phase" aria-label="JLPT unknown-item export">
      <ExportControls {...props} />
      {phase.abortMessage && (
        <p className="jlpt-bulk-export-abort" role="alert">
          {phase.abortMessage}
        </p>
      )}
      <CandidateTable candidates={asJlptCandidates(phase.candidates)} statuses={phase.statuses} />
      <BulkMiningSummary summary={phase.summary} />
      <footer className="jlpt-bulk-export-footer">
        <button type="button" id="jlpt-bulk-export-back" onClick={props.onBackToList}>
          Back to list
        </button>
        {closeButton(props.onClose)}
      </footer>
    </section>
  )
}

function ModalBody(props: JlptBulkExportModalProps): React.JSX.Element | null {
  if (!props.open) return null
  switch (props.phase.kind) {
    case 'idle':
    case 'preparing':
      return <LoadingBody onClose={props.onClose} />
    case 'error':
      return (
        <ErrorBody message={props.phase.message} onRetry={props.onRetry} onClose={props.onClose} />
      )
    case 'ready':
      return <ReadyBody {...props} phase={props.phase} />
    case 'running':
      return <RunningBody {...props} phase={props.phase} />
    case 'done':
      return <DoneBody {...props} phase={props.phase} />
    case 'unavailable':
      return null
  }
}

export default function JlptBulkExportModal(props: JlptBulkExportModalProps): React.JSX.Element {
  const onOverlayClose = (source: ModalCloseSource): void => {
    if (props.phase.kind === 'running' && source !== 'button') return
    props.onClose()
  }
  const running = props.phase.kind === 'running'

  return (
    <ModalOverlay
      id="jlpt-bulk-export"
      open={props.open}
      label="JLPT unknown-item export"
      onClose={onOverlayClose}
      headerActions={
        running ? (
          <span className="jlpt-bulk-export-running-label" aria-hidden="true">
            Exporting…
          </span>
        ) : (
          <button
            type="button"
            id="jlpt-bulk-export-close"
            aria-label="Close JLPT unknown-item export"
            onClick={props.onClose}
          >
            &#x2715;
          </button>
        )
      }
    >
      <div
        className="jlpt-bulk-export-body"
        aria-busy={
          props.phase.kind === 'preparing' ||
          (props.phase.kind === 'ready' && props.phase.resolving)
        }
      >
        <ModalBody {...props} />
      </div>
    </ModalOverlay>
  )
}
