import type { BulkMiningPhase } from './bulkMiningController'

export type BulkMiningDialogCloseSource = 'escape' | 'backdrop' | 'panel'

/** Routes modal close gestures; only Escape discards the visible mining session. */
export function bulkMiningDialogCloseAction(
  source: BulkMiningDialogCloseSource,
  phase: BulkMiningPhase
): 'discard' | 'none' {
  if (source === 'panel' || source === 'backdrop') return 'none'
  switch (phase.kind) {
    case 'idle':
    case 'preparing':
    case 'unavailable':
    case 'error':
    case 'ready':
    case 'done':
      return 'discard'
    case 'running':
      return phase.cancelling ? 'discard' : 'discard'
  }
}
