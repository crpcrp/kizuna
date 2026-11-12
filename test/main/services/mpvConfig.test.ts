import disk from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
const tempDirs: string[] = []
function tempDir(): string {
  const dir = disk.mkdtempSync(join(tmpdir(), 'kizuna-'))
  tempDirs.push(dir)
  return dir
}
afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  for (const dir of tempDirs.splice(0)) disk.rmSync(dir, { recursive: true, force: true })
})
import { afterEach, describe, it, expect, vi } from 'vitest'
import { PATH_PLATFORMS } from '@test/harness/platformPaths'
import { createMpvConfigManager, mpvConfigDir, mpvScriptsDir } from '@src/main/services/mpvConfig'

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

describe('createMpvConfigManager', () => {
  it('creates scripts on demand and reveals the config folder', async () => {
    const dir = tempDir()
    const openPath = vi.fn(async () => '')
    const manager = createMpvConfigManager({ userDataDir: dir, shell: { openPath } })
    expect(disk.existsSync(manager.configDir)).toBe(false)
    manager.ensureDir()
    await expect(manager.open()).resolves.toBe('')
    expect(disk.statSync(manager.scriptsDir).isDirectory()).toBe(true)
    expect(openPath).toHaveBeenCalledWith(join(dir, 'mpv'))
  })

  it('surfaces shell errors', async () => {
    const manager = createMpvConfigManager({
      userDataDir: tempDir(),
      shell: { openPath: async () => 'Failed to open path' }
    })
    await expect(manager.open()).resolves.toBe('Failed to open path')
  })
})
