// Playlist controller. Bridges the pure queue model in
// `playlist.ts` to the media open pipeline and to the EOF push. It is a small
// subscribable store (same shape as recentFilesController): the renderer reads
// `getState()` and re-renders on `subscribe`, while `App.tsx` wires the load
// dependency and the EOF subscription. Loading itself goes through the injected
// `load` callback (App supplies `recentFilesController.openPath`), so the whole
// controller is unit-testable without a live player.

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
  /**
   * Whether the queue currently owns playback: it has >1 entry and the file
   * playing (`filePath`) is exactly its current entry. Only then may the queue
   * take EOF precedence — merely queueing files behind an unrelated video (which
   * leaves `currentIndex` at the pure model's default 0 without loading it) must
   * not let EOF advance from that phantom row and skip entry 0.
   */
  isPlaybackCurrent(filePath: string | undefined): boolean
  /** Appends paths to the queue (drops, multi-select, folder, parsed M3U). */
  addPaths(paths: string[]): void
  /**
   * Appends `paths`, and — only when the queue was empty before the append and
   * `isPlaying` is false — starts the first appended entry through the same
   * skip-over-broken-entries path `playAt` uses. Returns true when playback was
   * started. Appending to a non-empty queue, or while something is playing, is
   * exactly `addPaths`.
   */
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
    const attemptLimit = state.playlist.entries.length
    let index = startIndex
    for (let attempts = 0; attempts < attemptLimit; attempts++) {
      if (index < 0 || index >= state.playlist.entries.length) return
      setPlaylist({ ...state.playlist, currentIndex: index })
      const path = state.playlist.entries[index]
      const result = await deps.load(path)
      if (result.status === 'opened') {
        clearMissing(index)
        if (autoplay) await deps.play()
        return
      }
      if (result.status !== 'missing' && result.status !== 'failed') return
      if (index >= state.playlist.entries.length || state.playlist.entries[index] !== path) return
      markMissing(index)
      const next = nextIndex(state.playlist)
      if (next === null || next === startIndex) return
      index = next
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
      if (paths.length === 0) return
      setPlaylist(addEntries(state.playlist, paths, rng))
    },

    async addPathsAndMaybePlay(paths, isPlaying, deps) {
      if (paths.length === 0) return false
      const wasEmpty = state.playlist.entries.length === 0
      setPlaylist(addEntries(state.playlist, paths, rng))
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
