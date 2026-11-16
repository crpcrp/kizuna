import { randomBytes } from 'node:crypto'
import { posix, win32 } from 'node:path'
import type { PathPlatform } from '../shared/mediaHistory'

export function pathApiFor(platform: NodeJS.Platform = process.platform): typeof posix {
  return platform === 'win32' ? win32 : posix
}

// Shared renderer types name path rules without importing node:path.
export function pathPlatformFor(platform: NodeJS.Platform = process.platform): PathPlatform {
  return platform === 'win32' ? 'win32' : 'posix'
}

// Random suffixes avoid collisions between concurrent temporary files.
export function uniqueTempName(prefix: string, ext: string): string {
  return `${prefix}-${randomBytes(6).toString('hex')}.${ext}`
}
