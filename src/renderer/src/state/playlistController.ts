import {
  EMPTY_PLAYLIST,
  addEntries,
  moveEntry as moveEntryInList,
  nextIndex,
  prevIndex,
  removeAt as removeAtInList,
  reshuffle as reshuffleList,
  setRepeat as setRepeatMode,
  setShuffle as setShuffleMode,
  type PlaylistState,
  type RepeatMode,
  type Rng
} from './playlist'
import { classifyMediaFileName, isRemoteUrl } from '../../../shared/mediaFileTypes'
import { type OpenMediaResult } from './mediaSession'
export interface PlaylistControllerState {
  playlist: PlaylistState
  /**
   * Entry indices whose most recent load attempt failed (deleted/renamed). The
   * sidebar renders these rows as "missing". Cleared whenever the entry list
   * changes, since indices then no longer identify the same files.
   */
  missing: number[]
}

/** The load seam the controller needs — App wires `recentFilesController.openPath`. */
export interface PlaylistLoadDeps {
  /** Runs the full open pipeline (subtitles, tracks, history) for a path. */
  load(path: string): Promise<OpenMediaResult>
  /** Resumes playback after an EOF-driven load has completed. */
  play(): Promise<unknown>
}

export interface PlaylistController {
  getState(): PlaylistControllerState
  subscribe(listener: () => void): () => void
  /** Queued files behind unrelated playback must not take EOF precedence and skip the first entry. */
  isPlaybackCurrent(filePath: string | undefined): boolean
  /** Appends paths to the queue (drops, multi-select, folder, parsed M3U). */
  addPaths(paths: string[]): void
  /** Starts playback only when adding to an empty queue while idle; returns whether it started. */
  addPathsAndMaybePlay(
    paths: string[],
    isPlaying: boolean,
    deps: PlaylistLoadDeps
  ): Promise<boolean>
  removeAt(index: number): void
  moveEntry(from: number, to: number): void
  setRepeat(repeat: RepeatMode): void
  setShuffle(shuffle: boolean): void
  clear(): void
  /** Plays the entry at `index` (double-click / explicit), skipping forward over
   * unplayable entries and giving up after one full pass. */
  playAt(index: number, deps: PlaylistLoadDeps): Promise<void>
  /** Explicit next: always advances (repeat-one governs only EOF). */
  next(deps: PlaylistLoadDeps): Promise<void>
  /** Explicit previous: always retreats. */
  prev(deps: PlaylistLoadDeps): Promise<void>
  /**
   * Decides and performs the post-EOF action for an active queue: replay under
   * repeat-one, advance (reshuffling a shuffled repeat-all wrap), or stop at the
   * end with repeat-off. Returns true when the queue handled EOF, false to let
   * `App.tsx` fall back to folder auto-advance (queue empty or single entry).
   */
  handleEof(deps: PlaylistLoadDeps): Promise<boolean>
}

/**
 * Creates the playlist controller. `rng` is injectable so shuffle sequences are
 * deterministic in tests.
 */
