import type { PlayerSettings } from '../../../shared/playerSettings'

export interface TimerLike {
  setTimeout(handler: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

/** Shape of `window.kizuna.playerSettings.setSettings`. */
export type SettingsWriter = (patch: Partial<PlayerSettings>) => Promise<PlayerSettings>

export type SettingsWriteErrorHandler = (error: unknown) => void

export interface SettingsPersistence {
  /** Merges `patch` into the pending write and (re)starts the debounce timer. */
  schedule(patch: Partial<PlayerSettings>): void
  /**
   * Writes unsaved settings immediately; resolves once the attempt it triggered
   * (and any still-outstanding earlier write) settles. A failed attempt is
   * reported and remains unsaved for a later explicit flush or scheduled change;
   * this call does not retry it again by itself. Resolves without writing if
   * there is no unsaved work.
   */
  flush(): Promise<void>
  /** Drops pending and retained failed work (and its timer) without writing it. */
  cancel(): void
}

const DEFAULT_DELAY_MS = 250

/**
 * Coalesces rapid `PlayerSettings` patches (e.g. subtitle-drag mousemove
 * ticks) into a single debounced `write` call, shallow-merging pending
 * patches so the latest value per top-level field wins.
 *
 * Actual `write` invocations are chained one-at-a-time rather than fired
 * concurrently. A write snapshots the aggregate only when it starts, so
 * changes made while an earlier write is in flight are included in the next
 * attempt. A successful snapshot clears only fields that still have the same
 * value; newer values remain unsaved. Rejected writes are reported and kept
 * retryable without poisoning later `schedule`/`flush` calls.
 */
export function createSettingsPersistence(
  write: SettingsWriter,
  timers: TimerLike = {
    setTimeout: (handler, ms) => window.setTimeout(handler, ms),
    clearTimeout: (handle) => window.clearTimeout(handle as number)
  },
  delayMs: number = DEFAULT_DELAY_MS,
  onWriteError: SettingsWriteErrorHandler = () => undefined
): SettingsPersistence {
  // This is the latest value for every field that has not yet been confirmed
  // by a successful write. It intentionally includes the current in-flight
  // snapshot until that snapshot settles, so a rejection is automatically
  // retained for a later retry.
  let unsaved: Partial<PlayerSettings> = {}
  let handle: unknown = null
  // The still-settling tail write, if any; null once the queue is idle.
  let tail: Promise<void> | null = null
  // Set only when the queued write actually starts. Keeping this separate from
  // `unsaved` lets us tell whether a flush needs a new attempt while an older
  // snapshot is still in flight.
  let inFlightSnapshot: Partial<PlayerSettings> | null = null
  let queued = false

  const hasOwn = (patch: Partial<PlayerSettings>, key: keyof PlayerSettings): boolean =>
    Object.prototype.hasOwnProperty.call(patch, key)

  const patchKeys = (patch: Partial<PlayerSettings>): Array<keyof PlayerSettings> =>
    Object.keys(patch) as Array<keyof PlayerSettings>

  function hasUnstartedWork(): boolean {
    if (patchKeys(unsaved).length === 0) return false
    if (!inFlightSnapshot) return true
    return patchKeys(unsaved).some(
      (key) => !hasOwn(inFlightSnapshot!, key) || !Object.is(unsaved[key], inFlightSnapshot![key])
    )
  }

  function clearTimer(): void {
    if (handle !== null) {
      timers.clearTimeout(handle)
      handle = null
    }
  }

  function reportWriteError(error: unknown): void {
    try {
      onWriteError(error)
    } catch {
      // Error reporting must not turn a handled write failure into an
      // unhandled rejection or poison the serialization queue.
    }
  }

  function writeSnapshot(): Promise<void> {
    queued = false
    if (patchKeys(unsaved).length === 0) return Promise.resolve()

    // The snapshot must be captured here, rather than when the attempt is
    // queued, so changes made while an earlier write is in flight are not
    // retried with stale values.
    const snapshot = { ...unsaved }
    inFlightSnapshot = snapshot

    let result: Promise<PlayerSettings>
    try {
      result = write(snapshot)
    } catch (error) {
      inFlightSnapshot = null
      reportWriteError(error)
      return Promise.resolve()
    }

    return Promise.resolve(result).then(
      () => {
        for (const key of patchKeys(snapshot)) {
          if (hasOwn(unsaved, key) && Object.is(unsaved[key], snapshot[key])) {
            delete unsaved[key]
          }
        }
        inFlightSnapshot = null
      },
      (error: unknown) => {
        inFlightSnapshot = null
        reportWriteError(error)
      }
    )
  }

  /** Dispatches unsaved work. A new attempt is queued only when values remain
   * after the current in-flight snapshot, or when a previous attempt failed. */
  function writePending(): Promise<void> {
    if (queued || !hasUnstartedWork()) return tail ?? Promise.resolve()

    queued = true
    const run = (): Promise<void> => writeSnapshot()
    const thisWrite: Promise<void> = (tail ? tail.then(run) : run()).then(() => {
      if (tail === thisWrite) tail = null
    })
    tail = thisWrite
    return thisWrite
  }

  return {
    schedule(patch: Partial<PlayerSettings>): void {
      unsaved = { ...unsaved, ...patch }
      clearTimer()
      handle = timers.setTimeout(() => {
        handle = null
        void writePending()
      }, delayMs)
    },
    flush(): Promise<void> {
      clearTimer()
      return writePending()
    },
    cancel(): void {
      clearTimer()
      unsaved = {}
    }
  }
}
