import { unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export type UnlinkFn = (path: string) => void

let endpointCounter = 0

function uniqueEndpointSuffix(): string {
  return `kizuna-mpv-${process.pid}-${Date.now()}-${endpointCounter++}`
}

/**
 * Builds the complete endpoint mpv serves and the IPC client connects to.
 * Linux uses a short socket filename under the platform temp directory so it
 * does not depend on a hard-coded `/tmp` path.
 */
export function createMpvIpcEndpoint(
  platform: NodeJS.Platform = process.platform,
  tempDir: string = tmpdir()
): string {
  if (platform !== 'win32' && platform !== 'linux') {
    throw new Error(`Unsupported platform for mpv IPC endpoint: ${platform}`)
  }

  const suffix = uniqueEndpointSuffix()
  if (platform === 'win32') return `\\\\.\\pipe\\${suffix}`
  return join(tempDir, `${suffix}.sock`)
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

/**
 * Removes a Linux IPC socket. Windows named pipes are managed by the OS and
 * must never be passed to a filesystem unlink operation. Missing sockets are
 * expected when mpv has already removed its endpoint; other errors surface to
 * the caller so cleanup failures are not silently lost.
 */
export function removeMpvIpcEndpoint(
  endpoint: string,
  platform: NodeJS.Platform,
  unlink: UnlinkFn = unlinkSync
): void {
  if (platform !== 'linux') return

  try {
    unlink(endpoint)
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return
    throw error
  }
}
