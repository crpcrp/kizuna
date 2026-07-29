// Feature 2 — Kizuna-owned mpv config directory (`<userData>/mpv`). Users drop
// mpv.conf/input.conf/scripts/shaders here exactly as they would for standalone
// mpv. The path math is pure; the create/reveal side effects go through injected
// `fs`/`shell` boundaries so tests use fakes (AGENTS.md law 3) — no real disk or
// Electron `shell` in a unit test.

import { join } from 'node:path'

/** The mpv config dir mpv reads from when the user enables it. */
export function mpvConfigDir(userDataDir: string): string {
  return join(userDataDir, 'mpv')
}

/** The `scripts/` subfolder created on first enable so users have a drop target. */
export function mpvScriptsDir(userDataDir: string): string {
  return join(mpvConfigDir(userDataDir), 'scripts')
}

/** The slice of `fs` this manager needs (fakeable in tests). */
export interface MpvConfigFsLike {
  mkdirSync(path: string, options: { recursive: true }): void
}

/** The slice of Electron's `shell` this manager needs (fakeable in tests). */
export interface MpvConfigShellLike {
  openPath(path: string): Promise<string>
}

export interface MpvConfigManagerDeps {
  userDataDir: string
  fs: MpvConfigFsLike
  shell: MpvConfigShellLike
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

/** Composes the injected `fs`/`shell` into an `MpvConfigManager`. */
export function createMpvConfigManager(deps: MpvConfigManagerDeps): MpvConfigManager {
  const configDir = mpvConfigDir(deps.userDataDir)
  const scriptsDir = mpvScriptsDir(deps.userDataDir)
  const ensureDir = (): void => {
    deps.fs.mkdirSync(scriptsDir, { recursive: true })
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
