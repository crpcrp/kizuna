// Durable media history (recents, resume positions, track selections) kept in
// its own playback-history.json so frequent progress saves never rewrite
// settings.json. Writes are asynchronous and serialized through one queue.

import {
  normalizeMediaHistory,
  type MediaHistory,
  type PathNormalizationOptions
} from '../../shared/mediaHistory'
import { isRecord } from '../../shared/guards'

export interface MediaHistoryIO {
  read(): string | undefined
  write(contents: string): Promise<void>
}

export interface MediaHistoryFileSystem {
  readFileSync(path: string, encoding: 'utf-8'): string
  promises: {
    writeFile(path: string, contents: string, encoding: 'utf-8'): Promise<void>
    rename(from: string, to: string): Promise<void>
    unlink(path: string): Promise<void>
  }
}

export interface MediaHistoryStore {
  get(): MediaHistory
  /** Replaces the in-memory history and queues a write. Never throws. */
  set(history: MediaHistory): void
  /** Resolves once everything set so far was written, or the write failed (kept for retry). */
  flush(): Promise<void>
}

export interface MediaHistoryStoreOptions extends PathNormalizationOptions {
  /** Raw pre-split `settings.mediaHistory`, read only when no history file exists yet. */
  legacy?: () => unknown
  /** Called once per run of consecutive write failures. Defaults to `console.warn`. */
  onWriteError?: (error: unknown) => void
}

/** Atomic file boundary: write a sibling temp file, then rename it over the target. */
export function createMediaHistoryFile(path: string, fs: MediaHistoryFileSystem): MediaHistoryIO {
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

/** Extracts the legacy `mediaHistory` key from raw settings.json text. */
export function legacyMediaHistory(settingsText: string | undefined): unknown {
  const parsed = safeParse(settingsText)
  return isRecord(parsed) ? parsed.mediaHistory : undefined
}

function defaultOnWriteError(error: unknown): void {
  console.warn('[kizuna] failed to save playback history; will retry', error)
}

export function createMediaHistoryStore(
  io: MediaHistoryIO,
  options: MediaHistoryStoreOptions = {}
): MediaHistoryStore {
  const { legacy, onWriteError = defaultOnWriteError, ...pathOptions } = options
  const stored = safeParse(io.read())
  const migrating = stored === undefined && legacy !== undefined
  let current = normalizeMediaHistory(migrating ? legacy() : stored, pathOptions)
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

  if (migrating) {
    dirty = true
    void save()
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
