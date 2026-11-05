import { useSyncExternalStore } from 'react'

/**
 * Holds mpv's playback position outside React state. mpv pushes `time-pos`
 * for every frame; keeping it in the App reducer re-rendered the whole tree
 * ~25 times a second. Consumers instead subscribe to the slice they display
 * (`useTimePos`) or read it imperatively (`get`) in handlers and listeners.
 */
export interface TimePosStore {
  get(): number
  set(value: number): void
  subscribe(listener: () => void): () => void
}

export function createTimePosStore(initial = 0): TimePosStore {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    get: () => value,
    set(next) {
      if (Object.is(next, value)) return
      value = next
      for (const listener of listeners) listener()
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }
  }
}

/**
 * Re-renders the caller only when `select(timePos)` changes (`Object.is`), so
 * `select` should return a primitive or an existing object such as a cue.
 */
export function useTimePos<T>(store: TimePosStore, select: (timePos: number) => T): T {
  const snapshot = (): T => select(store.get())
  return useSyncExternalStore(store.subscribe, snapshot, snapshot)
}

// Display steps per second, finest first. Whole divisors keep floored
// positions exact (3.0 * 10 is 30; 3.0 / 0.1 is 29.999…).
const SEEK_DISPLAY_RATES = [10, 4, 2, 1]

/**
 * Pure. How many bottom-bar position updates per second are worth rendering:
 * about one step per 1/2000 of the media (well under a slider pixel), never
 * fewer than one so the one-second time readout stays current.
 */
export function seekDisplayRate(duration: number): number {
  const wantedStep = Number.isFinite(duration) && duration > 0 ? duration / 2000 : 1
  return SEEK_DISPLAY_RATES.find((rate) => 1 / rate >= wantedStep) ?? 1
}

/** Pure. Floors a position to `rate` steps per second. */
export function quantizeTimePos(timePos: number, rate: number): number {
  return Math.floor(timePos * rate) / rate
}
