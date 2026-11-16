// Electron defaults to package.json's name, which can differ from the packaged identity.

import { APP_ID, PRODUCT_NAME, USER_DATA_DIR_NAME } from '../shared/appIdentity'
import { pathApiFor } from './platformPath'

/** The subset of Electron's `app` this module drives; injected so tests
 * exercise it with a plain fake instead of a live Electron app. */
export interface AppIdentityTarget {
  setName(name: string): void
  setAppUserModelId(id: string): void
  getPath(name: string): string
  setPath(name: string, path: string): void
}

// Keep user data in appData so it survives reinstalls and needs no installation-directory write access.
function userDataDir(appDataRoot: string, platform: NodeJS.Platform = process.platform): string {
  return pathApiFor(platform).join(appDataRoot, USER_DATA_DIR_NAME)
}

/** Default folder for saved screenshots: `<Pictures>/<product name>`. */
export function screenshotsDir(
  picturesRoot: string,
  platform: NodeJS.Platform = process.platform
): string {
  return pathApiFor(platform).join(picturesRoot, PRODUCT_NAME)
}

// Apply before ready and the first userData lookup: Electron caches the resolved path.
export function applyAppIdentity(
  app: AppIdentityTarget,
  platform: NodeJS.Platform = process.platform
): string {
  app.setName(PRODUCT_NAME)
  // Windows taskbar grouping, jump lists, and toast notifications key off the
  // AppUserModelID; it must equal electron-builder's `appId` or a pinned
  // shortcut stops matching the running window.
  app.setAppUserModelId(APP_ID)
  const dir = userDataDir(app.getPath('appData'), platform)
  app.setPath('userData', dir)
  return dir
}
