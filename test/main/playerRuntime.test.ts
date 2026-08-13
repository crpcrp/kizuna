import { describe, expect, it, vi } from 'vitest'
import {
  createPlayerRuntime,
  type PlayerRuntimeDeps,
  type PlayerRuntimeBridgeServices
} from '@src/main/playerRuntime'

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T | PromiseLike<T>) => void
  reject: (reason?: unknown) => void
} {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

function makeDeps(overrides: Partial<PlayerRuntimeDeps> = {}): {
  deps: PlayerRuntimeDeps
  startMpv: ReturnType<typeof vi.fn>
  createPowerSave: ReturnType<typeof vi.fn>
  createSystemMedia: ReturnType<typeof vi.fn>
  createScreenshots: ReturnType<typeof vi.fn>
  createFrames: ReturnType<typeof vi.fn>
  registerBridge: ReturnType<typeof vi.fn>
  markPlayerReady: ReturnType<typeof vi.fn>
  markPlayerFailed: ReturnType<typeof vi.fn>
  markMpv: ReturnType<typeof vi.fn>
  warn: ReturnType<typeof vi.fn>
  powerSave: { update: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }
  systemMedia: { update: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }
} {
  const startMpv = vi.fn(async () => {})
  const powerSave = { update: vi.fn(), dispose: vi.fn() }
  const systemMedia = { update: vi.fn(), dispose: vi.fn() }
  const createPowerSave = vi.fn(() => powerSave)
  const createSystemMedia = vi.fn(() => systemMedia)
  const createScreenshots = vi.fn(() => ({ capture: vi.fn(async () => 'screenshot.png') }))
  const createFrames = vi.fn(() => ({ captureFrameData: vi.fn(async () => 'frame') }))
  const registerBridge = vi.fn((_services: PlayerRuntimeBridgeServices) => {})
  const markPlayerReady = vi.fn()
  const markPlayerFailed = vi.fn()
  const markMpv = vi.fn()
  const warn = vi.fn()
  const deps: PlayerRuntimeDeps = {
    startMpv,
    createPowerSave,
    createSystemMedia,
    createScreenshots,
    createFrames,
    registerBridge,
    launchPathBuffer: { markPlayerReady, markPlayerFailed },
    startupProbe: { mark: markMpv },
    warn,
    ...overrides
  }
  return {
    deps,
    startMpv,
    createPowerSave,
    createSystemMedia,
    createScreenshots,
    createFrames,
    registerBridge,
    markPlayerReady,
    markPlayerFailed,
    markMpv,
    warn,
    powerSave,
    systemMedia
  }
}

describe('createPlayerRuntime', () => {
  it('coalesces concurrent starts and keeps the ready result stable', async () => {
    const start = deferred<void>()
    const startMpv = vi.fn(() => start.promise)
    const fixture = makeDeps({ startMpv })
    const runtime = createPlayerRuntime(fixture.deps)

    expect(runtime.getState()).toBe('not-started')
    const first = runtime.ensureStarted()
    const second = runtime.ensureStarted()

    expect(first).toBe(second)
    expect(runtime.getState()).toBe('starting')
    expect(startMpv).toHaveBeenCalledOnce()

    start.resolve()
    await expect(first).resolves.toBe('ready')

    expect(runtime.getState()).toBe('ready')
    expect(fixture.createPowerSave).toHaveBeenCalledOnce()
    expect(fixture.createSystemMedia).toHaveBeenCalledOnce()
    expect(fixture.createScreenshots).toHaveBeenCalledOnce()
    expect(fixture.createFrames).toHaveBeenCalledOnce()
    expect(fixture.registerBridge).toHaveBeenCalledOnce()
    expect(fixture.markPlayerReady).toHaveBeenCalledOnce()
    expect(fixture.markPlayerFailed).not.toHaveBeenCalled()
    expect(fixture.markMpv).toHaveBeenCalledTimes(1)
    expect(fixture.markMpv).toHaveBeenCalledWith('mpv')

    await expect(runtime.ensureStarted()).resolves.toBe('ready')
    expect(startMpv).toHaveBeenCalledOnce()

    runtime.disposeSystemMedia()
    runtime.releasePowerSave()
    expect(fixture.systemMedia.dispose).toHaveBeenCalledOnce()
    expect(fixture.powerSave.dispose).toHaveBeenCalledOnce()
  })

  it.each([
    [
      'synchronous throw',
      (error: Error) =>
        vi.fn(() => {
          throw error
        })
    ],
    [
      'asynchronous rejection',
      (error: Error) =>
        vi.fn(async () => {
          throw error
        })
    ]
  ])('turns a %s into one stable failed result', async (_label, makeStart) => {
    const error = new Error('mpv missing')
    const startMpv = makeStart(error)
    const fixture = makeDeps({ startMpv })
    const runtime = createPlayerRuntime(fixture.deps)

    const first = runtime.ensureStarted()
    const second = runtime.ensureStarted()

    expect(first).toBe(second)
    await expect(first).resolves.toBe('failed')
    expect(runtime.getState()).toBe('failed')
    expect(fixture.warn).toHaveBeenCalledTimes(1)
    expect(fixture.warn).toHaveBeenCalledWith(error)
    expect(fixture.markPlayerFailed).toHaveBeenCalledOnce()
    expect(fixture.markPlayerReady).not.toHaveBeenCalled()
    expect(fixture.markMpv).not.toHaveBeenCalled()
    expect(fixture.registerBridge).not.toHaveBeenCalled()

    await expect(runtime.ensureStarted()).resolves.toBe('failed')
    expect(startMpv).toHaveBeenCalledOnce()
    expect(fixture.markPlayerFailed).toHaveBeenCalledOnce()
  })

  it('is safe to clean up before a lazy start', () => {
    const fixture = makeDeps()
    const runtime = createPlayerRuntime(fixture.deps)

    expect(() => {
      runtime.disposeSystemMedia()
      runtime.releasePowerSave()
    }).not.toThrow()
    expect(fixture.startMpv).not.toHaveBeenCalled()
  })

  it('marks failure when post-start composition throws', async () => {
    const error = new Error('bridge failed')
    const fixture = makeDeps({
      registerBridge: vi.fn(() => {
        throw error
      })
    })
    const runtime = createPlayerRuntime(fixture.deps)

    await expect(runtime.ensureStarted()).resolves.toBe('failed')

    expect(runtime.getState()).toBe('failed')
    expect(fixture.warn).toHaveBeenCalledTimes(1)
    expect(fixture.warn).toHaveBeenCalledWith(error)
    expect(fixture.markPlayerReady).not.toHaveBeenCalled()
    expect(fixture.markPlayerFailed).toHaveBeenCalledOnce()
    expect(fixture.markMpv).not.toHaveBeenCalled()
  })
})
