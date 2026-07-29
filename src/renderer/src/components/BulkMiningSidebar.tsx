import './BulkMiningSidebar.css'
import type { MiningWordStatus } from '../state/bulkMining'
import type { BulkMiningPhase } from '../state/bulkMiningController'

export interface BulkMiningSidebarProps {
  phase: BulkMiningPhase
  onReopen: () => void
  onCancel: () => void
}

function isTerminal(status: MiningWordStatus | undefined): boolean {
  return status !== undefined && status.kind !== 'queued' && status.kind !== 'mining'
}

function statusLabel(status: MiningWordStatus | undefined): string {
  switch (status?.kind) {
    case 'mining':
      return 'Mining'
    case 'added':
      return 'Added'
    case 'duplicate':
      return 'Duplicate'
    case 'noEntry':
      return 'No entry'
    case 'error':
      return 'Error'
    case 'cancelled':
      return 'Cancelled'
    default:
      return 'Queued'
  }
}

function currentCandidate(phase: Extract<BulkMiningPhase, { kind: 'running' | 'done' }>): {
  surface: string
  status: MiningWordStatus | undefined
  label: string
} {
  const active = phase.candidates.find(
    (candidate) => phase.statuses[candidate.lemma]?.kind === 'mining'
  )
  if (active)
    return { surface: active.token.surface, status: phase.statuses[active.lemma], label: 'Current' }

  const queued = phase.candidates.find(
    (candidate) => phase.statuses[candidate.lemma]?.kind === 'queued'
  )
  if (queued)
    return { surface: queued.token.surface, status: phase.statuses[queued.lemma], label: 'Next' }

  const last = [...phase.candidates]
    .reverse()
    .find((candidate) => isTerminal(phase.statuses[candidate.lemma]))
  if (last)
    return { surface: last.token.surface, status: phase.statuses[last.lemma], label: 'Last' }

  return { surface: 'No words', status: undefined, label: 'Current' }
}

/** Compact, non-destructive surface for an active or completed mining session. */
export default function BulkMiningSidebar({
  phase,
  onReopen,
  onCancel
}: BulkMiningSidebarProps): React.JSX.Element | null {
  if (phase.kind !== 'running' && phase.kind !== 'done') return null

  const completed = phase.candidates.filter((candidate) =>
    isTerminal(phase.statuses[candidate.lemma])
  ).length
  const current = currentCandidate(phase)
  const status =
    phase.kind === 'running' && phase.cancelling ? 'Cancelling…' : statusLabel(current.status)

  return (
    <aside id="bulk-mining-sidebar" aria-label="Bulk mining progress" data-phase={phase.kind}>
      <p className="bulk-mining-sidebar-progress">
        Mined {completed} of {phase.candidates.length}
      </p>
      <p className="bulk-mining-sidebar-current">
        <span>
          {current.label}: {current.surface}
        </span>
        <span data-status={phase.kind === 'done' ? 'done' : (current.status?.kind ?? 'queued')}>
          {phase.kind === 'done' ? 'Complete' : status}
        </span>
      </p>
      <div className="bulk-mining-sidebar-actions">
        <button type="button" onClick={onReopen}>
          Reopen
        </button>
        {phase.kind === 'running' && (
          <button type="button" onClick={onCancel} disabled={phase.cancelling}>
            {phase.cancelling ? 'Cancelling…' : 'Cancel'}
          </button>
        )}
      </div>
    </aside>
  )
}
