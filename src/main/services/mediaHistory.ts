import {
  HISTORY_FLUSH_DELAY_MS,
  MAX_RECENT_FILES,
  mediaPathKey,
  normalizeMediaPath,
  normalizeStoredTrackSelection,
  normalizeSubtitleSelection,
  prunePlaybackHistory,
  type MediaHistory,
  type MediaPlaybackHistory,
  type PathNormalizationOptions,
  type RecentMediaFile,
  type StoredSubtitleSelection,
  type StoredTrackSelection
} from '../../shared/mediaHistory'
import { isRemoteUrl } from '../../shared/mediaFileTypes'
import type { FileAvailability } from '../../shared/preloadApi'
import { stat as statFile } from 'node:fs/promises'
import type { SettingsStore } from './settings'

export interface MediaHistoryTimers {
  setTimer(callback: () => void, delayMs: number): unknown
  clearTimer(handle: unknown): void
}

export interface MediaHistoryFileInfo {
  isFile(): boolean
}

export interface MediaHistoryServiceDependencies {
  settings: SettingsStore
  now?: () => number
  timers?: MediaHistoryTimers
  pathOptions?: PathNormalizationOptions
  stat?: (path: string) => Promise<MediaHistoryFileInfo>
}

export interface MediaHistoryService {
  getRecentFiles(): RecentMediaFile[]
  getPlaybackHistory(path: string): MediaPlaybackHistory | undefined
  checkFileAvailability(path: string): Promise<FileAvailability>
  getLastOpenFolder(): string | undefined
  setLastOpenFolder(folder: string): void
  recordOpened(path: string): void
  beginLoad(): void
  abortLoad(): void
  observePath(value: unknown): void
  observePosition(value: unknown): void
  observeDuration(value: unknown): void
  setAudioTrack(path: string, track: StoredTrackSelection): void
  setSubtitleTrack(path: string, selection: StoredSubtitleSelection): void
  removeRecentFile(path: string): RecentMediaFile[]
  clearRecentFiles(): void
  flush(): void
  dispose(): void
}

const systemTimers: MediaHistoryTimers = {
  setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
}

/**
 * Owns durable media history and buffers mpv progress observations. All path
 * identity is canonical; display paths retain the most recently opened casing.
 */
