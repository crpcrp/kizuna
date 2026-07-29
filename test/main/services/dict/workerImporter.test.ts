import { describe, it, expect, vi } from 'vitest'
import {
  createWorkerImporter,
  type WorkerImportTimers
} from '@src/main/services/dict/workerImporter'
import { fakeWorkerFactory } from '@test/harness/fakeWorker'

const RESULT = { dictId: 1, termCount: 6, metaCount: 0 }

function fakeTimers(): {
  timers: WorkerImportTimers
  fire: () => void
  clearTimer: ReturnType<typeof vi.fn>
} {
  let callback: (() => void) | undefined
  const clearTimer = vi.fn((_handle: unknown) => undefined)
  return {
    timers: {
      setTimer: (next) => {
        callback = next
        return callback
      },
      clearTimer
    },
    fire: () => callback?.(),
    clearTimer
  }
}

describe('createWorkerImporter', () => {
  it('creates a worker with the db path and zip bytes, resolves on a success message, and terminates', async () => {
    const { factory, calls, workers } = fakeWorkerFactory()
    const importer = createWorkerImporter({
      dbPath: '/data/dict.db',
      workerPath: '/worker.js',
      createWorker: factory
    })

    const zipBytes = new Uint8Array([1, 2, 3])
    const pending = importer.import(zipBytes)
    expect(calls).toEqual([
      { workerPath: '/worker.js', workerData: { dbPath: '/data/dict.db', zipBytes } }
    ])

    workers[0].emitMessage({ type: 'result', result: RESULT })
    await expect(pending).resolves.toEqual(RESULT)
    expect(workers[0].terminated).toBe(true)
  })

  it('rejects on a failure message', async () => {
    const { factory, workers } = fakeWorkerFactory()
    const importer = createWorkerImporter({
      dbPath: '/d.db',
      workerPath: '/w.js',
      createWorker: factory
    })

    const pending = importer.import(new Uint8Array())
    workers[0].emitMessage({ type: 'error', error: 'bad zip' })

    await expect(pending).rejects.toThrow('bad zip')
    expect(workers[0].terminated).toBe(true)
  })

  it('rejects on a worker error event', async () => {
    const { factory, workers } = fakeWorkerFactory()
    const importer = createWorkerImporter({
      dbPath: '/d.db',
      workerPath: '/w.js',
      createWorker: factory
    })

    const pending = importer.import(new Uint8Array())
    workers[0].emitError(new Error('worker crashed'))

    await expect(pending).rejects.toThrow('worker crashed')
    expect(workers[0].terminated).toBe(true)
  })

  it('rejects on a non-zero exit with no prior message', async () => {
    const { factory, workers } = fakeWorkerFactory()
    const importer = createWorkerImporter({
      dbPath: '/d.db',
      workerPath: '/w.js',
      createWorker: factory
    })

    const pending = importer.import(new Uint8Array())
    workers[0].emitExit(1)

    await expect(pending).rejects.toThrow(/exited with code 1/)
  })

  it('settles only once even if message then exit both fire', async () => {
    const { factory, workers } = fakeWorkerFactory()
    const importer = createWorkerImporter({
      dbPath: '/d.db',
      workerPath: '/w.js',
      createWorker: factory
    })

    const pending = importer.import(new Uint8Array())
    workers[0].emitMessage({ type: 'result', result: RESULT })
    workers[0].emitExit(1)

    await expect(pending).resolves.toEqual(RESULT)
  })

  it('serializes imports: the second worker is only created once the first settles', async () => {
    const { factory, workers } = fakeWorkerFactory()
    const importer = createWorkerImporter({
      dbPath: '/d.db',
      workerPath: '/w.js',
      createWorker: factory
    })

    const first = importer.import(new Uint8Array([1]))
    const second = importer.import(new Uint8Array([2]))
    expect(workers.length).toBe(1)

    workers[0].emitMessage({ type: 'result', result: RESULT })
    await first
    await Promise.resolve()
    expect(workers.length).toBe(2)

    workers[1].emitMessage({ type: 'result', result: { dictId: 2, termCount: 1, metaCount: 0 } })
    await expect(second).resolves.toEqual({ dictId: 2, termCount: 1, metaCount: 0 })
  })

  it('still runs a queued import after an earlier one rejects', async () => {
    const { factory, workers } = fakeWorkerFactory()
    const importer = createWorkerImporter({
      dbPath: '/d.db',
      workerPath: '/w.js',
      createWorker: factory
    })

    const first = importer.import(new Uint8Array([1]))
    const second = importer.import(new Uint8Array([2]))
    first.catch(() => undefined)

    workers[0].emitMessage({ type: 'error', error: 'boom' })
    await expect(first).rejects.toThrow('boom')

    await Promise.resolve()
    await Promise.resolve()
    expect(workers.length).toBe(2)
    workers[1].emitMessage({ type: 'result', result: RESULT })
    await expect(second).resolves.toEqual(RESULT)
  })

  it('forwards progress messages to onProgress without settling the import', async () => {
    const { factory, workers } = fakeWorkerFactory()
    const importer = createWorkerImporter({
      dbPath: '/d.db',
      workerPath: '/w.js',
      createWorker: factory
    })
    const onProgress = vi.fn()

    const pending = importer.import(new Uint8Array(), onProgress)
    workers[0].emitMessage({ type: 'progress', done: 500, total: 2000 })
    workers[0].emitMessage({ type: 'progress', done: 1000, total: 2000 })
    workers[0].emitMessage({ type: 'result', result: RESULT })

    await expect(pending).resolves.toEqual(RESULT)
    expect(onProgress).toHaveBeenCalledTimes(2)
    expect(onProgress).toHaveBeenNthCalledWith(1, 500, 2000)
    expect(onProgress).toHaveBeenNthCalledWith(2, 1000, 2000)
  })

  it('rejects and terminates a worker that goes silent for the whole watchdog interval', async () => {
    const { factory, workers } = fakeWorkerFactory()
    const watchdog = fakeTimers()
    const importer = createWorkerImporter({
      dbPath: '/d.db',
      workerPath: '/w.js',
      createWorker: factory,
      timeoutMs: 25,
      timers: watchdog.timers
    })

    const pending = importer.import(new Uint8Array())
    watchdog.fire()

    await expect(pending).rejects.toThrow('reported no progress for 25ms')
    expect(workers[0].terminated).toBe(true)
    expect(watchdog.clearTimer).toHaveBeenCalledTimes(1)
  })

  it('re-arms the watchdog on every progress report, so a long but live import survives', async () => {
    // Steady progress must keep the watchdog alive; killing an import
    // mid-transaction leaves its rolled-back pages behind as
    // freelist bloat. It now bounds silence, not total duration.
    const { factory, workers } = fakeWorkerFactory()
    const watchdog = fakeTimers()
    const importer = createWorkerImporter({
      dbPath: '/d.db',
      workerPath: '/w.js',
      createWorker: factory,
      timeoutMs: 25,
      timers: watchdog.timers
    })

    const pending = importer.import(new Uint8Array())
    // Three progress reports, each well inside the interval, then a result.
    workers[0].emitMessage({ type: 'progress', done: 500, total: 2000 })
    workers[0].emitMessage({ type: 'progress', done: 1000, total: 2000 })
    workers[0].emitMessage({ type: 'progress', done: 1500, total: 2000 })
    // Each report cleared the previous timer before setting a fresh one.
    expect(watchdog.clearTimer).toHaveBeenCalledTimes(3)

    workers[0].emitMessage({ type: 'result', result: RESULT })
    await expect(pending).resolves.toEqual(RESULT)
  })

  it('still rejects when the worker goes silent after making some progress', async () => {
    const { factory, workers } = fakeWorkerFactory()
    const watchdog = fakeTimers()
    const importer = createWorkerImporter({
      dbPath: '/d.db',
      workerPath: '/w.js',
      createWorker: factory,
      timeoutMs: 25,
      timers: watchdog.timers
    })

    const pending = importer.import(new Uint8Array())
    workers[0].emitMessage({ type: 'progress', done: 500, total: 2000 })
    // No further reports: the re-armed timer expires.
    watchdog.fire()

    await expect(pending).rejects.toThrow('reported no progress for 25ms')
    expect(workers[0].terminated).toBe(true)
  })

  it('runs a queued import after the earlier worker times out', async () => {
    const { factory, workers } = fakeWorkerFactory()
    const watchdog = fakeTimers()
    const importer = createWorkerImporter({
      dbPath: '/d.db',
      workerPath: '/w.js',
      createWorker: factory,
      timeoutMs: 25,
      timers: watchdog.timers
    })

    const first = importer.import(new Uint8Array([1]))
    const second = importer.import(new Uint8Array([2]))
    watchdog.fire()
    await expect(first).rejects.toThrow('reported no progress for 25ms')

    await Promise.resolve()
    await Promise.resolve()
    expect(workers).toHaveLength(2)
    workers[1].emitMessage({ type: 'result', result: RESULT })
    await expect(second).resolves.toEqual(RESULT)
    expect(watchdog.clearTimer).toHaveBeenCalledTimes(2)
  })
})
