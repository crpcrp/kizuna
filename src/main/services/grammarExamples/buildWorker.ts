import { parentPort, workerData } from 'node:worker_threads'
import { buildExamplesDatabase, type BuildInput } from './build'

export type BuildWorkerMessage =
  | { type: 'progress'; percent: number }
  | { type: 'result'; count: number }
  | { type: 'error'; error: string }

if (parentPort) {
  const port = parentPort
  const post = (message: BuildWorkerMessage): void => port.postMessage(message)
  buildExamplesDatabase(workerData as BuildInput, {
    onProgress: (percent) => post({ type: 'progress', percent })
  }).then(
    (count) => post({ type: 'result', count }),
    (err: unknown) =>
      post({ type: 'error', error: err instanceof Error ? err.message : String(err) })
  )
}
