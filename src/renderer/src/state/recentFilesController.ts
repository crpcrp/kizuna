import type { RecentMediaFile } from '../../../shared/mediaHistory'
import { errorMessage } from '../util/errorMessage'
import { loadPath, openAndLoad, openRecentFile } from './mediaOpen'
import {
  type OpenMediaResult,
  type OpenSession,
  type OpenWarningSink,
  type RecentMediaBridge
} from './mediaSession'
interface WarningSink {
  report: OpenWarningSink
  latest(): string | undefined
}

export interface BannerTimer {
  set(callback: () => void, delayMs: number): unknown
  clear(handle: unknown): void
}

const browserBannerTimer: BannerTimer = {
  set: (callback, delayMs) => window.setTimeout(callback, delayMs),
  clear: (handle) => window.clearTimeout(handle as number)
}

export interface RecentFilesBridge extends RecentMediaBridge {
  mediaHistory: RecentMediaBridge['mediaHistory'] & {
    getRecentFiles(): Promise<RecentMediaFile[]>
    clearRecentFiles(): Promise<void>
  }
}

export interface RecentFilesState {
  recentFiles: RecentMediaFile[]
  // Render-visible state is not the exclusion lock: React may expose a snapshot one frame late.
  mediaOpening: boolean
  errorMessage: string | undefined
}

const INITIAL_STATE: RecentFilesState = {
  recentFiles: [],
  mediaOpening: false,
  errorMessage: undefined
}

export interface RecentFilesController {
  getState(): RecentFilesState
  subscribe(listener: () => void): () => void
  init(bridge: RecentFilesBridge): Promise<void>
  openPicker(session: OpenSession & { bridge: RecentFilesBridge }): Promise<OpenMediaResult>
  openRecent(
    session: OpenSession & { bridge: RecentFilesBridge },
    filePath: string
  ): Promise<OpenMediaResult>
  openPath(
    session: OpenSession & { bridge: RecentFilesBridge },
    filePath: string
  ): Promise<OpenMediaResult>
  /** Clears recent shortcuts (not playback/track history). Retains the list on failure. */
  clearRecent(bridge: RecentFilesBridge): Promise<void>
  reportError(message: string): void
  // A newer banner update cancels the transient timer so it cannot dismiss a message it did not set.
  reportTransient(message: string, ttlMs?: number): void
  dismissError(): void
  dispose(): void
}

export function createRecentFilesController(
  timer: BannerTimer = browserBannerTimer
): RecentFilesController {
  let state: RecentFilesState = INITIAL_STATE
  const listeners = new Set<() => void>()
  // Lock synchronously: two opens in the same frame could both see mediaOpening as false.
  let openInFlight = false
  let transientHandle: unknown

  function set(patch: Partial<RecentFilesState>): void {
    if ('errorMessage' in patch && transientHandle !== undefined) {
      timer.clear(transientHandle)
      transientHandle = undefined
    }
    state = { ...state, ...patch }
    listeners.forEach((listener) => listener())
  }

  async function refreshRecentFiles(bridge: RecentFilesBridge): Promise<void> {
    try {
      set({ recentFiles: await bridge.mediaHistory.getRecentFiles() })
    } catch {
      // Leave the previously-known list in place; the open itself already
      // succeeded or failed and reported its own outcome.
    }
  }

  // Subtitle warnings can arrive after opening; retain early warnings so the open result cannot erase them.
  function createWarningSink(): WarningSink {
    let latest: string | undefined
    return {
      report(message) {
        latest = message
        set({ errorMessage: message })
      },
      latest: () => latest
    }
  }

  async function applyOpenResult(
    bridge: RecentFilesBridge,
    result: OpenMediaResult,
    warnings: WarningSink
  ): Promise<OpenMediaResult> {
    switch (result.status) {
      case 'opened':
        await refreshRecentFiles(bridge)
        set({ errorMessage: result.warnings[0] ?? warnings.latest() })
        break
      case 'missing':
        await refreshRecentFiles(bridge)
        set({ errorMessage: result.message })
        break
      case 'failed':
        set({ errorMessage: result.message })
        break
      case 'cancelled':
      case 'stale':
      case 'busy':
        // Nothing was opened and nothing was overwritten: leave the list, the
        // banner and the active file exactly as the in-flight open left them.
        break
    }
    return result
  }

  async function runOpen(
    bridge: RecentFilesBridge,
    operation: (onWarning: OpenWarningSink) => Promise<OpenMediaResult>
  ): Promise<OpenMediaResult> {
    if (openInFlight) return { status: 'busy' }
    openInFlight = true
    set({ mediaOpening: true })
    const warnings = createWarningSink()
    try {
      const result = await operation(warnings.report)
      return await applyOpenResult(bridge, result, warnings)
    } finally {
      openInFlight = false
      set({ mediaOpening: false })
    }
  }

  function runOpenPicker(
    session: OpenSession & { bridge: RecentFilesBridge }
  ): Promise<OpenMediaResult> {
    return runOpen(session.bridge, (onWarning) => openAndLoad({ ...session, onWarning }))
  }

  function runOpenPath(
    session: OpenSession & { bridge: RecentFilesBridge },
    filePath: string
  ): Promise<OpenMediaResult> {
    return runOpen(session.bridge, (onWarning) => loadPath({ ...session, onWarning }, filePath))
  }

  function runOpenRecent(
    session: OpenSession & { bridge: RecentFilesBridge },
    filePath: string
  ): Promise<OpenMediaResult> {
    return runOpen(session.bridge, (onWarning) =>
      openRecentFile({ ...session, onWarning }, filePath)
    )
  }

  return {
    getState: () => state,

    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    async init(bridge): Promise<void> {
      try {
        set({ recentFiles: await bridge.mediaHistory.getRecentFiles() })
      } catch (err) {
        set({ recentFiles: [], errorMessage: errorMessage(err) })
      }
    },

    openPicker(session): Promise<OpenMediaResult> {
      return runOpenPicker(session)
    },

    openRecent(session, filePath): Promise<OpenMediaResult> {
      return runOpenRecent(session, filePath)
    },

    openPath(session, filePath): Promise<OpenMediaResult> {
      return runOpenPath(session, filePath)
    },

    async clearRecent(bridge): Promise<void> {
      try {
        await bridge.mediaHistory.clearRecentFiles()
        set({ recentFiles: [], errorMessage: undefined })
      } catch (err) {
        set({ errorMessage: errorMessage(err) })
      }
    },

    reportError(message: string): void {
      set({ errorMessage: message })
    },

    reportTransient(message: string, ttlMs = 1000): void {
      set({ errorMessage: message })
      transientHandle = timer.set(() => {
        transientHandle = undefined
        set({ errorMessage: undefined })
      }, ttlMs)
    },

    dismissError(): void {
      set({ errorMessage: undefined })
    },

    dispose(): void {
      if (transientHandle !== undefined) {
        timer.clear(transientHandle)
        transientHandle = undefined
      }
    }
  }
}
