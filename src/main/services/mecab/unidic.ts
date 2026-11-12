// User-owned UniDic path. The installer/package resources are immutable; this
// module keeps mutable dictionary files under Electron's persistent user-data
// directory.

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
