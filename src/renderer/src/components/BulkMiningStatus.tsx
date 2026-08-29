import './BulkMiningStatus.css'
import type { MiningSummary, MiningWordStatus } from '../state/bulkMining'

export function BulkMiningStatusMarker({
  status
}: {
  status: MiningWordStatus | undefined
}): React.JSX.Element {
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

export function BulkMiningSummary({ summary }: { summary: MiningSummary }): React.JSX.Element {
  const buckets: [keyof MiningSummary, string][] = [
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
        .filter(([key]) => summary[key] > 0)
        .map(([key, label]) => `${summary[key]} ${label}`)
        .join(' · ')}
    </p>
  )
}
