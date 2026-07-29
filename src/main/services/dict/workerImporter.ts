// Priority 8.2 — worker-backed `DictionaryImporter`. Runs each import in its
// own node:worker_threads Worker (see importWorker.ts) so the unzip/parse/
// insert transaction never blocks the Electron main loop. Worker creation is
// injected as a `WorkerFactory` so tests never launch a real worker
// (AGENTS.md law 3) — see test/harness/fakeWorker.ts.

import type { ImportResult } from '../../../shared/dictionary'
import type { DictionaryImporter } from './importer'
import type { ImportWorkerInput } from './importWorker'

export type WorkerImportMessage =
  | { type: 'progress'; done: number; total: number }
  | { type: 'result'; result: ImportResult }
  | { type: 'error'; error: string }

/** Structural subset of node:worker_threads' Worker this module needs. */
export interface WorkerLike {
  on(event: 'message', listener: (value: WorkerImportMessage) => void): void
  on(event: 'error', listener: (err: Error) => void): void
  on(event: 'exit', listener: (code: number) => void): void
  terminate(): unknown
}

export type WorkerFactory = (workerPath: string, workerData: ImportWorkerInput) => WorkerLike

export interface WorkerImportTimers {
  setTimer(callback: () => void, delayMs: number): unknown
  clearTimer(handle: unknown): void
}

export interface CreateWorkerImporterDeps {
  /** Path to the dictionary SQLite file the worker should open. */
  dbPath: string
  /** Path to the compiled worker entry (importWorker.ts's build output). */
  workerPath: string
  createWorker: WorkerFactory
  /**
   * How long the worker may go **without reporting progress** before it is
   * given up on. Defaults to five minutes. This is an inactivity watchdog, not
   * an absolute deadline — see `runOne`.
   */
  timeoutMs?: number
  timers?: WorkerImportTimers
}

/**
 * Silence allowed between two progress reports before the import is considered
 * hung. A large dictionary legitimately takes minutes of wall clock; what it
 * never does is go five minutes without inflating another few MiB.
 */
export const WORKER_IMPORT_TIMEOUT_MS = 5 * 60 * 1000

const systemTimers: WorkerImportTimers = {
  setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
}

function runOne(
  zipBytes: Uint8Array,
  dbPath: string,
  workerPath: string,
  createWorker: WorkerFactory,
  timeoutMs: number,
  timers: WorkerImportTimers,
  onProgress?: (done: number, total: number) => void
): Promise<ImportResult> {
  return new Promise<ImportResult>((resolve, reject) => {
    let settled = false
    const timer = { handle: undefined as unknown }
    const worker = createWorker(workerPath, { dbPath, zipBytes })

    const finish = (): void => {
      if (timer.handle !== undefined) timers.clearTimer(timer.handle)
      worker.terminate()
    }
    const settleResolve = (result: ImportResult): void => {
      if (settled) return
      settled = true
      finish()
      resolve(result)
    }
    const settleReject = (err: Error): void => {
      if (settled) return
      settled = true
      finish()
      reject(err)
    }

    // Inactivity watchdog: armed once, then re-armed on every progress report,
    // so `timeoutMs` bounds how long the import may go *silent* rather than how
    // long it may take in total. As an absolute deadline this killed imports
    // that were making steady progress — a large dictionary is minutes of
    // honest work — and killing one mid-transaction leaves its rolled-back
    // pages behind as permanent freelist bloat in dict.db.
    const armWatchdog = (): void => {
      if (settled) return
      if (timer.handle !== undefined) timers.clearTimer(timer.handle)
      timer.handle = timers.setTimer(
        () =>
          settleReject(
            new Error(`Dictionary import worker reported no progress for ${timeoutMs}ms`)
          ),
        timeoutMs
      )
    }

    worker.on('message', (msg) => {
      if (msg.type === 'progress') {
        armWatchdog()
        onProgress?.(msg.done, msg.total)
      } else if (msg.type === 'result') settleResolve(msg.result)
      else settleReject(new Error(msg.error))
    })
    worker.on('error', settleReject)
    worker.on('exit', (code) => {
      if (code !== 0) settleReject(new Error(`Dictionary import worker exited with code ${code}`))
    })
    armWatchdog()
  })
}

/**
 * Worker-thread-backed DictionaryImporter. Imports are serialized — only one
 * worker runs at a time, later calls queue behind earlier ones — so two
 * imports never race writes against the same dictionary DB file. The first
 * call (nothing in flight) starts its worker synchronously; later calls wait
 * for `queue` to settle, success or failure, before starting theirs.
 */
export function createWorkerImporter(deps: CreateWorkerImporterDeps): DictionaryImporter {
  const {
    dbPath,
    workerPath,
    createWorker,
    timeoutMs = WORKER_IMPORT_TIMEOUT_MS,
    timers = systemTimers
  } = deps
  let queue: Promise<unknown> = Promise.resolve()
  let busy = false

  function start(
    zipBytes: Uint8Array,
    onProgress?: (done: number, total: number) => void
  ): Promise<ImportResult> {
    busy = true
    const result = runOne(zipBytes, dbPath, workerPath, createWorker, timeoutMs, timers, onProgress)
    const clearBusy = (): void => {
      busy = false
    }
    result.then(clearBusy, clearBusy)
    return result
  }

  return {
    import(
      zipBytes: Uint8Array,
      onProgress?: (done: number, total: number) => void
    ): Promise<ImportResult> {
      const result = busy
        ? queue.then(() => start(zipBytes, onProgress))
        : start(zipBytes, onProgress)
      // Keep the queue alive even if this import rejects, so a later import
      // still runs instead of getting stuck behind a rejected promise.
      queue = result.catch(() => undefined)
      return result
    }
  }
}
