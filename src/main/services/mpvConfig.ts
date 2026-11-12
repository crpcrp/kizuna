// Kizuna-owned mpv config directory (`<userData>/mpv`). Users drop
// mpv.conf/input.conf/scripts/shaders here exactly as they would for standalone
// mpv. Only the Electron shell is injected; folder creation uses node:fs.

import { mkdirSync } from 'node:fs'
import { pathApiFor } from '../platformPath'

/** The mpv config dir mpv reads from when the user enables it. */
export function mpvConfigDir(
  userDataDir: string,
  platform: NodeJS.Platform = process.platform
): string {
  return pathApiFor(platform).join(userDataDir, 'mpv')
}

/** The `scripts/` subfolder created on first enable so users have a drop target. */
export function mpvScriptsDir(
  userDataDir: string,
  platform: NodeJS.Platform = process.platform
): string {
  return pathApiFor(platform).join(mpvConfigDir(userDataDir, platform), 'scripts')
}

/** The slice of Electron's `shell` this manager needs (fakeable in tests). */
export interface MpvConfigShellLike {
  openPath(path: string): Promise<string>
}

interface MpvConfigManagerDeps {
  userDataDir: string
  shell: MpvConfigShellLike
  /** Path semantics for the config dir; defaults to the host platform. */
  platform?: NodeJS.Platform
}

export interface MpvConfigManager {
  readonly configDir: string
  readonly scriptsDir: string
  /** Recursively creates `<userData>/mpv/scripts` (idempotent — safe to call on
   * every enable). Creating the leaf creates the config dir on the way. */
  ensureDir(): void
  /** Ensures the dir exists, then reveals it in the OS file manager. Resolves
   * the `shell.openPath` result string (empty on success, an error message
   * otherwise — surfaced to the caller rather than thrown). */
  open(): Promise<string>
}

/** Creates the config folders and reveals them through the injected shell. */
export function createMpvConfigManager(deps: MpvConfigManagerDeps): MpvConfigManager {
  const configDir = mpvConfigDir(deps.userDataDir, deps.platform)
  const scriptsDir = mpvScriptsDir(deps.userDataDir, deps.platform)
  const ensureDir = (): void => {
    mkdirSync(scriptsDir, { recursive: true })
  }
  return {
    configDir,
    scriptsDir,
    ensureDir,
    async open(): Promise<string> {
      ensureDir()
      return deps.shell.openPath(configDir)
    }
  }
}
