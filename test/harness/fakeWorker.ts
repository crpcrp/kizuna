// Lets tests drive createWorkerImporter's message/error/exit paths directly.

import type {
  WorkerFactory,
  WorkerLike,
  WorkerImportMessage
} from '../../src/main/services/dict/workerImporter'
import type { ImportWorkerInput } from '../../src/main/services/dict/importWorker'

export interface FakeWorker extends WorkerLike {
  terminated: boolean
  emitMessage(msg: WorkerImportMessage): void
  emitError(err: Error): void
  emitExit(code: number): void
}

export interface FakeWorkerFactory {
  factory: WorkerFactory
  calls: Array<{ workerPath: string; workerData: ImportWorkerInput }>
  workers: FakeWorker[]
}

export function fakeWorkerFactory(): FakeWorkerFactory {
  const calls: Array<{ workerPath: string; workerData: ImportWorkerInput }> = []
  const workers: FakeWorker[] = []

  const factory: WorkerFactory = (workerPath, workerData) => {
    calls.push({ workerPath, workerData })

    let messageListener: ((msg: WorkerImportMessage) => void) | undefined
    let errorListener: ((err: Error) => void) | undefined
    let exitListener: ((code: number) => void) | undefined

    const worker: FakeWorker = {
      terminated: false,
      on: (event: 'message' | 'error' | 'exit', listener: (arg: never) => void) => {
        if (event === 'message') messageListener = listener as (msg: WorkerImportMessage) => void
        else if (event === 'error') errorListener = listener as (err: Error) => void
        else exitListener = listener as (code: number) => void
      },
      terminate: () => {
        worker.terminated = true
      },
      emitMessage: (msg) => messageListener?.(msg),
      emitError: (err) => errorListener?.(err),
      emitExit: (code) => exitListener?.(code)
    }
    workers.push(worker)
    return worker
  }

  return { factory, calls, workers }
}
