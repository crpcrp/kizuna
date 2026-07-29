import { describe, expect, it, vi } from 'vitest'
import { createSettingsPersistence } from '@src/renderer/src/state/settingsPersistence'
import type { PlayerSettings } from '@src/shared/playerSettings'
import type { TimerLike } from '@src/renderer/src/util/uiHelpers'

/** Deterministic manual-clock TimerLike, mirroring test/renderer/util/uiHelpers.test.ts. */
function fakeTimers(): TimerLike & { flush(): void; pendingCount(): number } {
  let nextId = 1
  const pending = new Map<number, () => void>()
  return {
    setTimeout(handler: () => void): unknown {
      const id = nextId++
      pending.set(id, handler)
      return id
    },
    clearTimeout(handle: unknown): void {
      pending.delete(handle as number)
    },
    flush(): void {
      const callbacks = [...pending.values()]
      pending.clear()
      callbacks.forEach((cb) => cb())
    },
    pendingCount(): number {
      return pending.size
    }
  }
}

function deferred<T>(): {
  promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  return {
    promise: new Promise((res, rej) => {
      resolve = res
      reject = rej
    }),
    resolve,
    reject
  }
}

const settingsResult = {} as PlayerSettings

describe('settingsPersistence', () => {
  it('coalesces rapid schedule() calls into one merged write', () => {
    const timers = fakeTimers()
    const write = vi.fn().mockResolvedValue(settingsResult)
    const persistence = createSettingsPersistence(write, timers)

    persistence.schedule({ skipSeconds: 5 })
    persistence.schedule({ skipSeconds: 6 })
    persistence.schedule({ rightClickTogglePause: false })
    expect(write).not.toHaveBeenCalled()
    expect(timers.pendingCount()).toBe(1)

    timers.flush()

    expect(write).toHaveBeenCalledTimes(1)
    expect(write).toHaveBeenCalledWith({ skipSeconds: 6, rightClickTogglePause: false })
  })

  it('flush() writes the pending merged patch immediately, bypassing the timer', async () => {
    const timers = fakeTimers()
    const write = vi.fn().mockResolvedValue(settingsResult)
    const persistence = createSettingsPersistence(write, timers)

    persistence.schedule({ skipSeconds: 9 })
    await persistence.flush()

    expect(write).toHaveBeenCalledTimes(1)
    expect(write).toHaveBeenCalledWith({ skipSeconds: 9 })
    expect(timers.pendingCount()).toBe(0)
  })

  it('flush() resolves without writing when nothing is pending', async () => {
    const timers = fakeTimers()
    const write = vi.fn().mockResolvedValue(settingsResult)
    const persistence = createSettingsPersistence(write, timers)

    await persistence.flush()

    expect(write).not.toHaveBeenCalled()
  })

  it('a slow older write cannot resolve after and stomp a newer flush', async () => {
    const timers = fakeTimers()
    const first = deferred<PlayerSettings>()
    const second = deferred<PlayerSettings>()
    const write = vi.fn().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
    const persistence = createSettingsPersistence(write, timers)

    persistence.schedule({ skipSeconds: 1 })
    const flushA = persistence.flush()
    expect(write).toHaveBeenCalledTimes(1)

    // Newer patch scheduled+flushed while the older write is still in flight.
    persistence.schedule({ skipSeconds: 2 })
    const flushB = persistence.flush()
    // The second write must not be dispatched until the first settles.
    expect(write).toHaveBeenCalledTimes(1)

    first.resolve(settingsResult)
    await flushA

    expect(write).toHaveBeenCalledTimes(2)
    expect(write).toHaveBeenLastCalledWith({ skipSeconds: 2 })

    second.resolve(settingsResult)
    await flushB
  })

  it('a rejected write does not poison a later save', async () => {
    const timers = fakeTimers()
    const write = vi
      .fn()
      .mockRejectedValueOnce(new Error('disk full'))
      .mockResolvedValueOnce(settingsResult)
    const persistence = createSettingsPersistence(write, timers)

    persistence.schedule({ skipSeconds: 3 })
    await expect(persistence.flush()).resolves.toBeUndefined()

    persistence.schedule({ skipSeconds: 4 })
    await expect(persistence.flush()).resolves.toBeUndefined()

    expect(write).toHaveBeenCalledTimes(2)
    expect(write).toHaveBeenLastCalledWith({ skipSeconds: 4 })
  })

  it('cancel() drops pending work without writing', () => {
    const timers = fakeTimers()
    const write = vi.fn().mockResolvedValue(settingsResult)
    const persistence = createSettingsPersistence(write, timers)

    persistence.schedule({ skipSeconds: 7 })
    persistence.cancel()
    expect(timers.pendingCount()).toBe(0)
    timers.flush()

    expect(write).not.toHaveBeenCalled()
  })
})
