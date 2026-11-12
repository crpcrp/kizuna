// Shared mutable controller state and operation bookkeeping.
import type { JimakuServiceErrorCode, JimakuServiceResult } from '../../../../shared/jimaku'
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

/** Clears every title/file choice and returns to the title list. */
export const TITLE_CHOICE_RESET = {
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
} as const satisfies Partial<JimakuControllerState>

/** True while a cancellable service or subtitle request is in flight. */
export const isBusy = (phase: JimakuControllerPhase): boolean =>
  phase.kind === 'searchingTitles' ||
  phase.kind === 'loadingFiles' ||
  phase.kind === 'downloading' ||
  phase.kind === 'applying'

export type Operation = {
  id: number
  filePath: string
  loadGeneration: number
  sessionId?: string
}

export type JimakuCore = ReturnType<typeof createJimakuCore>

export const versionOf = (selection: StoredSubtitleSelection): string | undefined =>
  selection.mode === 'external' ? selection.provenance?.contentVersion : undefined

export function createJimakuCore(getDeps: () => JimakuControllerDeps) {
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
    if (isBusy(core.state.phase)) cancelPending()
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

  const abortOperation = (): void => {
    cancelPending()
    ++core.operationId
    core.cancelState = undefined
  }

  const restoreCancelState = (): void => {
    const restore = core.cancelState
    core.cancelState = undefined
    if (restore) set({ ...restore, notice: undefined })
  }

  const fail = (code: JimakuControllerErrorCode, recovery: JimakuRecoveryTarget): void => {
    core.cancelState = undefined
    set({ ...core.state, phase: { kind: 'error', code, recovery }, notice: undefined })
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

  const request = async <T>(
    operation: Operation,
    recovery: 'titles' | 'files',
    call: (sessionId: string) => Promise<JimakuServiceResult<T>>,
    onError?: (code: JimakuServiceErrorCode) => boolean
  ): Promise<T | undefined> => {
    let result: JimakuServiceResult<T>
    try {
      result = await call(operation.sessionId!)
    } catch {
      result = { ok: false, error: { code: 'network' } }
    }
    if (!operationMatches(operation)) return undefined
    if (!result.ok && result.error.code === 'cancelled') {
      restoreCancelState()
      return undefined
    }
    core.cancelState = undefined
    if (result.ok) return result.value
    if (!onError?.(result.error.code)) fail(serviceError(result.error.code), recovery)
    return undefined
  }

  const resetTitleChoice = (): void => {
    abortOperation()
    set({ ...core.state, ...TITLE_CHOICE_RESET })
  }

  const reset = (): void => {
    abortOperation()
    clearSession()
    core.previousSelection = undefined
    core.knownVersionIds = new Set()
    set(INITIAL_STATE)
  }

  const core = {
    state: INITIAL_STATE,
    operationId: 0,
    sessionId: undefined as string | undefined,
    previousSelection: undefined as SubtitleSelectionSnapshot | undefined,
    knownVersionIds: new Set<string>(),
    /** State restored when the in-flight operation is cancelled. */
    cancelState: undefined as JimakuControllerState | undefined,
    getDeps,
    subscribe(listener: () => void): () => void {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    set,
    media,
    contextMatches,
    operationMatches,
    clearSession,
    cancelPending,
    startOperation,
    abortOperation,
    restoreCancelState,
    request,
    fail,
    serviceError,
    triedVersions,
    resetTitleChoice,
    reset
  }
  return core
}
