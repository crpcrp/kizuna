import { useEffect, useState, useSyncExternalStore } from 'react'
import type { JimakuEntry } from '../../../shared/jimaku'
import { createJimakuCore } from './jimaku/core'
import { createJimakuPrepare } from './jimaku/prepare'
import { createJimakuRemembered } from './jimaku/remembered'
import { createJimakuSearch } from './jimaku/search'
import type {
  JimakuController,
  JimakuControllerDeps,
  JimakuEpisodeEdit,
  JimakuIdentityPatch,
  UseJimakuControllerResult
} from './jimaku/types'
import { useLatestCallback, useLatestRef } from './useLatestRef'

export type * from './jimaku/types'

type ControllerDepsSource = JimakuControllerDeps | (() => JimakuControllerDeps)

export function createJimakuController(deps: JimakuControllerDeps): JimakuController
export function createJimakuController(deps: () => JimakuControllerDeps): JimakuController
export function createJimakuController(source: ControllerDepsSource): JimakuController {
  const core = createJimakuCore(typeof source === 'function' ? source : () => source)
  const { cancelPending, set } = core
  return {
    getState: () => core.state,
    subscribe: core.subscribe,
    ...createJimakuSearch(core),
    ...createJimakuPrepare(core),
    ...createJimakuRemembered(core),
    cancelOperation(): void {
      if (
        core.state.phase.kind !== 'searchingTitles' &&
        core.state.phase.kind !== 'loadingFiles' &&
        core.state.phase.kind !== 'downloading' &&
        core.state.phase.kind !== 'applying'
      )
        return
      cancelPending()
      ++core.operationId
      const restore = core.cancelState
      core.cancelState = undefined
      if (restore) set({ ...restore, notice: undefined })
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

  return {
    ...state,
    controller,
    open: useLatestCallback(() => controller.open()),
    rememberTitle: useLatestCallback((remember: boolean) => controller.rememberTitle(remember)),
    clearRememberedTitle: useLatestCallback(() => controller.clearRememberedTitle()),
    changeTitle: useLatestCallback(() => controller.changeTitle()),
    editIdentity: useLatestCallback((patch: JimakuIdentityPatch) => controller.editIdentity(patch)),
    editEpisode: useLatestCallback((value: JimakuEpisodeEdit) => controller.editEpisode(value)),
    search: useLatestCallback(() => controller.search()),
    chooseTitle: useLatestCallback((entry: number | JimakuEntry) => controller.chooseTitle(entry)),
    showMoreFiles: useLatestCallback(() => controller.showMoreFiles()),
    showAllFiles: useLatestCallback(() => controller.showAllFiles()),
    chooseFile: useLatestCallback((candidateId: string) => controller.chooseFile(candidateId)),
    chooseMember: useLatestCallback((memberId: string) => controller.chooseMember(memberId)),
    cancelOperation: useLatestCallback(() => controller.cancelOperation()),
    close: useLatestCallback(() => controller.close()),
    tryAnother: useLatestCallback(() => controller.tryAnother()),
    revert: useLatestCallback(() => controller.revert()),
    refresh: useLatestCallback(() => controller.refresh()),
    openSourcePage: useLatestCallback((entryId?: number) => controller.openSourcePage(entryId))
  }
}
