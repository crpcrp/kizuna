import type { PopupSortOrder } from '../../../shared/playerSettings'
import type { KizunaApi } from '../../../shared/preloadApi'
import {
  JLPT_EXPORT_MODES,
  type JlptExportMode,
  type JlptExportRequest
} from '../../../shared/jlptExport'
import type { JlptLevel } from '../../../shared/jlpt'
import { buildJlptMiningCandidates } from './jlptMining'
import {
  createBulkMiningController,
  type BulkMiningController,
  type BulkMiningPhase
} from './bulkMiningController'
import { errorMessage } from '../util/errorMessage'

export interface JlptBulkExportBridge {
  dict: Pick<KizunaApi['dict'], 'lookup'>
  anki: Pick<
    KizunaApi['anki'],
    'ping' | 'getSettings' | 'findExisting' | 'addNote' | 'findTargetDeckMembership'
  >
  knowledge: Pick<KizunaApi['knowledge'], 'jlptUnknownItems'>
}

export interface JlptBulkExportSource {
  bridge: JlptBulkExportBridge
  frequencyDictId: number | null
  sortOrder: PopupSortOrder
}

export interface JlptBulkExportState {
  open: boolean
  throughLevel: JlptLevel
  mode: JlptExportMode
  phase: BulkMiningPhase
}

export interface JlptBulkExportController {
  getState(): JlptBulkExportState
  subscribe(listener: () => void): () => void
  open(options?: { throughLevel?: JlptLevel }): void
  close(): void
  retry(): void
  setThroughLevel(level: JlptLevel): void
  setMode(mode: JlptExportMode): void
  toggle(lemma: string): void
  setHideTargetDeckMatches(hide: boolean): void
  selectAll(): void
  selectNone(): void
  start(): void
  cancel(): void
  backToList(): void
}

export interface CreateJlptBulkExportControllerDeps {
  getSource(): JlptBulkExportSource
  /** Refreshes the local knowledge view after a run adds or updates a note. */
  refreshKnowledge?: () => Promise<unknown>
}

export const JLPT_BULK_EXPORT_ERROR_MESSAGES = {
  bundledData: 'The bundled JLPT export data is unavailable or corrupt.',
  knowledgeDatabase: 'The local knowledge database is unavailable.',
  unexpected: 'Could not load unknown JLPT items.'
} as const

const INITIAL_STATE: JlptBulkExportState = {
  open: false,
  throughLevel: 'N3',
  mode: 'vocabulary',
  phase: { kind: 'idle' }
}

function safeListError(message: string): string {
  const normalized = message.toLowerCase()
  if (
    normalized.includes('bundled jlpt export data') &&
    normalized.includes('unavailable or corrupt')
  ) {
    return JLPT_BULK_EXPORT_ERROR_MESSAGES.bundledData
  }
  if (normalized.includes('could not read local knowledge data')) {
    return JLPT_BULK_EXPORT_ERROR_MESSAGES.knowledgeDatabase
  }
  return JLPT_BULK_EXPORT_ERROR_MESSAGES.unexpected
}

function isReloadable(state: JlptBulkExportState): boolean {
  return state.phase.kind !== 'running' && state.phase.kind !== 'done'
}

/** Owns JLPT list loading while delegating row resolution and mining to the shared controller. */
export function createJlptBulkExportController(
  deps: CreateJlptBulkExportControllerDeps,
  bulkMining: BulkMiningController = createBulkMiningController()
): JlptBulkExportController {
  let state = INITIAL_STATE
  let requestGeneration = 0
  let activeSource: JlptBulkExportSource | null = null
  let previousBulkPhase = bulkMining.getState()
  const listeners = new Set<() => void>()

  const set = (next: JlptBulkExportState): void => {
    state = next
    listeners.forEach((listener) => listener())
  }

  const isCurrent = (request: number): boolean => state.open && requestGeneration === request

  const onBulkPhase = (): void => {
    const phase = bulkMining.getState()
    if (
      previousBulkPhase.kind === 'running' &&
      phase.kind === 'done' &&
      !phase.abortMessage &&
      phase.summary.added + phase.summary.updated > 0
    ) {
      const refresh = deps.refreshKnowledge
      if (refresh) void refresh().catch(() => undefined)
    }
    previousBulkPhase = phase
    if (state.open) set({ ...state, phase })
  }

  bulkMining.subscribe(onBulkPhase)

  const beginLoad = (throughLevel: JlptLevel, mode: JlptExportMode): void => {
    const request = ++requestGeneration
    const source = deps.getSource()
    activeSource = source
    bulkMining.close()
    set({ open: true, throughLevel, mode, phase: { kind: 'preparing' } })
    void loadItems(request, source, { throughLevel, mode })
  }

  const loadItems = async (
    request: number,
    source: JlptBulkExportSource,
    exportRequest: JlptExportRequest
  ): Promise<void> => {
    try {
      const result = await source.bridge.knowledge.jlptUnknownItems(exportRequest)
      if (!isCurrent(request)) return
      if (result.status === 'error') {
        set({ ...state, phase: { kind: 'error', message: safeListError(result.message) } })
        return
      }

      const candidates = buildJlptMiningCandidates(result.items)
      await bulkMining.openCandidates({
        bridges: {
          dict: source.bridge.dict,
          anki: source.bridge.anki
        },
        candidates,
        frequencyDictId: source.frequencyDictId,
        sortOrder: source.sortOrder
      })
    } catch (error) {
      if (isCurrent(request))
        set({ ...state, phase: { kind: 'error', message: safeListError(errorMessage(error)) } })
    }
  }

  const reopenCurrentList = (): void => {
    if (!state.open || !isReloadable(state)) return
    beginLoad(state.throughLevel, state.mode)
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    open(options = {}): void {
      beginLoad(options.throughLevel ?? state.throughLevel, state.mode)
    },
    close(): void {
      requestGeneration++
      activeSource = null
      bulkMining.close()
      set({ ...INITIAL_STATE, phase: { kind: 'idle' } })
    },
    retry(): void {
      reopenCurrentList()
    },
    setThroughLevel(level): void {
      if (!state.open || !isReloadable(state) || state.throughLevel === level) return
      beginLoad(level, state.mode)
    },
    setMode(mode): void {
      if (!state.open || !isReloadable(state) || !JLPT_EXPORT_MODES.includes(mode)) return
      if (state.mode === mode) return
      beginLoad(state.throughLevel, mode)
    },
    toggle(lemma): void {
      bulkMining.toggle(lemma)
    },
    setHideTargetDeckMatches(hide): void {
      bulkMining.setHideTargetDeckMatches(hide)
    },
    selectAll(): void {
      bulkMining.selectAllVisible(activeSource?.frequencyDictId !== null)
    },
    selectNone(): void {
      bulkMining.selectNoneVisible(activeSource?.frequencyDictId !== null)
    },
    start(): void {
      if (!activeSource || !state.open) return
      void bulkMining.start({
        dict: activeSource.bridge.dict,
        anki: activeSource.bridge.anki
      })
    },
    cancel(): void {
      bulkMining.cancel()
    },
    backToList(): void {
      if (!activeSource || !state.open) return
      void bulkMining.backToList({
        dict: activeSource.bridge.dict,
        anki: activeSource.bridge.anki
      })
    }
  }
}
