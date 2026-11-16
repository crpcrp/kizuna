// Import in a worker so unzip, JSON parsing, and SQLite writes cannot block the main loop.

import type { ImportResult } from '../../../shared/dictionary'
import type { DictionaryImporter, DictZipSource } from './importer'
import type { ImportWorkerInput } from './importWorker'

export type WorkerImportMessage =
  | { type: 'progress'; done: number; total: number }
  | { type: 'result'; result: ImportResult }
  | { type: 'error'; error: string }

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
  dbPath: string
  /** Path to the compiled worker entry (importWorker.ts's build output). */
  workerPath: string
  createWorker: WorkerFactory
  /** Maximum silence between progress reports, not an absolute import deadline. */
  timeoutMs?: number
  timers?: WorkerImportTimers
}

const WORKER_IMPORT_TIMEOUT_MS = 5 * 60 * 1000

const systemTimers: WorkerImportTimers = {
  setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
}

function runOne(
  zip: DictZipSource,
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
    const worker = createWorker(
      workerPath,
      typeof zip === 'string' ? { dbPath, zipPath: zip } : { dbPath, zipBytes: zip }
    )

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

    // Reset on progress: large dictionaries can take minutes without being hung.
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

/** Serialize imports so workers never race writes to the same database. */
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
    zip: DictZipSource,
    onProgress?: (done: number, total: number) => void
  ): Promise<ImportResult> {
    busy = true
    const result = runOne(zip, dbPath, workerPath, createWorker, timeoutMs, timers, onProgress)
    const clearBusy = (): void => {
      busy = false
    }
    result.then(clearBusy, clearBusy)
    return result
  }

  return {
    import(
      zip: DictZipSource,
      onProgress?: (done: number, total: number) => void
    ): Promise<ImportResult> {
      const result = busy ? queue.then(() => start(zip, onProgress)) : start(zip, onProgress)
      // Keep the queue alive even if this import rejects, so a later import
      // still runs instead of getting stuck behind a rejected promise.
      queue = result.catch(() => undefined)
      return result
    }
  }
}
