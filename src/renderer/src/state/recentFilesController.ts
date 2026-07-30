import type { RecentMediaFile } from '../../../shared/mediaHistory'
import { loadPath, openAndLoad, openRecentFile } from './mediaOpen'
import {
  type OpenMediaResult,
  type OpenSession,
  type OpenWarningSink,
  type RecentMediaBridge,
  errorMessage
} from './mediaSession'
/** One open's late-warning collector (see `createWarningSink`). */
interface WarningSink {
  report: OpenWarningSink
  latest(): string | undefined
}

/** Injected timer boundary for the transient-banner auto-dismiss, so it's testable with fake timers. */
export interface BannerTimer {
  set(callback: () => void, delayMs: number): unknown
  clear(handle: unknown): void
}

const browserBannerTimer: BannerTimer = {
  set: (callback, delayMs) => window.setTimeout(callback, delayMs),
  clear: (handle) => window.clearTimeout(handle as number)
}

/** Bridge surface the recent-files menu section needs beyond `RecentMediaBridge`. */
export interface RecentFilesBridge extends RecentMediaBridge {
  mediaHistory: RecentMediaBridge['mediaHistory'] & {
    getRecentFiles(): Promise<RecentMediaFile[]>
    clearRecentFiles(): Promise<void>
  }
}

export interface RecentFilesState {
  recentFiles: RecentMediaFile[]
  /**
   * True while an open is in flight. This is a render-visible mirror for
   * disabling controls — it is *not* the exclusion lock. The lock is the
   * controller-private `openInFlight` flag, which updates synchronously;
   * a React snapshot of this value can be a frame stale.
   */
  mediaOpening: boolean
  /** Sanitized, dismissible message for the error surface near the player. */
  errorMessage: string | undefined
}

const INITIAL_STATE: RecentFilesState = {
  recentFiles: [],
  mediaOpening: false,
  errorMessage: undefined
}

/**
 * The three open entry points (`openPicker`, `openRecent`, `openPath`) share one
 * exclusion guard: while any of them is in flight the others resolve `busy`
 * without touching a bridge.
 */
export interface RecentFilesController {
  getState(): RecentFilesState
  subscribe(listener: () => void): () => void
  /** Fetches the recent-files list once (App mount). A failure clears the list and warns. */
  init(bridge: RecentFilesBridge): Promise<void>
  /** Opens the file picker via `openAndLoad`, then refreshes state from the result. */
  openPicker(session: OpenSession & { bridge: RecentFilesBridge }): Promise<OpenMediaResult>
  /** Opens a recent-file entry via `openRecentFile`, then refreshes state from the result. */
  openRecent(
    session: OpenSession & { bridge: RecentFilesBridge },
    filePath: string
  ): Promise<OpenMediaResult>
  /**
   * Opens an explicit path (a drag-and-dropped file) via `loadPath`, with the
   * same open guard and recents refresh as openPicker/openRecent. Unlike
   * openRecent it skips the availability check: the file was just dragged out
   * of a live filesystem view, and `loadPath` already reports `failed` if it
   * turns out to be gone.
   */
  openPath(
    session: OpenSession & { bridge: RecentFilesBridge },
    filePath: string
  ): Promise<OpenMediaResult>
  /** Clears recent shortcuts (not playback/track history). Retains the list on failure. */
  clearRecent(bridge: RecentFilesBridge): Promise<void>
  /** Surfaces an app-level media message (e.g. a rejected drop) in the error banner. */
  reportError(message: string): void
  /**
   * Surfaces a message that clears itself after `ttlMs` (default 1000ms) —
   * for outcomes like a screenshot save that are worth a glance but not worth
   * a manual dismiss. Any banner update that arrives first (a newer transient,
   * a `reportError`, an open result, `dismissError`) cancels the pending timer,
   * so it never claws back a message it didn't set.
   */
  reportTransient(message: string, ttlMs?: number): void
  dismissError(): void
  /** Cancels any pending transient-dismiss timer. Call on unmount. */
  dispose(): void
}

/**
 * Owns the Media menu's recent-files list, the shared open/loading flag, and
 * the dismissible media error surface —
 * the same subscribable-store shape as popupController/optionsData.
 */
export function createRecentFilesController(
  timer: BannerTimer = browserBannerTimer
): RecentFilesController {
  let state: RecentFilesState = INITIAL_STATE
  const listeners = new Set<() => void>()
  /**
   * The one exclusion lock for every media open (picker, recent, drop). Private
   * and synchronous on purpose: `state.mediaOpening` reaches a caller only
   * through a React render, so two opens started in the same frame would both
   * read it as false.
   */
  let openInFlight = false
  /** Handle for a pending `reportTransient` auto-dismiss (see `set`). */
  let transientHandle: unknown

  function set(patch: Partial<RecentFilesState>): void {
    // Any banner update — including this one — retires a still-pending
    // transient timer, so an older success/error can never clear a message it
    // didn't set (the timer is cancelled before it would ever fire).
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

  /**
   * Sink for a restoration warning that lands after the open resolved —
   * subtitle extraction finishes independently of the file open (see
   * `loadPath`), so its failure cannot travel in `OpenMediaResult.warnings`.
   * The warning is surfaced as soon as it arrives, and `latest()` lets
   * `applyOpenResult` fold in one that arrived before the open result was
   * applied, instead of clearing the banner it just set.
   */
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

  /**
   * Runs one media open under the exclusion lock. A second open attempted while
   * one is in flight is refused as `busy` before it touches any bridge, so the
   * two can never race for the active file. The lock is taken before
   * `mediaOpening` is published and released in the same `finally` that clears
   * it, so a rejected operation cannot strand it.
   */
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

  /** Session-first `openPicker`: runs `openAndLoad` under the exclusion lock. */
  function runOpenPicker(
    session: OpenSession & { bridge: RecentFilesBridge }
  ): Promise<OpenMediaResult> {
    return runOpen(session.bridge, (onWarning) => openAndLoad({ ...session, onWarning }))
  }

  /** Session-first `openPath`: runs `loadPath` under the exclusion lock. */
  function runOpenPath(
    session: OpenSession & { bridge: RecentFilesBridge },
    filePath: string
  ): Promise<OpenMediaResult> {
    return runOpen(session.bridge, (onWarning) => loadPath({ ...session, onWarning }, filePath))
  }

  /** Session-first `openRecent`: runs `openRecentFile` under the exclusion lock. */
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
