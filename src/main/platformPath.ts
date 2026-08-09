// Explicit path semantics for the two supported desktop targets.
//
// `node:path`'s default export follows the *host* it runs on. That is correct
// in production — the app only ever resolves paths for the machine it is
// installed on — but it makes tests host-dependent: a suite running on Linux
// silently exercises POSIX joining and never asserts what Windows produces (and
// vice versa). Worse, a Windows-format fixture such as `C:\Users\me` handed to
// the POSIX implementation yields `C:\Users\me/Kizuna`, which no platform ever
// produces, so the assertion still passes while proving nothing.
//
// Every module that derives a filesystem path therefore takes an optional
// `platform` that defaults to `process.platform`, and resolves its path API
// through `pathApiFor`. Production behavior is unchanged; tests pass 'win32'
// and 'linux' explicitly and assert both variants on either host.
//
// `resolveBinaryPaths` in `resourcePaths.ts` established this pattern; this
// module is the reusable form of it.

import { posix, win32, type PlatformPath } from 'node:path'
import type { PathPlatform } from '../shared/mediaHistory'

/** The desktop targets Kizuna supports. */
export type SupportedPlatform = 'win32' | 'linux'

/**
 * The `node:path` implementation for `platform`: `win32` for Windows,
 * `posix` for everything else. Non-Windows platforms other than Linux (macOS,
 * BSD) share POSIX path semantics, so they resolve the same way even though
 * the app itself is not shipped for them.
 */
export function pathApiFor(platform: NodeJS.Platform = process.platform): PlatformPath {
  return platform === 'win32' ? win32 : posix
}

/**
 * The same choice expressed as `shared/mediaHistory`'s `PathPlatform`. The
 * shared modules cannot import `node:path` (the renderer bundles them), so they
 * name path *rules* rather than a `node:path` implementation; this converts a
 * main-process `NodeJS.Platform` into that vocabulary at the boundary.
 */
export function pathPlatformFor(platform: NodeJS.Platform = process.platform): PathPlatform {
  return platform === 'win32' ? 'win32' : 'posix'
}
