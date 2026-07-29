import './BulkMining.css'
import {
  displayedCandidates,
  hiddenTargetDeckMatchCount,
  miningSet,
  type BulkMiningFilters,
  type BulkMiningSort,
  type MiningCandidate,
  type MiningWordStatus,
  type ResolvedEntry
} from '../state/bulkMining'
import type { BulkMiningPhase } from '../state/bulkMiningController'

export interface BulkMiningProps {
  phase: BulkMiningPhase
  frequencyDictConfigured: boolean
  onThresholdChange: (raw: string) => void
  onMinimumCountChange: (raw: string) => void
  onSortChange: (sort: BulkMiningSort) => void
  onToggle: (lemma: string) => void
  onSelectAll: () => void
  onSelectNone: () => void
  onSetHideTargetDeckMatches: (hide: boolean) => void
  targetDeckName?: string
  onStart: () => void
  onCancel: () => void
  onClose: () => void
  onBackToList: () => void
  onRetry: () => void
}

function FrequencyCell({ resolved }: { resolved: ResolvedEntry | undefined }): React.JSX.Element {
  if (resolved === undefined) return <span className="bulk-mining-pending">&hellip;</span>
  if (resolved.frequency === null) return <span>&mdash;</span>
  return <span>{resolved.entry?.frequencyDisplay ?? resolved.frequency}</span>
}

function StatusMarker({ status }: { status: MiningWordStatus | undefined }): React.JSX.Element {
  const kind = status?.kind ?? 'queued'
  const text =
    status?.kind === 'duplicate'
      ? status.deckNames.length > 0
        ? `Duplicate in: ${status.deckNames.join(', ')}`
        : 'Duplicate (deck unavailable)'
      : kind === 'noEntry'
        ? 'No entry'
        : kind === 'updated'
          ? 'Updated'
          : kind
  return (
    <span className="bulk-mining-status" data-status={kind}>
      {text}
    </span>
  )
}

