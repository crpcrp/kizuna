// Runtime half of the app-identity configuration. Turns the
// process-agnostic strings in `src/shared/appIdentity.json` into the Electron
// calls and filesystem paths that must agree with what electron-builder
// packages.
//
// Electron derives both `app.getName()` and `app.getPath('userData')` from
// package.json rather than from electron-builder's `productName`, so an
// unconfigured build writes its databases to a directory named after the npm
// package while the installer, shortcut, and executable use the product name.
// `applyAppIdentity` removes that divergence by setting all three explicitly.

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

/**
 * The per-user configuration directory the app stores settings and databases
 * in. `appDataRoot` is Electron's `appData` path (`%APPDATA%` on Windows,
 * `$XDG_CONFIG_HOME` or `~/.config` on Linux).
 *
 * Roaming AppData, not the installation directory: the NSIS installer can be
 * pointed at `Program Files`, which a standard user account cannot write to,
 * and Windows would otherwise silently virtualize the writes. This also keeps
 * user data out of the uninstaller's path and survives reinstalls.
 */
export function userDataDir(
  appDataRoot: string,
  platform: NodeJS.Platform = process.platform
): string {
  return pathApiFor(platform).join(appDataRoot, USER_DATA_DIR_NAME)
}

/** Default folder for saved screenshots: `<Pictures>/<product name>`. */
export function screenshotsDir(
  picturesRoot: string,
  platform: NodeJS.Platform = process.platform
): string {
  return pathApiFor(platform).join(picturesRoot, PRODUCT_NAME)
}

/**
 * Applies the packaged identity to a running app. Must be called before the
 * `ready` event and before anything reads `app.getPath('userData')`, because
 * Electron caches the resolved path on first access.
 *
 * Returns the resolved user-data directory so callers can log or assert it.
 */
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
