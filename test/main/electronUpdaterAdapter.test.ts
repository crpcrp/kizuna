import { describe, expect, it, vi } from 'vitest'
import type { AppUpdater } from 'electron-updater'
import { createElectronUpdaterAdapter } from '@src/main/electronUpdaterAdapter'
import { UpdaterCheckError } from '@src/main/updaterErrors'

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

  it('classifies check failures instead of forwarding raw provider errors', async () => {
    const cases: Array<[unknown, string]> = [
      [Object.assign(new Error('404 Not Found'), { statusCode: 404 }), 'noPublishedRelease'],
      [
        Object.assign(new Error('Cannot find channel file'), {
          code: 'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND'
        }),
        'noPublishedRelease'
      ],
      [Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' }), 'network'],
      [Object.assign(new Error('API rate limit exceeded'), { statusCode: 403 }), 'rateLimited'],
      [Object.assign(new Error('401 Unauthorized'), { statusCode: 401 }), 'permission'],
      [new Error('YAMLException: bad indentation'), 'metadata'],
      [new Error('something else entirely'), 'unknown']
    ]

    for (const [error, reason] of cases) {
      const updater = {
        checkForUpdates: vi.fn(async () => {
          throw error
        })
      } as unknown as AppUpdater
      const adapter = createElectronUpdaterAdapter(updater)

      const failure = await adapter.checkForUpdates().catch((value: unknown) => value)
      expect(failure).toBeInstanceOf(UpdaterCheckError)
      expect((failure as UpdaterCheckError).reason).toBe(reason)
      expect((failure as UpdaterCheckError).cause).toBe(error)
    }
  })

  it('forwards a successful check result unchanged', async () => {
    const updater = {
      checkForUpdates: vi.fn(async () => ({
        isUpdateAvailable: true,
        updateInfo: { version: '0.3.0' },
        cancellationToken: {}
      }))
    } as unknown as AppUpdater

    await expect(createElectronUpdaterAdapter(updater).checkForUpdates()).resolves.toEqual({
      isUpdateAvailable: true,
      updateInfo: { version: '0.3.0' }
    })
  })
})
