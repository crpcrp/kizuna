import type { AppUpdater } from 'electron-updater'
import type { EventEmitter } from 'node:events'
import type { UpdaterAdapter } from './updateService'

/** Keeps electron-updater and all installer paths inside the main process. */
export function createElectronUpdaterAdapter(updater: AppUpdater): UpdaterAdapter {
  return {
    configure() {
      updater.autoDownload = false
      updater.autoInstallOnAppQuit = false
      updater.allowPrerelease = true
      // allowPrerelease's setter permits downgrade, so reset this afterwards.
      updater.allowDowngrade = false
    },
    async checkForUpdates() {
      const result = await updater.checkForUpdates()
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
