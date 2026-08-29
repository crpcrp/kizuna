import type { JlptLevel } from '../../../shared/jlpt'
import type {
  JlptCoverageReportReady,
  JlptCoverageReportResult
} from '../../../shared/jlptCoverage'

export type JlptCoveragePhase = 'idle' | 'loading' | 'ready' | 'error'

export interface JlptCoverageState {
  open: boolean
  phase: JlptCoveragePhase
  report: JlptCoverageReportReady | null
  error: string | null
  selectedLevel: JlptLevel
}

export interface JlptCoverageController {
  getState(): JlptCoverageState
  subscribe(listener: () => void): () => void
  openReport(): void
  closeReport(): void
  retry(): void
  setSelectedLevel(level: JlptLevel): void
}

export interface CreateJlptCoverageControllerDeps {
  loadReport: () => Promise<JlptCoverageReportResult>
  logError?: (error: unknown) => void
}

export const JLPT_COVERAGE_ERROR_MESSAGES = {
  bundledData: 'The bundled JLPT coverage data is unavailable or corrupt.',
  knowledgeDatabase: 'The local knowledge database is unavailable.',
  unexpected: 'Could not load the JLPT coverage report.'
} as const

const INITIAL_STATE: JlptCoverageState = {
  open: false,
  phase: 'idle',
  report: null,
  error: null,
  selectedLevel: 'N3'
}

function logError(error: unknown): void {
  console.error('[kizuna] JLPT coverage report failed:', error)
}

export function userSafeError(message: string): string {
  const normalized = message.toLowerCase()
  if (
    normalized.includes('bundled jlpt coverage data') &&
    normalized.includes('unavailable or corrupt')
  ) {
    return JLPT_COVERAGE_ERROR_MESSAGES.bundledData
  }
  if (normalized.includes('could not read local knowledge data')) {
    return JLPT_COVERAGE_ERROR_MESSAGES.knowledgeDatabase
  }
  return JLPT_COVERAGE_ERROR_MESSAGES.unexpected
}

/** Owns the JLPT coverage request lifetime independently from subtitle reports. */
export function createJlptCoverageController(
  deps: CreateJlptCoverageControllerDeps
): JlptCoverageController {
  let state = INITIAL_STATE
  const listeners = new Set<() => void>()
  let requestToken = 0
  const reportError = deps.logError ?? logError

  function set(next: JlptCoverageState): void {
    state = next
    listeners.forEach((listener) => listener())
  }

  function isCurrent(request: number): boolean {
    return requestToken === request && state.open
  }

  async function load(request: number): Promise<void> {
    try {
      const result = await deps.loadReport()
      if (result.status === 'error') reportError(result.message)
      if (!isCurrent(request)) return

      if (result.status === 'error') {
        set({ ...state, phase: 'error', report: null, error: userSafeError(result.message) })
      } else {
        set({ ...state, phase: 'ready', report: result, error: null })
      }
    } catch (error) {
      reportError(error)
      if (!isCurrent(request)) return
      set({
        ...state,
        phase: 'error',
        report: null,
        error: JLPT_COVERAGE_ERROR_MESSAGES.unexpected
      })
    }
  }

  function beginRequest(): void {
    const request = ++requestToken
    set({ ...state, open: true, phase: 'loading', report: null, error: null })
    void load(request)
  }

  return {
    getState: () => state,

    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    openReport(): void {
      beginRequest()
    },

    closeReport(): void {
      requestToken++
      set({ ...state, open: false, phase: 'idle', report: null, error: null })
    },

    retry(): void {
      if (state.open) beginRequest()
    },

    setSelectedLevel(level): void {
      if (state.selectedLevel === level) return
      set({ ...state, selectedLevel: level })
    }
  }
}
