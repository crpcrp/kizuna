// User-owned UniDic path and migration boundaries. The installer/package
// resources are immutable; this module keeps mutable dictionary files under
// Electron's persistent user-data directory and makes legacy migration atomic.

import { pathApiFor } from '../../platformPath'
import { resolveUserUnidicDir } from '../../resourcePaths'

export interface UserUnidicFsLike {
  mkdirSync(path: string, options: { recursive: true }): void
}

export interface UserUnidicShellLike {
  openPath(path: string): Promise<string>
}

export interface UserUnidicManagerDeps {
  userDataDir: string
  fs: UserUnidicFsLike
  shell: UserUnidicShellLike
  platform?: NodeJS.Platform
}

export interface UserUnidicManager {
  readonly dir: string
  ensureDir(): void
  open(): Promise<string>
}

/** Composes the persistent UniDic path with the create/reveal side effects. */
export function createUserUnidicManager(deps: UserUnidicManagerDeps): UserUnidicManager {
  const dir = resolveUserUnidicDir(deps.userDataDir, deps.platform)
  const ensureDir = (): void => deps.fs.mkdirSync(dir, { recursive: true })

  return {
    dir,
    ensureDir,
    async open(): Promise<string> {
      ensureDir()
      return deps.shell.openPath(dir)
    }
  }
}

export interface UnidicMigrationFsLike {
  existsSync(path: string): boolean
  mkdirSync(path: string, options: { recursive: true }): void
  cpSync(
    source: string,
    destination: string,
    options: { recursive: true; errorOnExist: true; force: false }
  ): void
  renameSync(source: string, destination: string): void
  rmSync(path: string, options: { recursive: true; force: true }): void
}

export type UnidicMigrationResult =
  | { status: 'migrated'; source: string; target: string }
  | { status: 'skipped'; reason: 'legacy-missing' | 'target-exists' }
  | { status: 'failed'; source: string; target: string; error: string }

export interface MigrateLegacyUnidicOptions {
  legacyDir: string
  targetDir: string
  fs: UnidicMigrationFsLike
  /** Sibling staging path is injectable so failure cases remain deterministic. */
  stagingDir?: string
  platform?: NodeJS.Platform
}

/**
 * Copies a legacy packaged UniDic into the persistent directory exactly once.
 * The copy is made into a sibling staging directory and renamed into place only
 * after it completes, so a failed copy cannot expose a half-written target.
 */
export function migrateLegacyUnidic({
  legacyDir,
  targetDir,
  fs,
  stagingDir = `${targetDir}.migration-tmp`,
  platform = process.platform
}: MigrateLegacyUnidicOptions): UnidicMigrationResult {
  if (!fs.existsSync(legacyDir)) return { status: 'skipped', reason: 'legacy-missing' }
  if (fs.existsSync(targetDir)) return { status: 'skipped', reason: 'target-exists' }

  const pathApi = pathApiFor(platform)
  const cleanup = (): void => {
    try {
      fs.rmSync(stagingDir, { recursive: true, force: true })
    } catch {
      // Preserve the original migration error; cleanup is best-effort.
    }
  }

  try {
    // A stale staging directory belongs to a previous failed attempt and is
    // never treated as a valid user dictionary.
    cleanup()
    fs.mkdirSync(pathApi.dirname(targetDir), { recursive: true })
    fs.cpSync(legacyDir, stagingDir, {
      recursive: true,
      errorOnExist: true,
      force: false
    })

    // Do not overwrite a target created by another process while copying.
    if (fs.existsSync(targetDir)) {
      cleanup()
      return { status: 'skipped', reason: 'target-exists' }
    }
    fs.renameSync(stagingDir, targetDir)
    return { status: 'migrated', source: legacyDir, target: targetDir }
  } catch (error: unknown) {
    cleanup()
    return {
      status: 'failed',
      source: legacyDir,
      target: targetDir,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}
