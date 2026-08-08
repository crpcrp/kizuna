import { describe, it, expect, vi } from 'vitest'
import { PATH_PLATFORMS, LINUX_PATHS } from '@test/harness/platformPaths'
import {
  createMpvConfigManager,
  mpvConfigDir,
  mpvScriptsDir,
  type MpvConfigManagerDeps
} from '@src/main/services/mpvConfig'

// The config dir is derived per platform, so both variants are asserted on
// either host instead of letting the runner pick which one gets covered.
describe.each(PATH_PLATFORMS)(
  'mpvConfigDir / mpvScriptsDir on $label',
  ({ platform, path, userDataDir }) => {
    it('places the config dir under <userData>/mpv and scripts beneath it', () => {
      expect(mpvConfigDir(userDataDir, platform)).toBe(path.join(userDataDir, 'mpv'))
      expect(mpvScriptsDir(userDataDir, platform)).toBe(path.join(userDataDir, 'mpv', 'scripts'))
    })
  }
)

// The manager's create/reveal behavior is platform-independent, so it is
// exercised against one target; `mpvConfigDir` above covers both path shapes.
const USER_DATA = LINUX_PATHS.userDataDir
const CONFIG_DIR = `${USER_DATA}/mpv`
const SCRIPTS_DIR = `${USER_DATA}/mpv/scripts`

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
    platform: 'linux',
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

  it('exposes Windows paths when the manager targets Windows', () => {
    const { deps } = makeDeps()
    const mgr = createMpvConfigManager({
      ...deps,
      userDataDir: 'C:\\Users\\me\\AppData\\Roaming\\Kizuna',
      platform: 'win32'
    })

    expect(mgr.configDir).toBe('C:\\Users\\me\\AppData\\Roaming\\Kizuna\\mpv')
    expect(mgr.scriptsDir).toBe('C:\\Users\\me\\AppData\\Roaming\\Kizuna\\mpv\\scripts')
  })

  it('open surfaces a non-empty shell.openPath error string instead of throwing', async () => {
    const { deps } = makeDeps({
      shell: { openPath: vi.fn(async () => 'Failed to open path') }
    })
    await expect(createMpvConfigManager(deps).open()).resolves.toBe('Failed to open path')
  })
})
