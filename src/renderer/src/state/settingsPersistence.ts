import type { PlayerSettings } from '../../../shared/playerSettings'

export interface TimerLike {
  setTimeout(handler: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

/** Shape of `window.kizuna.playerSettings.setSettings`. */
export type SettingsWriter = (patch: Partial<PlayerSettings>) => Promise<PlayerSettings>

export interface SettingsPersistence {
  /** Merges `patch` into the pending write and (re)starts the debounce timer. */
  schedule(patch: Partial<PlayerSettings>): void
  /** Writes any pending merged patch immediately; resolves once that write (and any
   *  still-outstanding earlier write) settles. Resolves without writing if nothing
   *  is pending. */
  flush(): Promise<void>
  /** Drops pending scheduled work (timer + merged patch) without writing. */
  cancel(): void
}

const DEFAULT_DELAY_MS = 250

/**
 * Coalesces rapid `PlayerSettings` patches (e.g. subtitle-drag mousemove
 * ticks) into a single debounced `write` call, shallow-merging pending
 * patches so the latest value per top-level field wins.
 *
 * Actual `write` invocations are chained one-at-a-time rather than fired
 * concurrently, so a write started for an older, already-superseded patch
 * can never resolve *after* — and stomp — a write started for a newer one;
 * this plays the same "don't let a stale async result win" role the
 * request-token guards in wordPopupActions.ts/knowledgeActions.ts play,
 * but as a serialization queue rather than a token compare, since there's
 * no per-call identity to reject here. A rejected write is swallowed so it
 * can't permanently poison later `schedule`/`flush` calls.
 */
export function createSettingsPersistence(
  write: SettingsWriter,
  timers: TimerLike = {
    setTimeout: (handler, ms) => window.setTimeout(handler, ms),
    clearTimeout: (handle) => window.clearTimeout(handle as number)
  },
  delayMs: number = DEFAULT_DELAY_MS
): SettingsPersistence {
  let pending: Partial<PlayerSettings> | null = null
  let handle: unknown = null
  // The still-settling tail write, if any; null once idle (no write in flight).
  let tail: Promise<void> | null = null

  function clearTimer(): void {
    if (handle !== null) {
      timers.clearTimeout(handle)
      handle = null
    }
  }

  /** Dispatches the currently-pending merged patch (if any). Writes
   * immediately when idle; otherwise chains onto `tail` so it only fires
   * once the earlier in-flight write has settled. */
  function writePending(): Promise<void> {
    if (!pending) return tail ?? Promise.resolve()
    const patch = pending
    pending = null
    const run = (): Promise<void> =>
      write(patch).then(
        () => undefined,
        () => undefined
      )
    const thisWrite: Promise<void> = (tail ? tail.then(run) : run()).then(() => {
      if (tail === thisWrite) tail = null
    })
    tail = thisWrite
    return thisWrite
  }

  return {
    schedule(patch: Partial<PlayerSettings>): void {
      pending = { ...pending, ...patch }
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
      pending = null
    }
  }
}
