// Pure play-queue model. Renderer-owned state: an ordered
// list of absolute media paths with a current index, plus repeat/shuffle modes.
// Main stays stateless about it — the renderer drives `player:load`. No I/O,
// no Electron; every function is a pure state transition so it is fully unit
// testable.

import { isRemoteUrl } from '../../../shared/mediaFileTypes'

export type RepeatMode = 'off' | 'one' | 'all'

/** Injectable randomness seam so shuffles are deterministic in tests. */
export type Rng = () => number

export interface PlaylistState {
  /** Absolute media paths, in display order. Duplicates are allowed. */
  entries: string[]
  /** Index into `entries` of the active row, or -1 when the queue is empty. */
  currentIndex: number
  repeat: RepeatMode
  shuffle: boolean
  /**
   * The play sequence: a permutation of `[0..entries.length)`. When `shuffle`
   * is off it is the identity, so `nextIndex`/`prevIndex` walk display order.
   * When on it is a precomputed random permutation stored in state so that
   * `prevIndex` can retrace exactly the sequence `nextIndex` produced.
   */
  order: number[]
}

export const EMPTY_PLAYLIST: PlaylistState = {
  entries: [],
  currentIndex: -1,
  repeat: 'off',
  shuffle: false,
  order: []
}

function range(length: number): number[] {
  return Array.from({ length }, (_unused, index) => index)
}

/** Fisher–Yates over a copy, drawing from the injected rng. */
function shuffled(items: number[], rng: Rng): number[] {
  const result = [...items]
  for (let index = result.length - 1; index > 0; index--) {
    const swap = Math.floor(rng() * (index + 1))
    ;[result[index], result[swap]] = [result[swap], result[index]]
  }
  return result
}

/**
 * A fresh shuffle sequence that starts at the current entry, so enabling
 * shuffle mid-playback keeps the active entry playing and leaves the shuffled
 * remainder reachable (with repeat off, an unanchored shuffle could drop the
 * current entry at the end and make `nextIndex` return null immediately).
 */
function shuffleFromCurrent(state: PlaylistState, rng: Rng): number[] {
  const positions = range(state.entries.length)
  if (state.currentIndex < 0 || state.currentIndex >= positions.length)
    return shuffled(positions, rng)
  const others = positions.filter((position) => position !== state.currentIndex)
  return [state.currentIndex, ...shuffled(others, rng)]
}

/**
 * Appends paths to the queue. When the queue was empty the first added entry
 * becomes current. Under shuffle the existing play sequence is preserved and
 * the new positions are shuffled in after it; otherwise the sequence stays in
 * display order.
 */
export function addEntries(
  state: PlaylistState,
  paths: string[],
  rng: Rng = Math.random
): PlaylistState {
  const localPaths = paths.filter((path) => !isRemoteUrl(path))
  if (localPaths.length === 0) return state
  const entries = [...state.entries, ...localPaths]
  const newPositions = range(entries.length).slice(state.entries.length)
  const order = state.shuffle
    ? [...state.order, ...shuffled(newPositions, rng)]
    : range(entries.length)
  const currentIndex = state.entries.length === 0 ? 0 : state.currentIndex
  return { ...state, entries, currentIndex, order }
}

/**
 * Removes the entry at `index`. The current row follows: removals before it
 * shift it down; removing the current row leaves current pointing at what was
 * the next row (clamped to the new bounds); emptying the queue resets to -1.
 */
export function removeAt(state: PlaylistState, index: number): PlaylistState {
  if (index < 0 || index >= state.entries.length) return state
  const entries = state.entries.filter((_entry, position) => position !== index)
  let currentIndex: number
  if (entries.length === 0) {
    currentIndex = -1
  } else if (index < state.currentIndex) {
    currentIndex = state.currentIndex - 1
  } else if (index === state.currentIndex) {
    currentIndex = Math.min(state.currentIndex, entries.length - 1)
  } else {
    currentIndex = state.currentIndex
  }
  // Preserve the shuffle sequence by dropping the removed position and closing
  // the gap left in the higher indices; identity when not shuffled.
  const order = state.shuffle
    ? state.order
        .filter((position) => position !== index)
        .map((position) => (position > index ? position - 1 : position))
    : range(entries.length)
  return { ...state, entries, currentIndex, order }
}