function CandidateTable({
  candidates,
  resolved = {},
  selected = {},
  statuses,
  onToggle
}: {
  candidates: MiningCandidate[]
  resolved?: Record<string, ResolvedEntry>
  selected?: Record<string, boolean>
  statuses?: Record<string, MiningWordStatus>
  onToggle?: (lemma: string) => void
}): React.JSX.Element {
  const showStatuses = statuses !== undefined
  return (
    <div className="bulk-mining-table-wrap">
      <table className="bulk-mining-table">
        <thead>
          <tr>
            <th>{showStatuses ? 'Status' : 'Mine'}</th>
            <th>Word</th>
            <th>Lemma</th>
            <th>Count</th>
            <th>Frequency</th>
          </tr>
        </thead>
        <tbody>
          {candidates.map((candidate) => {
            const result = resolved[candidate.lemma]
            const noEntry = result?.entry === null
            return (
              <tr key={candidate.lemma} data-no-entry={noEntry || undefined}>
                <td>
                  {showStatuses ? (
                    <StatusMarker status={statuses[candidate.lemma]} />
                  ) : (
                    <input
                      type="checkbox"
                      aria-label={`Mine ${candidate.lemma}`}
                      checked={selected[candidate.lemma] ?? false}
                      disabled={noEntry}
                      onChange={() => onToggle?.(candidate.lemma)}
                    />
                  )}
                </td>
                <td>{candidate.token.surface}</td>
                <td>{candidate.token.surface === candidate.lemma ? '' : candidate.lemma}</td>
                <td>{candidate.count}</td>
                <td>
                  <FrequencyCell resolved={result} />
                  {noEntry && <span className="bulk-mining-no-entry"> no entry</span>}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {showStatuses &&
        candidates.map((candidate) => {
          const status = statuses[candidate.lemma]
          return status?.kind === 'error' ? (
            <p className="bulk-mining-word-error" key={`${candidate.lemma}-error`}>
              {candidate.token.surface}: {status.message}
            </p>
          ) : null
        })}
    </div>
  )
}

function Summary({
  phase
}: {
  phase: Extract<BulkMiningPhase, { kind: 'done' }>
}): React.JSX.Element {
  const buckets: [keyof typeof phase.summary, string][] = [
    ['added', 'added'],
    ['updated', 'updated'],
    ['duplicate', 'duplicates'],
    ['noEntry', 'no entry'],
    ['error', 'errors'],
    ['cancelled', 'cancelled']
  ]
  return (
    <p className="bulk-mining-summary">
      {buckets
        .filter(([key]) => phase.summary[key] > 0)
        .map(([key, label]) => `${phase.summary[key]} ${label}`)
        .join(' · ')}
    </p>
  )
}

export default function BulkMining(props: BulkMiningProps): React.JSX.Element | null {
  const { phase } = props
  if (phase.kind === 'idle') return null

  if (phase.kind === 'preparing') {
    return (
      <section className="bulk-mining" aria-label="Bulk Anki mining">
        <p role="status">Preparing words to mine&hellip;</p>
        <footer className="bulk-mining-footer">
          <button type="button" onClick={props.onClose}>
            Close
          </button>
        </footer>
      </section>
    )
  }

  if (phase.kind === 'unavailable') {
    return (
      <section className="bulk-mining" aria-label="Bulk Anki mining">
        <p role="status">No Japanese subtitle vocabulary is available.</p>
      </section>
    )
  }

  if (phase.kind === 'error') {
    return (
      <section className="bulk-mining" aria-label="Bulk Anki mining">
        <p role="alert">{phase.message}</p>
        <footer className="bulk-mining-footer">
          <button type="button" onClick={props.onClose}>
            Close
          </button>
          <button type="button" onClick={props.onRetry}>
            Retry
          </button>
        </footer>
      </section>
    )
  }

  if (phase.kind === 'ready') {
    const filters: BulkMiningFilters = {
      maximumFrequency: phase.threshold,
      minimumCount: phase.minimumCount,
      frequencyDictConfigured: props.frequencyDictConfigured,
      targetDeckMatches: phase.targetDeckMatches,
      hideTargetDeckMatches: phase.hideTargetDeckMatches
    }
    const displayed = displayedCandidates(phase.candidates, phase.resolved, filters, phase.sort)
    const mineCount = miningSet(phase.candidates, phase.resolved, phase.selected, filters).length
    const hiddenTargetDeckCount = hiddenTargetDeckMatchCount(
      phase.candidates,
      phase.resolved,
      filters
    )
    const hiddenNoDataCount =
      props.frequencyDictConfigured && phase.threshold !== null
        ? phase.candidates.filter(
            (candidate) => phase.resolved[candidate.lemma]?.frequency === null
          ).length
        : 0
    return (
      <section className="bulk-mining" aria-label="Bulk Anki mining">
        <div className="bulk-mining-controls">
          <label htmlFor="bulk-mining-threshold">Maximum frequency</label>
          <input
            id="bulk-mining-threshold"
            type="text"
            inputMode="numeric"
            value={phase.threshold ?? ''}
            disabled={!props.frequencyDictConfigured}
            onChange={(event) => props.onThresholdChange(event.target.value)}
          />
          <label htmlFor="bulk-mining-minimum-count">Minimum count</label>
          <input
            id="bulk-mining-minimum-count"
            type="text"
            inputMode="numeric"
            value={phase.minimumCount ?? ''}
            onChange={(event) => props.onMinimumCountChange(event.target.value)}
          />
          <label htmlFor="bulk-mining-sort">Sort unknown words</label>
          <select
            id="bulk-mining-sort"
            value={phase.sort}
            onChange={(event) => props.onSortChange(event.target.value as BulkMiningSort)}
          >
            <option value="count">Count</option>
            <option value="frequency" disabled={!props.frequencyDictConfigured}>
              Frequency
            </option>
          </select>
          {!props.frequencyDictConfigured && (
            <span className="bulk-mining-hint">
              Choose a frequency dictionary in Options to filter by frequency.
            </span>
          )}
          {hiddenNoDataCount > 0 && (
            <span className="bulk-mining-hint">
              {hiddenNoDataCount} words without frequency data are hidden.
            </span>
          )}
          <label className="bulk-mining-target-filter">
            <input
              type="checkbox"
              checked={phase.hideTargetDeckMatches}
              onChange={(event) => props.onSetHideTargetDeckMatches(event.target.checked)}
            />
            Hide words already in target deck
          </label>
          {phase.checkingTargetDeck && (
            <span className="bulk-mining-hint" role="status">
              Checking target deck&hellip;
            </span>
          )}
          {hiddenTargetDeckCount > 0 && (
            <span className="bulk-mining-hint">
              {hiddenTargetDeckCount} already in {props.targetDeckName ?? 'target deck'} hidden
            </span>
          )}
          <div className="bulk-mining-selection-actions">
            <button type="button" onClick={props.onSelectAll}>
              Select all
            </button>
            <button type="button" onClick={props.onSelectNone}>
              Select none
            </button>
          </div>
        </div>
        {phase.advisoryWarning && (
          <p className="bulk-mining-advisory" role="status">
            {phase.advisoryWarning}
          </p>
        )}
        {phase.resolving && (
          <p className="bulk-mining-resolving" role="status">
            Resolving frequencies&hellip; please wait before mining.
          </p>
        )}
        {displayed.length === 0 ? (
          <p className="bulk-mining-hint" role="status">
            No words match the current filters.
          </p>
        ) : (
          <CandidateTable
            candidates={displayed}
            resolved={phase.resolved}
            selected={phase.selected}
            onToggle={props.onToggle}
          />
        )}
        <footer className="bulk-mining-footer">
          <button
            type="button"
            id="bulk-mining-start"
            disabled={mineCount === 0 || phase.resolving}
            title={
              phase.resolving ? 'Preparing words—please wait until resolution finishes.' : undefined
            }
            onClick={props.onStart}
          >
            Mine {mineCount} words
          </button>
        </footer>
      </section>
    )
  }

  if (phase.kind === 'running') {
    const terminal = Object.values(phase.statuses).filter(
      (status) => !['queued', 'mining'].includes(status.kind)
    ).length
    return (
      <section className="bulk-mining" aria-label="Bulk Anki mining">
        <p className="bulk-mining-progress">
          Mined {terminal} of {phase.candidates.length}
        </p>
        <CandidateTable candidates={phase.candidates} statuses={phase.statuses} />
        <footer className="bulk-mining-footer">
          <button
            type="button"
            id="bulk-mining-cancel"
            disabled={phase.cancelling}
            onClick={props.onCancel}
          >
            {phase.cancelling ? 'Cancelling\u2026' : 'Cancel'}
          </button>
        </footer>
      </section>
    )
  }

  return (
    <section className="bulk-mining" aria-label="Bulk Anki mining">
      {phase.abortMessage && (
        <p className="bulk-mining-abort" role="alert">
          {phase.abortMessage}
        </p>
      )}
      <CandidateTable candidates={phase.candidates} statuses={phase.statuses} />
      <Summary phase={phase} />
      <footer className="bulk-mining-footer">
        <button type="button" id="bulk-mining-back" onClick={props.onBackToList}>
          Back to word list
        </button>
      </footer>
    </section>
  )
}
