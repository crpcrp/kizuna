import { useEffect, useState, useSyncExternalStore } from 'react'
import type { KnowledgeSource, SyncStatus } from '../../../shared/knowledge'
import type { PopupSortOrder } from '../../../shared/playerSettings'
import type { KizunaApi } from '../../../shared/preloadApi'
import type { JlptLevel } from '../../../shared/jlpt'
import { type JlptExportMode } from '../../../shared/jlptExport'
import type { BulkMiningPhase } from './bulkMiningController'
import {
  createJlptBulkExportController,
  type JlptBulkExportController,
  type JlptBulkExportState
} from './jlptBulkExportController'
import { useLatestCallback } from './useLatestRef'

export interface UseJlptBulkExportInput {
  bridge: Pick<KizunaApi, 'dict' | 'anki' | 'knowledge'>
  frequencyDictId: number | null
  sortOrder: PopupSortOrder
  /** Rebuilds local knowledge after successful Anki additions or updates. */
  syncNow(source: KnowledgeSource, force?: boolean): Promise<SyncStatus>
}

export interface JlptBulkExportViewModel {
  open: boolean
  presentation: 'closed' | 'open'
  throughLevel: JlptLevel
  mode: JlptExportMode
  phase: BulkMiningPhase
  frequencyDictConfigured: boolean
  onClose(): void
  onRetry(): void
  onThroughLevelChange(level: JlptLevel): void
  onModeChange(mode: JlptExportMode): void
  onToggle(lemma: string): void
  onSelectAll(): void
  onSelectNone(): void
  onStart(): void
  onCancel(): void
  onBackToList(): void
}

export interface UseJlptBulkExportResult extends JlptBulkExportViewModel {
  /** Opens the list immediately in the preparing phase. */
  openExport(options?: { throughLevel?: JlptLevel }): void
}

/** Connects JLPT list loading and the shared bulk miner to the renderer bridge. */
export function useJlptBulkExport({
  bridge,
  frequencyDictId,
  sortOrder,
  syncNow
}: UseJlptBulkExportInput): UseJlptBulkExportResult {
  const getSource = useLatestCallback(() => ({
    bridge,
    frequencyDictId,
    sortOrder
  }))
  const refreshKnowledge = useLatestCallback(() => syncNow('anki', true))
  const [controller] = useState<JlptBulkExportController>(() =>
    createJlptBulkExportController({
      getSource,
      refreshKnowledge
    })
  )
  const state = useSyncExternalStore(
    controller.subscribe,
    () => controller.getState(),
    () => controller.getState()
  )

  useEffect(() => () => controller.close(), [controller])

  const openExport = useLatestCallback((options?: { throughLevel?: JlptLevel }): void => {
    controller.open(options)
  })
  const close = useLatestCallback(() => controller.close())
  const retry = useLatestCallback(() => controller.retry())
  const setThroughLevel = useLatestCallback((level: JlptLevel) => controller.setThroughLevel(level))
  const setMode = useLatestCallback((mode: JlptExportMode) => controller.setMode(mode))
  const toggle = useLatestCallback((lemma: string) => controller.toggle(lemma))
  const selectAll = useLatestCallback(() => controller.selectAll())
  const selectNone = useLatestCallback(() => controller.selectNone())
  const start = useLatestCallback(() => controller.start())
  const cancel = useLatestCallback(() => controller.cancel())
  const backToList = useLatestCallback(() => controller.backToList())

  return {
    ...viewModel(state, frequencyDictId),
    onClose: close,
    onRetry: retry,
    onThroughLevelChange: setThroughLevel,
    onModeChange: setMode,
    onToggle: toggle,
    onSelectAll: selectAll,
    onSelectNone: selectNone,
    onStart: start,
    onCancel: cancel,
    onBackToList: backToList,
    openExport
  }
}

function viewModel(
  state: JlptBulkExportState,
  frequencyDictId: number | null
): Pick<
  JlptBulkExportViewModel,
  'open' | 'presentation' | 'throughLevel' | 'mode' | 'phase' | 'frequencyDictConfigured'
> {
  return {
    open: state.open,
    presentation: state.open ? 'open' : 'closed',
    throughLevel: state.throughLevel,
    mode: state.mode,
    phase: state.phase,
    frequencyDictConfigured: frequencyDictId !== null
  }
}
