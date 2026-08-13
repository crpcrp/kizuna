// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PLAYER_SETTINGS, type PlayerSettings } from '@src/shared/playerSettings'
import { initialPlayerState, type PlayerState } from '@src/renderer/src/state/playerState'
import {
  useSettingsLifecycle,
  type UseSettingsLifecycleInput
} from '@src/renderer/src/state/useSettingsLifecycle'
import { createSettingsPersistence } from '@src/renderer/src/state/settingsPersistence'
import type { TimerLike } from '@src/renderer/src/state/settingsPersistence'
import {
  selectLoadedRendererSettings,
  type SyncedSettingKey
} from '@src/renderer/src/state/rendererSettings'

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
      callbacks.forEach((callback) => callback())
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

type SettingsTestState = Pick<PlayerState, SyncedSettingKey>

function setup(): {
  input: UseSettingsLifecycleInput
  settingsGate: ReturnType<typeof deferred<PlayerSettings>>
  settingsWriter: ReturnType<typeof vi.fn>
  timers: ReturnType<typeof fakeTimers>
  dispatch: ReturnType<typeof vi.fn>
  setSidebarOpen: ReturnType<typeof vi.fn>
  setPlaylistOpen: ReturnType<typeof vi.fn>
  reportError: ReturnType<typeof vi.fn>
  hook: {
    result: { current: boolean }
    rerender(props: { lifecycle: UseSettingsLifecycleInput }): void
    unmount(): void
  }
  rerender(settings: SettingsTestState): void
} {
  const settingsGate = deferred<PlayerSettings>()
  const settingsWriter = vi.fn().mockResolvedValue(DEFAULT_PLAYER_SETTINGS)
  const timers = fakeTimers()
  const dispatch = vi.fn()
  const setSidebarOpen = vi.fn()
  const setPlaylistOpen = vi.fn()
  const reportError = vi.fn()
  const input: UseSettingsLifecycleInput = {
    dispatch,
    bridge: { getSettings: vi.fn().mockReturnValue(settingsGate.promise) },
    settingsPersistenceRef: {
      current: createSettingsPersistence(settingsWriter, timers)
    },
    settings: initialPlayerState,
    subtitleOffsetsRef: { current: {} },
    folderSubtitleOffsetsRef: { current: {} },
    audioDelaysRef: { current: {} },
    videoAdjustmentsRef: { current: initialPlayerState.videoAdjustments },
    setSidebarOpen,
    setPlaylistOpen,
    reportError
  }
  const hook = renderHook(
    ({ lifecycle }: { lifecycle: UseSettingsLifecycleInput }) => useSettingsLifecycle(lifecycle),
    { initialProps: { lifecycle: input } }
  )

  return {
    input,
    settingsGate,
    settingsWriter,
    timers,
    dispatch,
    setSidebarOpen,
    setPlaylistOpen,
    reportError,
    hook,
    rerender(settings) {
      input.settings = settings
      hook.rerender({ lifecycle: input })
    }
  }
}

async function hydrate(
  settingsGate: ReturnType<typeof deferred<PlayerSettings>>,
  settings: PlayerSettings = DEFAULT_PLAYER_SETTINGS
): Promise<void> {
  await act(async () => {
    settingsGate.resolve(settings)
    await settingsGate.promise
    await Promise.resolve()
  })
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('useSettingsLifecycle', () => {
  it('hydrates settings, mirrors map values, and marks the lifecycle ready', async () => {
    const setupResult = setup()
    const loaded = {
      ...DEFAULT_PLAYER_SETTINGS,
      sidebarOpen: true,
      playlistOpen: true,
      subtitleOffsets: { '/video.mkv': 250 },
      folderSubtitleOffsets: { '/video': 500 },
      audioDelays: { '/video.mkv': -125 }
    }

    expect(setupResult.hook.result.current).toBe(false)
    await hydrate(setupResult.settingsGate, loaded)

    expect(setupResult.dispatch).toHaveBeenCalledWith({
      type: 'loadSettings',
      settings: selectLoadedRendererSettings(loaded)
    })
    expect(setupResult.input.subtitleOffsetsRef.current).toEqual(loaded.subtitleOffsets)
    expect(setupResult.input.folderSubtitleOffsetsRef.current).toEqual(loaded.folderSubtitleOffsets)
    expect(setupResult.input.audioDelaysRef.current).toEqual(loaded.audioDelays)
    expect(setupResult.setSidebarOpen).toHaveBeenCalledWith(true)
    expect(setupResult.setPlaylistOpen).toHaveBeenCalledWith(true)
    expect(setupResult.hook.result.current).toBe(true)
  })

  it('does not save before hydration and skips the hydrated save pass', async () => {
    const setupResult = setup()

    expect(setupResult.settingsWriter).not.toHaveBeenCalled()
    await hydrate(setupResult.settingsGate)
    setupResult.timers.flush()

    expect(setupResult.settingsWriter).not.toHaveBeenCalled()
  })

  it('coalesces post-ready settings changes through the existing persistence coordinator', async () => {
    const setupResult = setup()
    await hydrate(setupResult.settingsGate)

    setupResult.rerender({ ...initialPlayerState, skipSeconds: 6 })
    setupResult.rerender({ ...initialPlayerState, skipSeconds: 7 })
    expect(setupResult.timers.pendingCount()).toBe(1)

    setupResult.timers.flush()
    await Promise.resolve()

    expect(setupResult.settingsWriter).toHaveBeenCalledOnce()
    expect(setupResult.settingsWriter).toHaveBeenCalledWith({ skipSeconds: 7 })
  })

  it('swallows a save failure and allows the next save to proceed', async () => {
    const setupResult = setup()
    await hydrate(setupResult.settingsGate)
    setupResult.settingsWriter.mockRejectedValueOnce(new Error('disk full'))

    setupResult.rerender({ ...initialPlayerState, skipSeconds: 8 })
    setupResult.timers.flush()
    await Promise.resolve()
    setupResult.rerender({ ...initialPlayerState, skipSeconds: 9 })
    await act(async () => {
      await setupResult.input.settingsPersistenceRef.current.flush()
    })

    expect(setupResult.settingsWriter).toHaveBeenCalledTimes(2)
    expect(setupResult.settingsWriter).toHaveBeenLastCalledWith({ skipSeconds: 9 })
  })

  it('flushes the latest pending state exactly once on unmount', async () => {
    const setupResult = setup()
    await hydrate(setupResult.settingsGate)
    setupResult.rerender({ ...initialPlayerState, skipSeconds: 10 })

    await act(async () => {
      setupResult.hook.unmount()
      await Promise.resolve()
    })

    expect(setupResult.settingsWriter).toHaveBeenCalledOnce()
    expect(setupResult.settingsWriter).toHaveBeenCalledWith({ skipSeconds: 10 })
    expect(setupResult.timers.pendingCount()).toBe(0)
  })

  it('ignores stale hydration after unmount', async () => {
    const setupResult = setup()
    setupResult.hook.unmount()

    await hydrate(setupResult.settingsGate)

    expect(setupResult.dispatch).not.toHaveBeenCalled()
    expect(setupResult.setSidebarOpen).not.toHaveBeenCalled()
    expect(setupResult.reportError).not.toHaveBeenCalled()
  })
})
