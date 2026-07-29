import { describe, it, expect, vi } from 'vitest'
import { join } from 'node:path'
import {
  createMpvConfigManager,
  mpvConfigDir,
  mpvScriptsDir,
  type MpvConfigManagerDeps
} from '@src/main/services/mpvConfig'

const USER_DATA = '/data/userData'

// The source joins through node:path, so the separator is the host platform's
// (`\` on Windows, `/` on posix). Build the expectations the same way rather
// than hard-coding `/`, which only passed on a posix runner.
const CONFIG_DIR = join(USER_DATA, 'mpv')
const SCRIPTS_DIR = join(USER_DATA, 'mpv', 'scripts')

describe('mpvConfigDir / mpvScriptsDir', () => {
  it('places the config dir under <userData>/mpv and scripts beneath it', () => {
    expect(mpvConfigDir(USER_DATA)).toBe(CONFIG_DIR)
    expect(mpvScriptsDir(USER_DATA)).toBe(SCRIPTS_DIR)
  })
})

function makeDeps(overrides: Partial<MpvConfigManagerDeps> = {}): {
  deps: MpvConfigManagerDeps
  mkdirSync: ReturnType<typeof vi.fn>
  openPath: ReturnType<typeof vi.fn>
} {
  const mkdirSync = vi.fn()
  const openPath = vi.fn(async () => '')
  const deps: MpvConfigManagerDeps = {
    userDataDir: USER_DATA,
    fs: { mkdirSync },
    shell: { openPath },
    ...overrides
  }
  return { deps, mkdirSync, openPath }
}

describe('createMpvConfigManager', () => {
  it('exposes the config and scripts paths', () => {
    const { deps } = makeDeps()
    const mgr = createMpvConfigManager(deps)
    expect(mgr.configDir).toBe(CONFIG_DIR)
    expect(mgr.scriptsDir).toBe(SCRIPTS_DIR)
  })

  it('ensureDir recursively creates the scripts folder', () => {
    const { deps, mkdirSync } = makeDeps()
    createMpvConfigManager(deps).ensureDir()
    expect(mkdirSync).toHaveBeenCalledWith(SCRIPTS_DIR, { recursive: true })
  })

  it('open creates the dir then reveals the config dir, returning shell.openPath result', async () => {
    const { deps, mkdirSync, openPath } = makeDeps()
    const result = await createMpvConfigManager(deps).open()
    expect(mkdirSync).toHaveBeenCalledWith(SCRIPTS_DIR, { recursive: true })
    expect(openPath).toHaveBeenCalledWith(CONFIG_DIR)
    expect(result).toBe('')
  })

  it('open surfaces a non-empty shell.openPath error string instead of throwing', async () => {
    const { deps } = makeDeps({
      shell: { openPath: vi.fn(async () => 'Failed to open path') }
    })
    await expect(createMpvConfigManager(deps).open()).resolves.toBe('Failed to open path')
  })
})
