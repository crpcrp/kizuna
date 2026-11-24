// Durable media history (recents, resume positions, track selections) kept in
// its own playback-history.json so frequent progress saves never rewrite
// settings.json. Writes are asynchronous and serialized through one queue.

import fs from 'node:fs'
import {
  normalizeMediaHistory,
  type MediaHistory,
  type PathNormalizationOptions
} from '../../shared/mediaHistory'

export interface MediaHistoryIO {
  read(): string | undefined
  write(contents: string): Promise<void>
}

export interface MediaHistoryStore {
  get(): MediaHistory
  /** Replaces the in-memory history and queues a write. Never throws. */
  set(history: MediaHistory): void
  /** Resolves once everything set so far was written, or the write failed (kept for retry). */
  flush(): Promise<void>
}

export interface MediaHistoryStoreOptions extends PathNormalizationOptions {
  /** Called once per run of consecutive write failures. Defaults to `console.warn`. */
  onWriteError?: (error: unknown) => void
}

/** Atomic file boundary: write a sibling temp file, then rename it over the target. */
export function createMediaHistoryFile(path: string): MediaHistoryIO {
  const temporaryPath = `${path}.tmp`
  return {
    read(): string | undefined {
      try {
        return fs.readFileSync(path, 'utf-8')
      } catch {
        return undefined
      }
    },
    async write(contents: string): Promise<void> {
      try {
        await fs.promises.writeFile(temporaryPath, contents, 'utf-8')
        await fs.promises.rename(temporaryPath, path)
      } catch (error) {
        await fs.promises.unlink(temporaryPath).catch(() => {})
        throw error
      }
    }
  }
}

function defaultOnWriteError(error: unknown): void {
  console.warn('[kizuna] failed to save playback history; will retry', error)
}

export function createMediaHistoryStore(
  io: MediaHistoryIO,
  options: MediaHistoryStoreOptions = {}
): MediaHistoryStore {
  const { onWriteError = defaultOnWriteError, ...pathOptions } = options
  let current = normalizeMediaHistory(safeParse(io.read()), pathOptions)
  let dirty = false
  let queued = false
  let queue: Promise<void> = Promise.resolve()
  let failureReported = false

  function save(): Promise<void> {
    if (queued) return queue
    queued = true
    queue = queue.then(async () => {
      queued = false
      if (!dirty) return
      dirty = false
      try {
        await io.write(JSON.stringify(current))
        failureReported = false
      } catch (error) {
        dirty = true
        if (!failureReported) {
          failureReported = true
          try {
            onWriteError(error)
          } catch {
            // Reporting must never reject the queue.
          }
        }
      }
    })
    return queue
  }

  return {
    get: () => current,
    set(history: MediaHistory): void {
      current = history
      dirty = true
      void save()
    },
    flush: save
  }
}

function safeParse(text: string | undefined): unknown {
  if (text === undefined) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}
