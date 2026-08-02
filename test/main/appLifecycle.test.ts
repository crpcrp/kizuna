import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createQuitCoordinator,
  SHUTDOWN_TIMEOUT_MS,
  type PreventableQuitEvent,
  type QuitHandler
} from '@src/main/appLifecycle'

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

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

function quitEvent(): PreventableQuitEvent & { preventDefault: ReturnType<typeof vi.fn> } {
  return { preventDefault: vi.fn() } as unknown as PreventableQuitEvent & {
    preventDefault: ReturnType<typeof vi.fn>
  }
}

function makeFixture(appQuit?: () => void) {
  const calls: string[] = []
  const cleanup = deferred<void>()
  const controllerQuit = deferred<void>()
  const errors: Array<{ operation: string; error: unknown }> = []
  const session = { flushStorageData: vi.fn(() => calls.push('flush')) }
  const controller = {
    quit: vi.fn(() => {
      calls.push('quit')
      return controllerQuit.promise
    }),
    dispose: vi.fn(() => calls.push('dispose'))
  }
  const handler = createQuitCoordinator({
    defaultSession: session,
    controller,
    flushHistory: vi.fn(() => calls.push('history')),
    releasePowerSave: vi.fn(() => calls.push('power')),
    disposeSystemMedia: vi.fn(() => calls.push('systemMedia')),
    cleanupUrlSubtitles: vi.fn(() => {
      calls.push('urlSubs')
      return cleanup.promise
    }),
    appQuit: vi.fn(appQuit),
    onError: (operation, error) => errors.push({ operation, error })
  })
  return { calls, cleanup, controllerQuit, controller, errors, handler }
}

describe('createQuitCoordinator', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('prevents the first quit and runs synchronous cleanup in order', async () => {
    const fixture = makeFixture()
    const event = quitEvent()

    fixture.handler(event)

    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(fixture.calls).toEqual(['systemMedia', 'power', 'urlSubs', 'history', 'flush', 'quit'])

    fixture.cleanup.resolve()
    fixture.controllerQuit.resolve()
    await flushMicrotasks()

    expect(fixture.controller.dispose).not.toHaveBeenCalled()
  })

  it('waits for both asynchronous cleanup operations before calling app.quit', async () => {
    const appQuit = vi.fn()
    const fixture = makeFixture(appQuit)
    const event = quitEvent()

    fixture.handler(event)
    fixture.cleanup.resolve()
    await flushMicrotasks()
    expect(appQuit).not.toHaveBeenCalled()

    fixture.controllerQuit.resolve()
    await flushMicrotasks()
    expect(appQuit).toHaveBeenCalledOnce()
  })

  it('continues after URL-subtitle cleanup rejects and waits for controller quit', async () => {
    const fixture = makeFixture()
    const event = quitEvent()
    const error = new Error('cache cleanup failed')

    fixture.handler(event)
    fixture.cleanup.reject(error)
    await flushMicrotasks()
    expect(fixture.controller.quit).toHaveBeenCalledOnce()
    expect(fixture.errors).toHaveLength(0)

    fixture.controllerQuit.resolve()
    await flushMicrotasks()
    expect(fixture.errors).toEqual([{ operation: 'URL-subtitle cleanup', error }])
  })

  it('continues after controller quit rejects and waits for URL cleanup', async () => {
    const fixture = makeFixture()
    const event = quitEvent()
    const error = new Error('mpv quit failed')

    fixture.handler(event)
    fixture.controllerQuit.reject(error)
    await flushMicrotasks()
    expect(fixture.errors).toHaveLength(0)

    fixture.cleanup.resolve()
    await flushMicrotasks()
    expect(fixture.errors).toEqual([{ operation: 'mpv quit', error }])
  })

  it('forces disposal and proceeds when controller quit reaches the deadline', async () => {
    const appQuit = vi.fn()
    const fixture = makeFixture(appQuit)
    const event = quitEvent()

    fixture.handler(event)
    fixture.cleanup.resolve()
    await vi.advanceTimersByTimeAsync(SHUTDOWN_TIMEOUT_MS)

    expect(fixture.controller.dispose).toHaveBeenCalledOnce()
    expect(appQuit).toHaveBeenCalledOnce()

    // A late controller settlement must not trigger a second hard dispose or quit.
    fixture.controllerQuit.resolve()
    await flushMicrotasks()
    expect(fixture.controller.dispose).toHaveBeenCalledOnce()
    expect(appQuit).toHaveBeenCalledOnce()
  })

  it('prevents repeated quit requests without repeating cleanup', async () => {
    const fixture = makeFixture()
    const firstEvent = quitEvent()
    const secondEvent = quitEvent()

    fixture.handler(firstEvent)
    fixture.handler(secondEvent)

    expect(firstEvent.preventDefault).toHaveBeenCalledOnce()
    expect(secondEvent.preventDefault).toHaveBeenCalledOnce()
    expect(fixture.calls).toEqual(['systemMedia', 'power', 'urlSubs', 'history', 'flush', 'quit'])
    expect(fixture.controller.quit).toHaveBeenCalledOnce()

    fixture.cleanup.resolve()
    fixture.controllerQuit.resolve()
    await flushMicrotasks()
  })

  it('allows the re-entrant event from app.quit without repeating cleanup', async () => {
    const reentrantEvent = quitEvent()
    const handlerRef: { current?: QuitHandler } = {}
    const appQuit = vi.fn(() => handlerRef.current?.(reentrantEvent))
    const fixture = makeFixture(appQuit)
    handlerRef.current = fixture.handler

    fixture.handler(quitEvent())
    fixture.cleanup.resolve()
    fixture.controllerQuit.resolve()
    await flushMicrotasks()

    expect(appQuit).toHaveBeenCalledOnce()
    expect(reentrantEvent.preventDefault).not.toHaveBeenCalled()
    expect(fixture.controller.quit).toHaveBeenCalledOnce()
    expect(fixture.calls).toEqual(['systemMedia', 'power', 'urlSubs', 'history', 'flush', 'quit'])
  })

  it('observes rejected shutdown promises without leaving unhandled rejections', async () => {
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    try {
      const fixture = makeFixture()
      fixture.handler(quitEvent())
      fixture.cleanup.reject(new Error('cleanup failed'))
      fixture.controllerQuit.reject(new Error('quit failed'))
      await flushMicrotasks()
      expect(fixture.errors).toHaveLength(2)
      expect(unhandled).not.toHaveBeenCalled()
    } finally {
      process.off('unhandledRejection', unhandled)
    }
  })
})
