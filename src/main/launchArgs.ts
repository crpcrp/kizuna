import { classifyMediaFileName } from '../shared/mediaFileTypes'
import { pathApiFor } from './platformPath'

// Use the target platform so Windows drive and UNC paths stay absolute on any host.
export function videoPathFromArgv(
  argv: string[],
  cwd: string,
  platform: NodeJS.Platform = process.platform
): string | undefined {
  const path = pathApiFor(platform)
  for (const entry of argv.slice(1)) {
    if (entry.startsWith('-')) continue
    if (classifyMediaFileName(path.basename(entry)) !== 'video') continue
    return path.resolve(cwd, entry)
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
