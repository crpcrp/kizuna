// Table-driven platform cases for path-deriving behavior.
//
// Application modules that build filesystem paths take an explicit `platform`
// (see `src/main/platformPath.ts`). Tests iterate `PATH_PLATFORMS` so both
// variants are asserted on either host: a Linux runner still proves what
// Windows produces, and a Windows runner still proves what Linux produces.
//
// Each case carries fixtures in its own native format. Never hand a Windows
// fixture to the host's default `node:path` — join the expectation with the
// case's own `path` API instead, or the assertion checks a string no platform
// ever produces.

import { posix, win32, type PlatformPath } from 'node:path'

export interface PathPlatformCase {
  /** Vitest test-name label, e.g. `describe.each(PATH_PLATFORMS)('$label', …)`. */
  label: 'Windows' | 'Linux'
  platform: NodeJS.Platform
  /** The `node:path` implementation this platform uses. */
  path: PlatformPath
  /** An absolute media folder in the platform's native format. */
  mediaDir: string
  /** An absolute per-user data directory (Electron's `userData`). */
  userDataDir: string
  /** Electron's `appData` root, the parent of `userData`. */
  appDataDir: string
  /** Electron's `pictures` root, where screenshots default to. */
  picturesDir: string
  /** An absolute temporary directory. */
  tempDir: string
}

export const WINDOWS_PATHS: PathPlatformCase = {
  label: 'Windows',
  platform: 'win32',
  path: win32,
  mediaDir: 'E:\\anime\\show',
  userDataDir: 'C:\\Users\\me\\AppData\\Roaming\\Kizuna',
  appDataDir: 'C:\\Users\\me\\AppData\\Roaming',
  picturesDir: 'C:\\Users\\me\\Pictures',
  tempDir: 'C:\\Users\\me\\AppData\\Local\\Temp'
}

export const LINUX_PATHS: PathPlatformCase = {
  label: 'Linux',
  platform: 'linux',
  path: posix,
  mediaDir: '/srv/anime/show',
  userDataDir: '/home/me/.config/Kizuna',
  appDataDir: '/home/me/.config',
  picturesDir: '/home/me/Pictures',
  tempDir: '/tmp'
}

export const PATH_PLATFORMS: readonly PathPlatformCase[] = [WINDOWS_PATHS, LINUX_PATHS]
