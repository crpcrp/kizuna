import { useEffect, useState, useSyncExternalStore } from 'react'
import { createJimakuCore, isBusy } from './jimaku/core'
import { createJimakuPrepare } from './jimaku/prepare'
import { createJimakuSearch } from './jimaku/search'
import type {
  JimakuController,
  JimakuControllerDeps,
  UseJimakuControllerResult
} from './jimaku/types'
import { useLatestRef } from './useLatestRef'

export type * from './jimaku/types'

type ControllerDepsSource = JimakuControllerDeps | (() => JimakuControllerDeps)

export function createJimakuController(deps: JimakuControllerDeps): JimakuController
export function createJimakuController(deps: () => JimakuControllerDeps): JimakuController
export function createJimakuController(source: ControllerDepsSource): JimakuController {
  const core = createJimakuCore(typeof source === 'function' ? source : () => source)
  return {
    getState: () => core.state,
    subscribe: core.subscribe,
    ...createJimakuSearch(core),
    ...createJimakuPrepare(core),
    cancelOperation(): void {
      if (!isBusy(core.state.phase)) return
      core.cancelPending()
      ++core.operationId
      core.restoreCancelState()
    },
    close: core.reset,
    syncMedia(): void {
      if (core.state.phase.kind === 'idle') return
      const current = core.media()
      if (
        current.filePath !== core.state.mediaPath ||
        current.loadGeneration !== core.state.mediaGeneration
      )
        core.reset()
    }
  }
}

/** React adapter for the independent renderer controller. */
export function useJimakuController(input: JimakuControllerDeps): UseJimakuControllerResult {
  const inputRef = useLatestRef(input)
  // The getter is only evaluated by controller actions/effects after mount;
  // the initializer stores it without reading the ref during render.
  // eslint-disable-next-line react-hooks/refs -- see the comment above.
  const [controller] = useState(() => createJimakuController(() => inputRef.current))
  const state = useSyncExternalStore(
    controller.subscribe,
    () => controller.getState(),
    () => controller.getState()
  )
  const currentMedia = input.getMedia()

  useEffect(() => {
    controller.syncMedia()
  }, [controller, currentMedia.filePath, currentMedia.loadGeneration])
  useEffect(() => () => controller.close(), [controller])

  // Controller methods close over the controller, so they are already stable.
  const {
    getState: _getState,
    subscribe: _subscribe,
    syncMedia: _syncMedia,
    ...actions
  } = controller
  return { ...state, ...actions, controller }
}