export function createMediaHistoryService(
  dependencies: MediaHistoryServiceDependencies
): MediaHistoryService {
  const {
    settings,
    now = Date.now,
    timers = systemTimers,
    pathOptions,
    stat = statFile
  } = dependencies
  let activeKey: string | undefined
  let pendingPosition: number | undefined
  let pendingDuration: number | undefined
  let dirty = false
  let timer: unknown
  let generation = 0
  // While a load is in flight, the outgoing file's key is kept in activeKey
  // (so abortLoad can resume tracking it) but suspended blocks attribution:
  // otherwise the incoming file's early position/duration events would be
  // recorded against the file that's being navigated away from.
  let suspended = false
  let observedKey: string | undefined
  let pathObservationEnabled = false

  function persist(history: MediaHistory): void {
    settings.set({ mediaHistory: history })
  }

  function history(): MediaHistory {
    return cloneHistory(settings.get().mediaHistory)
  }

  function pruneHistory(next: MediaHistory, mutatedKey?: string): void {
    const protectedKeys = next.recentFiles
      .map((entry) => mediaPathKey(entry.path, pathOptions))
      .filter((key): key is string => key !== undefined)
    if (activeKey) protectedKeys.push(activeKey)
    // The entry just written must never be the pruning victim, even when its
    // timestamp is not the newest (e.g. selections applied to a file mid-load).
    if (mutatedKey) protectedKeys.push(mutatedKey)
    next.playbackByPath = prunePlaybackHistory(next.playbackByPath, protectedKeys)
  }

  function updatePlayback(path: string, update: (entry: MediaPlaybackHistory) => void): void {
    const key = mediaPathKey(path, pathOptions)
    if (!key) return
    const next = history()
    const entry = clonePlayback(next.playbackByPath[key]) ?? {
      positionSeconds: 0,
      updatedAt: now()
    }
    update(entry)
    entry.updatedAt = now()
    next.playbackByPath[key] = entry
    pruneHistory(next, key)
    persist(next)
  }

  function cancelTimer(): void {
    if (timer === undefined) return
    timers.clearTimer(timer)
    timer = undefined
  }

  function scheduleFlush(): void {
    if (timer !== undefined) return
    const scheduledGeneration = generation
    const scheduledTimer: unknown = timers.setTimer(() => {
      if (scheduledGeneration !== generation || timer !== scheduledTimer) return
      timer = undefined
      flush()
    }, HISTORY_FLUSH_DELAY_MS)
    timer = scheduledTimer
  }

  function flush(): void {
    cancelTimer()
    if (!dirty || !activeKey) return

    const next = history()
    const entry = clonePlayback(next.playbackByPath[activeKey]) ?? {
      positionSeconds: 0,
      updatedAt: now()
    }
    if (pendingPosition !== undefined) entry.positionSeconds = pendingPosition
    if (pendingDuration !== undefined) entry.durationSeconds = pendingDuration
    entry.updatedAt = now()
    next.playbackByPath[activeKey] = entry
    pruneHistory(next)
    persist(next)
    dirty = false
  }

  return {
    getRecentFiles(): RecentMediaFile[] {
      return history().recentFiles
    },

    getPlaybackHistory(path: string): MediaPlaybackHistory | undefined {
      const key = mediaPathKey(path, pathOptions)
      return key ? clonePlayback(settings.get().mediaHistory.playbackByPath[key]) : undefined
    },

    async checkFileAvailability(path: string): Promise<FileAvailability> {
      const normalized = normalizeMediaPath(path, pathOptions)
      if (!normalized) return { status: 'missing' }
      // A network URL has no filesystem entry to stat; treat it as available so
      // recent-file rows for streams never show as missing. Reachability is
      // mpv's job at load time, not the history layer's.
      if (isRemoteUrl(normalized)) return { status: 'available' }
      try {
        return (await stat(normalized)).isFile() ? { status: 'available' } : { status: 'missing' }
      } catch (error) {
        const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
        return code === 'ENOENT' || code === 'ENOTDIR'
          ? { status: 'missing' }
          : { status: 'error', message: 'Unable to access this file.' }
      }
    },

    getLastOpenFolder(): string | undefined {
      return settings.get().mediaHistory.lastOpenFolder
    },

    setLastOpenFolder(folder: string): void {
      const normalized = normalizeMediaPath(folder, pathOptions)
      if (!normalized) return
      const next = history()
      next.lastOpenFolder = normalized
      persist(next)
    },

    recordOpened(path: string): void {
      flush()
      const normalized = normalizeMediaPath(path, pathOptions)
      const key = mediaPathKey(path, pathOptions)
      if (!normalized || !key) {
        return
      }

      generation += 1
      activeKey = key
      suspended = false
      const existing = settings.get().mediaHistory.playbackByPath[key]
      pendingPosition = undefined
      pendingDuration = existing?.durationSeconds

      const next = history()
      next.recentFiles = [
        { path: normalized, openedAt: now() },
        ...next.recentFiles.filter((entry) => mediaPathKey(entry.path, pathOptions) !== key)
      ].slice(0, MAX_RECENT_FILES)
      persist(next)
    },

    beginLoad(): void {
      // Lock in the outgoing file's last observed position before the new
      // load can produce any spurious early events.
      flush()
      suspended = true
    },

    abortLoad(): void {
      // The pending load never displaced the active file (mpv rejected the
      // command outright), so resume tracking it under its existing key.
      suspended = false
    },

    observePath(value: unknown): void {
      pathObservationEnabled = true
      observedKey = mediaPathKey(value, pathOptions)
    },

    observePosition(value: unknown): void {
      if (
        !activeKey ||
        suspended ||
        (pathObservationEnabled && observedKey !== activeKey) ||
        !isNonNegativeFinite(value)
      )
        return
      pendingPosition = value
      dirty = true
      scheduleFlush()
    },

    observeDuration(value: unknown): void {
      if (!isNonNegativeFinite(value) || value === 0) return
      // A duration can be emitted for either side of a load transition. Until
      // the destination is active, there is no safe way to attribute it.
      if (suspended) return
      if (!activeKey || (pathObservationEnabled && observedKey !== activeKey)) return
      pendingDuration = value
      dirty = true
      scheduleFlush()
    },

    setAudioTrack(path: string, track: StoredTrackSelection): void {
      const normalized = normalizeStoredTrackSelection(track)
      if (!normalized) return
      updatePlayback(path, (entry) => {
        entry.audioTrack = normalized
      })
    },

    setSubtitleTrack(path: string, selection: StoredSubtitleSelection): void {
      const normalized = normalizeSubtitleSelection(selection, pathOptions)
      if (!normalized) return
      updatePlayback(path, (entry) => {
        entry.subtitle = normalized
      })
    },

    removeRecentFile(path: string): RecentMediaFile[] {
      const key = mediaPathKey(path, pathOptions)
      if (!key) return history().recentFiles
      const next = history()
      next.recentFiles = next.recentFiles.filter(
        (entry) => mediaPathKey(entry.path, pathOptions) !== key
      )
      persist(next)
      return next.recentFiles
    },

    clearRecentFiles(): void {
      const next = history()
      next.recentFiles = []
      persist(next)
    },

    flush,

    dispose(): void {
      try {
        flush()
      } finally {
        cancelTimer()
      }
    }
  }
}

function cloneHistory(value: MediaHistory): MediaHistory {
  const playbackByPath = Object.create(null) as Record<string, MediaPlaybackHistory>
  for (const [path, entry] of Object.entries(value.playbackByPath))
    playbackByPath[path] = clonePlayback(entry)!
  return {
    ...(value.lastOpenFolder ? { lastOpenFolder: value.lastOpenFolder } : {}),
    recentFiles: value.recentFiles.map((entry) => ({ ...entry })),
    playbackByPath
  }
}

function clonePlayback(value: MediaPlaybackHistory | undefined): MediaPlaybackHistory | undefined {
  if (!value) return undefined
  return {
    ...value,
    ...(value.audioTrack ? { audioTrack: { ...value.audioTrack } } : {}),
    ...(value.subtitle ? { subtitle: cloneSubtitleSelection(value.subtitle) } : {})
  }
}

function cloneSubtitleSelection(value: StoredSubtitleSelection): StoredSubtitleSelection {
  return value.mode === 'track' ? { mode: 'track', track: { ...value.track } } : { ...value }
}

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}
