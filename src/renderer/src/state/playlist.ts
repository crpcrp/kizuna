import { isRemoteUrl } from '../../../shared/mediaFileTypes'

export type RepeatMode = 'off' | 'one' | 'all'

export type Rng = () => number

export interface PlaylistState {
  /** Absolute media paths, in display order. Duplicates are allowed. */
  entries: string[]
  /** Index into `entries` of the active row, or -1 when the queue is empty. */
  currentIndex: number
  repeat: RepeatMode
  shuffle: boolean
  // Store the shuffle permutation so Previous retraces the exact sequence played by Next.
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

function shuffled(items: number[], rng: Rng): number[] {
  const result = [...items]
  for (let index = result.length - 1; index > 0; index--) {
    const swap = Math.floor(rng() * (index + 1))
    ;[result[index], result[swap]] = [result[swap], result[index]]
  }
  return result
}

// Anchor shuffle at the current entry so enabling it cannot strand the remaining queue.
function shuffleFromCurrent(state: PlaylistState, rng: Rng): number[] {
  const positions = range(state.entries.length)
  if (state.currentIndex < 0 || state.currentIndex >= positions.length)
    return shuffled(positions, rng)
  const others = positions.filter((position) => position !== state.currentIndex)
  return [state.currentIndex, ...shuffled(others, rng)]
}

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
  const order = state.shuffle
    ? state.order
        .filter((position) => position !== index)
        .map((position) => (position > index ? position - 1 : position))
    : range(entries.length)
  return { ...state, entries, currentIndex, order }
}

function remapAfterMove(oldPos: number, from: number, to: number): number {
  if (oldPos === from) return to
  if (from < to && oldPos > from && oldPos <= to) return oldPos - 1
  if (from > to && oldPos >= to && oldPos < from) return oldPos + 1
  return oldPos
}

// Reordering display rows must preserve the existing shuffled play sequence.
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

function currentSequencePosition(state: PlaylistState): number {
  return state.order.indexOf(state.currentIndex)
}

// Repeat-one governs EOF only; explicit Next still advances.
export function nextIndex(state: PlaylistState): number | null {
  if (state.entries.length === 0) return null
  const position = currentSequencePosition(state)
  if (position === -1) return state.order[0] ?? null
  if (position + 1 < state.order.length) return state.order[position + 1]
  return state.repeat === 'all' ? state.order[0] : null
}

export function prevIndex(state: PlaylistState): number | null {
  if (state.entries.length === 0) return null
  const position = currentSequencePosition(state)
  if (position === -1) return state.order[0] ?? null
  if (position - 1 >= 0) return state.order[position - 1]
  return state.repeat === 'all' ? state.order[state.order.length - 1] : null
}

export function setRepeat(state: PlaylistState, repeat: RepeatMode): PlaylistState {
  return state.repeat === repeat ? state : { ...state, repeat }
}

export function setShuffle(
  state: PlaylistState,
  shuffle: boolean,
  rng: Rng = Math.random
): PlaylistState {
  if (state.shuffle === shuffle) return state
  const order = shuffle ? shuffleFromCurrent(state, rng) : range(state.entries.length)
  return { ...state, shuffle, order }
}

// Reshuffle when repeat-all wraps so each pass gets a new order.
export function reshuffle(state: PlaylistState, rng: Rng = Math.random): PlaylistState {
  if (!state.shuffle) return state
  return { ...state, order: shuffled(range(state.entries.length), rng) }
}
