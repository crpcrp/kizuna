import type { BulkMiningPhase } from './bulkMiningController'

/** Surface visibility is deliberately separate from the mining controller lifecycle. */
export type BulkMiningPresentation = 'closed' | 'modal' | 'sidebar'

/** Hides an active modal without changing its controller session or phase. */
export function hideBulkMiningToSidebar(
  presentation: BulkMiningPresentation,
  phase: BulkMiningPhase
): BulkMiningPresentation {
  return presentation === 'modal' && phase.kind === 'running' ? 'sidebar' : presentation
}

/** Restores a hidden mining surface without opening or resetting its controller. */
export function reopenBulkMiningModal(
  presentation: BulkMiningPresentation
): BulkMiningPresentation {
  return presentation === 'sidebar' ? 'modal' : presentation
}
