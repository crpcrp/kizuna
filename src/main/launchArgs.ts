import { basename, resolve } from 'node:path'
import { classifyMediaFileName } from '../shared/mediaFileTypes'

/** First argv entry that names a video file: skips the executable and every
 *  `-`-prefixed flag, requires a video extension (shared list), resolves
 *  relative paths against `cwd`. Undefined when none qualifies. */
function isWindowsAbsolutePath(path: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith('\\\\')
}

function resolveLaunchPath(cwd: string, entry: string): string {
  return isWindowsAbsolutePath(entry) ? entry : resolve(cwd, entry)
}

export function videoPathFromArgv(argv: string[], cwd: string): string | undefined {
  for (const entry of argv.slice(1)) {
    if (entry.startsWith('-')) continue
    if (classifyMediaFileName(basename(entry)) !== 'video') continue
    return resolveLaunchPath(cwd, entry)
  }
  return undefined
}

export interface LaunchPathBuffer {
  /** Queues until both the renderer subscription and player bridge are ready.
   *  Pre-ready, the newest path wins. */
  setPath(path: string): void
  /** Renderer subscribed. Idempotent. */
  markReady(): void
  /** Player IPC bridge registered, so pushed paths can call player.load. Idempotent. */
  markPlayerReady(): void
  /** Player engine failed to start, so a queued launch file can never open.
   *  Surfaces a sanitized error to the renderer instead of silently dropping
   *  the file. Idempotent. */
  markPlayerFailed(): void
}

export function createLaunchPathBuffer(
  deliver: (path: string) => void,
  deliverError?: (message: string) => void
): LaunchPathBuffer {
  let rendererReady = false
  let playerReady = false
  let playerFailed = false
  let pending: string | undefined

  function flush(): void {
    if (!rendererReady) return
    // The engine can't start: a queued launch file will never open, so report
    // it once the renderer can show a banner rather than dropping it silently.
    if (playerFailed) {
      if (pending === undefined) return
      pending = undefined
      deliverError?.('Playback engine failed to start; the file could not be opened.')
      return
    }
    if (!playerReady || pending === undefined) return
    const path = pending
    pending = undefined
    deliver(path)
  }

  return {
    setPath(path) {
      pending = path
      flush()
    },
    markReady() {
      rendererReady = true
      flush()
    },
    markPlayerReady() {
      playerReady = true
      flush()
    },
    markPlayerFailed() {
      playerFailed = true
      flush()
    }
  }
}
