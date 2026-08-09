import { describe, expect, it, vi } from 'vitest'
import type { AppUpdater } from 'electron-updater'
import { createElectronUpdaterAdapter } from '@src/main/electronUpdaterAdapter'

describe('createElectronUpdaterAdapter', () => {
  it('requires consent for download/install, permits prereleases, and forbids downgrades', () => {
    const updater = {
      autoDownload: true,
      autoInstallOnAppQuit: true,
      allowPrerelease: false,
      allowDowngrade: true,
      quitAndInstall: vi.fn(),
      on: vi.fn(),
      removeListener: vi.fn()
    } as unknown as AppUpdater
    const adapter = createElectronUpdaterAdapter(updater)

    adapter.configure()
    adapter.quitAndInstall()

    expect(updater.autoDownload).toBe(false)
    expect(updater.autoInstallOnAppQuit).toBe(false)
    expect(updater.allowPrerelease).toBe(true)
    expect(updater.allowDowngrade).toBe(false)
    expect(updater.quitAndInstall).toHaveBeenCalledWith(false, true)
  })
})
