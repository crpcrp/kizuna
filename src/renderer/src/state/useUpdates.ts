import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import type { KizunaApi } from '../../../shared/preloadApi'
import type { UpdateSettings, UpdateState } from '../../../shared/update'
import {
  initialUpdateWorkflowState,
  updateModal,
  updateStatusText,
  updateWorkflowReducer
} from './updateController'

export type UpdatesBridge = Pick<KizunaApi, 'updates'>

export function useUpdates(bridge: UpdatesBridge): {
  snapshot: UpdateState
  modal: ReturnType<typeof updateModal>
  statusText: string | null
  settings: UpdateSettings
  setCheckAutomatically(value: boolean): void
  dismissAvailable(): void
  deferInstall(): void
  download(): void
  install(): void
  retry(): void
  checkManually(): void
} {
  const [workflow, dispatch] = useReducer(updateWorkflowReducer, initialUpdateWorkflowState)
  const [settings, setSettings] = useState<UpdateSettings>({ checkAutomatically: true })
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [snapshotLoaded, setSnapshotLoaded] = useState(false)
  const automaticRequested = useRef(false)

  useEffect(() => {
    let active = true
    let pushed = false
    const unsubscribe = bridge.updates.onStateChange((snapshot) => {
      pushed = true
      if (active) dispatch({ type: 'snapshot', snapshot })
    })
    void bridge.updates.getState().then(
      (snapshot) => {
        if (!active) return
        if (!pushed) dispatch({ type: 'snapshot', snapshot })
        setSnapshotLoaded(true)
      },
      () => undefined
    )
    void bridge.updates.getSettings().then(
      (value) => {
        if (!active) return
        setSettings(value)
        setSettingsLoaded(true)
      },
      () => undefined
    )
    return () => {
      active = false
      unsubscribe()
    }
  }, [bridge.updates])

  useEffect(() => {
    if (!settingsLoaded || !snapshotLoaded || automaticRequested.current) return
    automaticRequested.current = true
    if (
      settings.checkAutomatically &&
      workflow.snapshot.status === 'idle' &&
      navigator.onLine !== false
    ) {
      void bridge.updates
        .check('automatic')
        .then((snapshot) => dispatch({ type: 'snapshot', snapshot }))
    }
  }, [
    bridge.updates,
    settings.checkAutomatically,
    settingsLoaded,
    snapshotLoaded,
    workflow.snapshot.status
  ])

  const setCheckAutomatically = useCallback(
    (value: boolean): void => {
      setSettings({ checkAutomatically: value })
      void bridge.updates
        .setSettings({ checkAutomatically: value })
        .then(setSettings, () => setSettings({ checkAutomatically: !value }))
    },
    [bridge.updates]
  )

  const invoke = useCallback((request: () => Promise<UpdateState>): void => {
    void request().then((snapshot) => dispatch({ type: 'snapshot', snapshot }))
  }, [])

  return {
    snapshot: workflow.snapshot,
    modal: updateModal(workflow),
    statusText: updateStatusText(workflow),
    settings,
    setCheckAutomatically,
    dismissAvailable: () => {
      if (workflow.snapshot.status === 'available')
        dispatch({ type: 'dismissAvailable', version: workflow.snapshot.version })
    },
    deferInstall: () => {
      if (workflow.snapshot.status === 'downloaded')
        dispatch({ type: 'deferDownloaded', version: workflow.snapshot.version })
    },
    download: () => invoke(() => bridge.updates.download()),
    install: () => void bridge.updates.install(),
    retry: () => {
      const snapshot = workflow.snapshot
      if (snapshot.status !== 'error') return
      if (snapshot.stage === 'check') invoke(() => bridge.updates.check('manual'))
      else if (snapshot.stage === 'download') invoke(() => bridge.updates.download())
      else void bridge.updates.install()
    },
    checkManually: () => invoke(() => bridge.updates.check('manual'))
  }
}