/** Position `oldPos` occupies after moving the entry at `from` to `to`. */
function remapAfterMove(oldPos: number, from: number, to: number): number {
  if (oldPos === from) return to
  if (from < to && oldPos > from && oldPos <= to) return oldPos - 1
  if (from > to && oldPos >= to && oldPos < from) return oldPos + 1
  return oldPos
}

/**
 * Moves the entry at `from` to `to`, shifting the entries between them. The
 * current row keeps identifying the same entry, and under shuffle the play
 * sequence is remapped so it still describes the same entries in the same
 * order — reordering the display never re-randomizes an active shuffle.
 */
export function moveEntry(state: PlaylistState, from: number, to: number): PlaylistState {
  const count = state.entries.length
  if (from < 0 || from >= count || to < 0 || to >= count || from === to) return state
  const entries = [...state.entries]
  const [moved] = entries.splice(from, 1)
  entries.splice(to, 0, moved)
  const currentIndex = state.currentIndex === -1 ? -1 : remapAfterMove(state.currentIndex, from, to)
  const order = state.shuffle
    ? state.order.map((position) => remapAfterMove(position, from, to))
    : range(count)
  return { ...state, entries, currentIndex, order }
}

/** Sequence position of the current entry, or -1 when it is not placed. */
function currentSequencePosition(state: PlaylistState): number {
  return state.order.indexOf(state.currentIndex)
}

/**
 * The entry index to play after the current one, or null when the queue is
 * empty or at its end with repeat off. `repeat: 'all'` wraps to the sequence
 * start. `repeat: 'one'` is deliberately *not* handled here — it governs EOF
 * replay only, and explicit next always advances (the controller checks it).
 */
export function nextIndex(state: PlaylistState): number | null {
  if (state.entries.length === 0) return null
  const position = currentSequencePosition(state)
  if (position === -1) return state.order[0] ?? null
  if (position + 1 < state.order.length) return state.order[position + 1]
  return state.repeat === 'all' ? state.order[0] : null
}

/**
 * The entry index to play before the current one, or null when the queue is
 * empty or at its start with repeat off. `repeat: 'all'` wraps to the end.
 */
export function prevIndex(state: PlaylistState): number | null {
  if (state.entries.length === 0) return null
  const position = currentSequencePosition(state)
  if (position === -1) return state.order[0] ?? null
  if (position - 1 >= 0) return state.order[position - 1]
  return state.repeat === 'all' ? state.order[state.order.length - 1] : null
}

/** Sets the repeat mode. */
export function setRepeat(state: PlaylistState, repeat: RepeatMode): PlaylistState {
  return state.repeat === repeat ? state : { ...state, repeat }
}

/**
 * Toggles shuffle, rebuilding the play sequence: when enabling, a fresh random
 * permutation anchored at the current entry (it stays playing and the shuffled
 * remainder stays reachable); when disabling, the identity. `currentIndex`
 * itself is untouched.
 */
export function setShuffle(
  state: PlaylistState,
  shuffle: boolean,
  rng: Rng = Math.random
): PlaylistState {
  if (state.shuffle === shuffle) return state
  const order = shuffle ? shuffleFromCurrent(state, rng) : range(state.entries.length)
  return { ...state, shuffle, order }
}

/**
 * Regenerates the shuffle permutation. Used when a repeat-all cycle wraps so
 * the next pass through the queue is a new random order; a no-op when shuffle
 * is off (display order never re-randomizes).
 */
export function reshuffle(state: PlaylistState, rng: Rng = Math.random): PlaylistState {
  if (!state.shuffle) return state
  return { ...state, order: shuffled(range(state.entries.length), rng) }
}
