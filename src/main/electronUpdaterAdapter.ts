import type { AppUpdater } from 'electron-updater'
import type { EventEmitter } from 'node:events'
import type { UpdaterAdapter } from './updateService'
import { UpdaterCheckError, classifyUpdaterError } from './updaterErrors'

/** Keeps electron-updater and all installer paths inside the main process. */
export function createElectronUpdaterAdapter(updater: AppUpdater): UpdaterAdapter {
  return {
    configure() {
      updater.autoDownload = false
      updater.autoInstallOnAppQuit = false
      // Published pre-releases are offered; drafts stay invisible to installed
      // clients because the app never authenticates against GitHub.
      updater.allowPrerelease = true
      // allowPrerelease's setter permits downgrade, so reset this afterwards.
      updater.allowDowngrade = false
    },
    async checkForUpdates() {
      let result: Awaited<ReturnType<AppUpdater['checkForUpdates']>>
      try {
        result = await updater.checkForUpdates()
      } catch (error) {
        // Classify here so the service never has to interpret provider errors.
        throw new UpdaterCheckError(classifyUpdaterError(error), { cause: error })
      }
      return result
        ? { isUpdateAvailable: result.isUpdateAvailable, updateInfo: result.updateInfo }
        : null
    },
    async downloadUpdate() {
      await updater.downloadUpdate()
    },
    quitAndInstall() {
      updater.quitAndInstall(false, true)
    },
    on(event, listener) {
      updater.on(event, listener as never)
    },
    removeListener(event, listener) {
      ;(updater as unknown as EventEmitter).removeListener(event, listener)
    }
  } as UpdaterAdapter
}
