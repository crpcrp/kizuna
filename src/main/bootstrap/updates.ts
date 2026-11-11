import * as fs from 'node:fs'
import type { IpcMain } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { AppLifecycleCoordinator } from '../appLifecycle'
import { createElectronUpdaterAdapter } from '../electronUpdaterAdapter'
import type { SettingsStore } from '../services/settings'
import { STARTUP_PROBE_ENV } from '../startupProbe'
import { registerUpdateBridge } from '../updateBridge'
import { createUpdateService, type UpdateService } from '../updateService'
import { detectUpdateSupport } from '../updateSupport'
import { UPDATE_CHANNELS } from '../../shared/ipcChannels'
import { isUpdateOffer } from '../../shared/update'
import type { MainWindowRef, SendToMain } from './deps'
import type { AppPaths } from './paths'

/**
 * Starts the single main-process updater and its renderer-owning IPC bridge.
 * Registered once for the application lifetime, before the window exists; the
 * overlay renderer starts the optional startup check only after it has
 * subscribed to state pushes.
 */
export function startUpdates(deps: {
  ipcMain: IpcMain
  settings: SettingsStore
  paths: AppPaths
  sendToMain: SendToMain
  mainWindow: MainWindowRef
  lifecycle: AppLifecycleCoordinator
  getVersion: () => string
  /** Surfaces a hidden (tray-only) window when an update is offered. */
  revealForUpdate: () => void
}): UpdateService {
  const { paths } = deps
  let packageType: string | undefined
  try {
    packageType = fs.readFileSync(paths.packageTypeFile, 'utf8').trim()
  } catch {
    // AppImage and unpackaged builds do not have electron-builder's package marker.
  }
  const service = createUpdateService({
    support: detectUpdateSupport({
      isPackaged: paths.isPackaged,
      platform: process.platform,
      appImagePath: process.env['APPIMAGE'],
      packageType,
      hasUpdateConfiguration: fs.existsSync(paths.appUpdateConfigFile)
    }),
    currentVersion: deps.getVersion(),
    updater: createElectronUpdaterAdapter(autoUpdater),
    prepareInstall: (install) => deps.lifecycle.prepareForInstall(install),
    allowAutomaticChecks: process.env[STARTUP_PROBE_ENV] !== '1'
  })
  registerUpdateBridge(
    deps.ipcMain,
    service,
    deps.settings,
    (sender) => sender === deps.mainWindow.current?.webContents
  )
  service.subscribe((state) => {
    deps.sendToMain(UPDATE_CHANNELS.stateChanged, state)
    // Game OCR runs with the window hidden behind the tray, where the renderer
    // still holds the prompt but nobody can see it.
    if (isUpdateOffer(state)) deps.revealForUpdate()
  })
  return service
}
