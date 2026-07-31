import { useState, useSyncExternalStore } from 'react'
import type { KizunaApi } from '../../../shared/preloadApi'
import {
  createSubtitleReportController,
  type SubtitleReportController,
  type SubtitleReportPhase,
  type WholeTrackSnapshotSource
} from './subtitleReportController'
import { useLatestCallback } from './useLatestRef'

export interface UseSubtitleReportInput {
  /** Knowledge levels and sync status, the only bridge the report reads. */
  bridge: Pick<KizunaApi, 'knowledge'>
}

export interface UseSubtitleReportResult {
  /** The raw "user asked for the report" flag. The composition hook gates it
   * on bulk mining's presentation before handing it to the modal; the
   * vocabulary caches use it unhandled, since it is what gates whole-track
   * work. */
  open: boolean
  phase: SubtitleReportPhase
  /** Passed to `useVocabularyCaches`: the pipeline writes report
   * recomputation through it while the modal is open. */
  controller: SubtitleReportController
  requestOpen(): void
  /** Clears the flag *and* closes the controller — every call site does both. */
  close(): void
  /** Recomputes from a freshly prepared whole-track snapshot. Taken as an
   * argument rather than captured at declaration, so this hook can be declared
   * before the caches that produce the snapshot. */
  retry(snapshot: WholeTrackSnapshotSource): void
}

/**
 * Owns the subtitle report's open flag and its controller: when the modal is
 * showing, which phase it is in, and the retry that recomputes it. Holds no
 * cache of its own — the report is derived from the whole-track vocabulary
 * snapshot `useVocabularyCaches` prepares.
 */
export function useSubtitleReport({ bridge }: UseSubtitleReportInput): UseSubtitleReportResult {
  // Subtitle report orchestration — see state/subtitleReportController.ts.
  const [controller] = useState(createSubtitleReportController)
  const phase = useSyncExternalStore(
    controller.subscribe,
    () => controller.getState(),
    () => controller.getState()
  )
  const [open, setOpen] = useState(false)

  const requestOpen = useLatestCallback((): void => {
    setOpen(true)
  })
  const close = useLatestCallback((): void => {
    setOpen(false)
    controller.close()
  })
  const retry = useLatestCallback((snapshot: WholeTrackSnapshotSource): void => {
    void controller.open({
      bridges: { knowledge: bridge.knowledge },
      snapshot
    })
  })

  return { open, phase, controller, requestOpen, close, retry }
}
