import { useEffect, useState, useSyncExternalStore } from 'react'
import type { KizunaApi } from '../../../shared/preloadApi'
import {
  createJlptCoverageController,
  type JlptCoverageController,
  type JlptCoverageState
} from './jlptCoverageController'
import { useLatestCallback } from './useLatestRef'

export interface UseJlptCoverageReportInput {
  bridge: Pick<KizunaApi, 'knowledge'>
}

export interface UseJlptCoverageReportResult extends JlptCoverageState {
  controller: JlptCoverageController
  openReport(): void
  closeReport(): void
  retry(): void
  setSelectedLevel(level: JlptCoverageState['selectedLevel']): void
}

/** Connects the independent JLPT coverage controller to the typed preload API. */
export function useJlptCoverageReport({
  bridge
}: UseJlptCoverageReportInput): UseJlptCoverageReportResult {
  const [controller] = useState(() =>
    createJlptCoverageController({
      loadReport: () => bridge.knowledge.jlptCoverageReport()
    })
  )
  const state = useSyncExternalStore(
    controller.subscribe,
    () => controller.getState(),
    () => controller.getState()
  )

  const openReport = useLatestCallback(() => controller.openReport())
  const closeReport = useLatestCallback(() => controller.closeReport())
  const retry = useLatestCallback(() => controller.retry())
  const setSelectedLevel = useLatestCallback((level: JlptCoverageState['selectedLevel']) =>
    controller.setSelectedLevel(level)
  )

  useEffect(() => () => controller.closeReport(), [controller])

  return { ...state, controller, openReport, closeReport, retry, setSelectedLevel }
}
