import * as fs from 'node:fs'
import type { IpcMain, Shell } from 'electron'
import packageMetadata from '../../../package.json'
import { COPYRIGHT } from '../../shared/appIdentity'
import { createAppInfoService, registerAppInfoBridge } from '../appInfoBridge'
import { createIntegrationService, registerIntegrationBridge } from '../integrationBridge'
import { resolveThirdPartyNoticesPath, type BinaryPaths } from '../resourcePaths'
import type { AppPaths } from './paths'

/**
 * Registers the integration-status bridge (the read-only "which optional
 * bundled binaries are on disk" query behind Options > Setup & integrations)
 * and the About-dialog bridge with runtime version and packaged notices.
 */
export function startAppInfo(deps: {
  ipcMain: IpcMain
  paths: AppPaths
  binaryPaths: BinaryPaths
  shell: Shell
  getVersion: () => string
}): void {
  const { ipcMain, paths, shell } = deps
  registerIntegrationBridge(
    ipcMain,
    createIntegrationService({ paths: deps.binaryPaths, exists: (p) => fs.existsSync(p) })
  )
  registerAppInfoBridge(
    ipcMain,
    createAppInfoService({
      getVersion: deps.getVersion,
      metadata: {
        description: packageMetadata.description,
        license: packageMetadata.license,
        copyright: COPYRIGHT
      },
      noticesPath: resolveThirdPartyNoticesPath({
        isPackaged: paths.isPackaged,
        resourcesPath: paths.resourcesPath,
        appRoot: paths.appRoot
      }),
      exists: (path) => fs.existsSync(path),
      openExternal: (url) => shell.openExternal(url),
      openPath: (path) => shell.openPath(path)
    })
  )
}
