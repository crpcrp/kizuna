// Shared mutable controller state and operation bookkeeping.
import type { StoredSubtitleSelection } from '../../../../shared/mediaHistory'
import type { SubtitleSelectionSnapshot } from '../trackSelection'
import type {
  JimakuControllerDeps,
  JimakuControllerErrorCode,
  JimakuControllerPhase,
  JimakuControllerState,
  JimakuMediaContext,
  JimakuRecoveryTarget
} from './types'

export const INITIAL_STATE: JimakuControllerState = {
  phase: { kind: 'idle' },
  category: 'all',
  entries: [],
  shownEntries: [],
  rememberedTitle: undefined,
  files: [],
  shownFiles: [],
  showingMoreFiles: false,
  showingAllFiles: false,
  triedVersionIds: [],
  appliedVersionByItem: {},
  canRevert: false,
  partial: false,
  failedCategories: []
}

export type Operation = {
  id: number
  filePath: string
  loadGeneration: number
  sessionId?: string
}

export interface JimakuCore {
  state: JimakuControllerState
  operationId: number
  sessionId?: string
  previousSelection?: SubtitleSelectionSnapshot
  knownVersionIds: Set<string>
  /** State restored when the in-flight operation is cancelled. */
  cancelState?: JimakuControllerState
  getDeps(): JimakuControllerDeps
  subscribe(listener: () => void): () => void
  set(next: JimakuControllerState): void
  media(): JimakuMediaContext
  contextMatches(path: string, generation: number): boolean
  operationMatches(operation: Operation): boolean
  clearSession(): void
  cancelPending(): void
  startOperation(
    nextPhase: JimakuControllerPhase,
    restore: JimakuControllerState
  ): Operation | undefined
  finishOperation(operation: Operation): void
  fail(
    code: JimakuControllerErrorCode,
    recovery: JimakuRecoveryTarget,
    base?: JimakuControllerState
  ): void
  serviceError(value: unknown): JimakuControllerErrorCode
  triedVersions(currentVersionId: string | undefined): string[]
  resetTitleChoice(): void
  /** Invalidates pending work, ends the session, and returns to the idle state. */
  reset(): void
}

export const versionOf = (selection: StoredSubtitleSelection): string | undefined =>
  selection.mode === 'external' ? selection.provenance?.contentVersion : undefined

export function createJimakuCore(getDeps: () => JimakuControllerDeps): JimakuCore {
  const listeners = new Set<() => void>()

  const set = (next: JimakuControllerState): void => {
    core.state = next
    listeners.forEach((listener) => listener())
  }

  const media = (): JimakuMediaContext => getDeps().getMedia()

  const contextMatches = (path: string, generation: number): boolean => {
    const current = media()
    return current.filePath === path && current.loadGeneration === generation
  }

  const operationMatches = (operation: Operation): boolean =>
    core.operationId === operation.id &&
    core.state.phase.kind !== 'idle' &&
    core.state.mediaPath === operation.filePath &&
    core.state.mediaGeneration === operation.loadGeneration &&
    contextMatches(operation.filePath, operation.loadGeneration) &&
    (operation.sessionId === undefined || core.sessionId === operation.sessionId)

  const clearSession = (): void => {
    const oldSession = core.sessionId
    core.sessionId = undefined
    if (oldSession) {
      try {
        void Promise.resolve(getDeps().jimaku.endSession(oldSession)).catch(() => undefined)
      } catch {
        // A teardown request must never prevent the renderer state reset.
      }
    }
  }

  const cancelPending = (): void => {
    if (!core.sessionId) return
    try {
      void Promise.resolve(getDeps().jimaku.cancelPending(core.sessionId)).catch(() => undefined)
    } catch {
      // Cancellation is best effort; the operation id still invalidates local work.
    }
  }

  const startOperation = (
    nextPhase: JimakuControllerPhase,
    restore: JimakuControllerState
  ): Operation | undefined => {
    const current = media()
    if (
      !current.filePath ||
      core.state.mediaPath !== current.filePath ||
      core.state.mediaGeneration !== current.loadGeneration
    )
      return undefined
    if (
      core.state.phase.kind === 'searchingTitles' ||
      core.state.phase.kind === 'loadingFiles' ||
      core.state.phase.kind === 'downloading' ||
      core.state.phase.kind === 'applying'
    )
      cancelPending()
    const operation: Operation = {
      id: ++core.operationId,
      filePath: current.filePath,
      loadGeneration: current.loadGeneration,
      sessionId: core.sessionId
    }
    core.cancelState = restore
    set({ ...core.state, phase: nextPhase, notice: undefined })
    return operation
  }

  const finishOperation = (operation: Operation): void => {
    if (operationMatches(operation)) core.cancelState = undefined
  }

  const fail = (
    code: JimakuControllerErrorCode,
    recovery: JimakuRecoveryTarget,
    base: JimakuControllerState = core.state
  ): void => {
    core.cancelState = undefined
    set({ ...base, phase: { kind: 'error', code, recovery }, notice: undefined })
  }

  const serviceError = (value: unknown): JimakuControllerErrorCode => {
    if (
      typeof value === 'string' &&
      [
        'cancelled',
        'timeout',
        'network',
        'unauthorized',
        'notFound',
        'rateLimited',
        'serviceUnavailable',
        'invalidResponse',
        'notConfigured',
        'invalidRequest',
        'invalidSession',
        'staleMedia',
        'invalidEntry',
        'invalidCandidate',
        'invalidPackage',
        'invalidMember',
        'expired',
        'openExternalFailed',
        'storage',
        'tooLarge',
        'invalidSubtitle',
        'unsupportedDownload',
        'unsupportedArchive',
        'invalidArchive'
      ].includes(value)
    ) {
      return value as JimakuControllerErrorCode
    }
    return 'network'
  }

  const triedVersions = (currentVersionId: string | undefined): string[] =>
    [...core.knownVersionIds].filter((version) => version !== currentVersionId)

  const resetTitleChoice = (): void => {
    cancelPending()
    ++core.operationId
    core.cancelState = undefined
    set({
      ...core.state,
      phase: { kind: 'choosingTitle' },
      entries: [],
      shownEntries: [],
      selectedEntry: undefined,
      rememberedTitle: undefined,
      files: [],
      shownFiles: [],
      selectedFile: undefined,
      archive: undefined,
      selectedMember: undefined,
      showingMoreFiles: false,
      showingAllFiles: false,
      partial: false,
      failedCategories: [],
      notice: undefined
    })
  }

  const reset = (): void => {
    ++core.operationId
    cancelPending()
    clearSession()
    core.cancelState = undefined
    core.previousSelection = undefined
    core.knownVersionIds = new Set()
    set(INITIAL_STATE)
  }

  const core: JimakuCore = {
    state: INITIAL_STATE,
    operationId: 0,
    knownVersionIds: new Set(),
    getDeps,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set,
    media,
    contextMatches,
    operationMatches,
    clearSession,
    cancelPending,
    startOperation,
    finishOperation,
    fail,
    serviceError,
    triedVersions,
    resetTitleChoice,
    reset
  }
  return core
}