export function createPlaylistController(rng: Rng = Math.random): PlaylistController {
  let state: PlaylistControllerState = { playlist: EMPTY_PLAYLIST, missing: [] }
  const listeners = new Set<() => void>()
  const missing = new Set<number>()
  // Only one playlist navigation may await an open. `currentIndex` is committed
  // after success, so a refused concurrent call cannot stage a competing row.
  let loadInFlight = false

  function notify(): void {
    listeners.forEach((listener) => listener())
  }

  function setPlaylist(playlist: PlaylistState): void {
    state = { ...state, playlist }
    notify()
  }

  function publishMissing(): void {
    state = { ...state, missing: [...missing].sort((a, b) => a - b) }
    notify()
  }

  function clearAllMissing(): void {
    if (missing.size === 0) return
    missing.clear()
    publishMissing()
  }

  function markMissing(index: number): void {
    if (!missing.has(index)) {
      missing.add(index)
      publishMissing()
    }
  }

  function clearMissing(index: number): void {
    if (missing.delete(index)) publishMissing()
  }

  /**
   * Plays `startIndex`, then on a missing/failed load skips to the queue's next
   * entry, bounded by one pass so a fully-broken queue can't spin forever. A
   * non-open, non-error result (busy/cancelled/stale) means something else owns
   * the open, so the pass stops without looping.
   */
  async function loadFromIndex(
    startIndex: number,
    deps: PlaylistLoadDeps,
    autoplay = false
  ): Promise<void> {
    if (loadInFlight) return
    loadInFlight = true
    const attemptLimit = state.playlist.entries.length
    let index = startIndex
    try {
      for (let attempts = 0; attempts < attemptLimit; attempts++) {
        if (index < 0 || index >= state.playlist.entries.length) return
        const path = state.playlist.entries[index]
        const result = await deps.load(path)
        if (result.status === 'opened') {
          const currentIndex = state.playlist.entries.indexOf(path)
          if (currentIndex === -1) return
          clearMissing(currentIndex)
          setPlaylist({ ...state.playlist, currentIndex })
          if (autoplay) await deps.play()
          return
        }
        if (result.status !== 'missing' && result.status !== 'failed') return
        if (index >= state.playlist.entries.length || state.playlist.entries[index] !== path) return
        markMissing(index)
        const next = nextIndex({ ...state.playlist, currentIndex: index })
        if (next === null || next === startIndex) return
        index = next
      }
    } finally {
      loadInFlight = false
    }
  }

  return {
    getState: () => state,

    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },

    isPlaybackCurrent(filePath) {
      const pl = state.playlist
      return (
        pl.entries.length > 1 && pl.currentIndex >= 0 && pl.entries[pl.currentIndex] === filePath
      )
    },

    addPaths(paths) {
      const localPaths = paths.filter((path) => !isRemoteUrl(path))
      if (localPaths.length === 0) return
      setPlaylist(addEntries(state.playlist, localPaths, rng))
    },

    async addPathsAndMaybePlay(paths, isPlaying, deps) {
      const localPaths = paths.filter((path) => !isRemoteUrl(path))
      if (localPaths.length === 0) return false
      const wasEmpty = state.playlist.entries.length === 0
      setPlaylist(addEntries(state.playlist, localPaths, rng))
      if (!wasEmpty || isPlaying) return false
      // Honour shuffle: the queue's own first playback position, not index 0.
      const start = state.playlist.order[0] ?? 0
      await loadFromIndex(start, deps, true)
      return true
    },

    removeAt(index) {
      setPlaylist(removeAtInList(state.playlist, index))
      clearAllMissing()
    },

    moveEntry(from, to) {
      setPlaylist(moveEntryInList(state.playlist, from, to))
      clearAllMissing()
    },

    setRepeat(repeat) {
      setPlaylist(setRepeatMode(state.playlist, repeat))
    },

    setShuffle(shuffle) {
      setPlaylist(setShuffleMode(state.playlist, shuffle, rng))
    },

    clear() {
      setPlaylist(EMPTY_PLAYLIST)
      clearAllMissing()
    },

    playAt(index, deps) {
      if (index < 0 || index >= state.playlist.entries.length) return Promise.resolve()
      return loadFromIndex(index, deps)
    },

    async next(deps) {
      const target = nextIndex(state.playlist)
      if (target !== null) await loadFromIndex(target, deps)
    },

    async prev(deps) {
      const target = prevIndex(state.playlist)
      if (target !== null) await loadFromIndex(target, deps)
    },

    async handleEof(deps) {
      const pl = state.playlist
      if (pl.entries.length <= 1) return false
      if (pl.repeat === 'one') {
        await loadFromIndex(pl.currentIndex, deps, true)
        return true
      }
      const position = pl.order.indexOf(pl.currentIndex)
      const atEnd = position === -1 || position >= pl.order.length - 1
      if (atEnd) {
        if (pl.repeat !== 'all') return true
        // Repeat-all wrap: reshuffle for a fresh pass, then start at its head.
        const wrapped = pl.shuffle ? reshuffleList(pl, rng) : pl
        setPlaylist(wrapped)
        await loadFromIndex(wrapped.order[0], deps, true)
        return true
      }
      await loadFromIndex(pl.order[position + 1], deps, true)
      return true
    }
  }
}

export interface PlaylistAppendDeps {
  readPlaylist: (path: string) => Promise<string[]>
  addPaths: (paths: string[]) => Promise<void>
}

export type PlaylistAppendResult =
  { status: 'added'; count: number } | { status: 'empty' } | { status: 'unreadable' }

export async function appendPathsToPlaylist(
  paths: string[],
  deps: PlaylistAppendDeps
): Promise<PlaylistAppendResult> {
  const expanded: string[] = []
  for (const path of paths) {
    if (classifyMediaFileName(path) === 'playlist') {
      try {
        expanded.push(...(await deps.readPlaylist(path)))
      } catch {
        return { status: 'unreadable' }
      }
    } else {
      expanded.push(path)
    }
  }
  const localPaths = expanded.filter((path) => !isRemoteUrl(path))
  if (localPaths.length === 0) return { status: 'empty' }
  await deps.addPaths(localPaths)
  return { status: 'added', count: localPaths.length }
}
