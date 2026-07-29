import type { MiningSummary } from './bulkMining'
import type { BulkMiningPhase } from './bulkMiningController'

export interface BulkMiningCompletionEvent {
  runId: number
  text: string
  shouldPause: boolean
  shouldRefreshKnowledge: boolean
}

export interface BulkMiningCompletionTracker {
  observe(phase: BulkMiningPhase): BulkMiningCompletionEvent | null
  getCurrent(): BulkMiningCompletionEvent | null
  reset(): void
}

function summaryText(summary: MiningSummary): string {
  const parts: Array<[keyof MiningSummary, string]> = [
    ['added', 'added'],
    ['updated', 'updated'],
    ['duplicate', 'duplicates'],
    ['noEntry', 'with no entry'],
    ['error', 'errors'],
    ['cancelled', 'cancelled']
  ]
  const detail = parts
    .filter(([key]) => summary[key] > 0)
    .map(([key, label]) => `${summary[key]} ${label}`)
    .join(' · ')
  return detail.length > 0 ? `Mining complete: ${detail}.` : 'Mining complete.'
}

/**
 * Converts controller phase transitions into one stable completion event per
 * run. Presentation changes deliberately never reach this coordinator.
 */
export function createBulkMiningCompletionTracker(): BulkMiningCompletionTracker {
  let previousKind: BulkMiningPhase['kind'] = 'idle'
  let activeRunId = 0
  let emittedRunId: number | null = null
  let current: BulkMiningCompletionEvent | null = null

  return {
    observe(phase): BulkMiningCompletionEvent | null {
      if (phase.kind === 'running' && previousKind !== 'running') {
        activeRunId++
        current = null
      }

      let event: BulkMiningCompletionEvent | null = null
      if (phase.kind === 'done' && previousKind === 'running' && emittedRunId !== activeRunId) {
        event = phase.abortMessage
          ? {
              runId: activeRunId,
              text: phase.abortMessage,
              shouldPause: false,
              shouldRefreshKnowledge: false
            }
          : {
              runId: activeRunId,
              text: summaryText(phase.summary),
              shouldPause: true,
              shouldRefreshKnowledge: phase.summary.added + phase.summary.updated > 0
            }
        emittedRunId = activeRunId
        current = event
      }

      previousKind = phase.kind
      return event
    },
    getCurrent: () => current,
    reset(): void {
      previousKind = 'idle'
      current = null
      emittedRunId = null
    }
  }
}
