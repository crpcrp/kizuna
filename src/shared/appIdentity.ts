// Single source of truth for the application's published identity.
//
// The values themselves live in `appIdentity.json` rather than in this module
// because two consumers with incompatible module systems must read the same
// bytes: this TypeScript module (bundled into main / preload / renderer by
// electron-vite) and `electron-builder.cjs` at the repository root, which is
// plain CommonJS executed by `electron-builder` before any build step exists.
// A JSON file is the only format both can read without a code generator, so
// packaging identity and runtime identity cannot drift apart.
//
// Nothing here touches `node:path` or any other Node built-in: the renderer
// imports this module (via `appInfo.ts`), and a Node built-in in that graph
// would break the browser-targeted bundle. Path derivation from these values
// lives main-side in `src/main/appIdentity.ts`.

import identity from './appIdentity.json'

/** The shape of `appIdentity.json`. */
export interface AppIdentity {
  /** Human-readable product name: window title, installer, Start menu entry. */
  productName: string
  /** Base name of the packaged Windows executable, without `.exe`. */
  executableName: string
  /** Windows AppUserModelID / electron-builder `appId`. Never change after a public release. */
  appId: string
  /** Directory name under `%APPDATA%` holding settings and databases. */
  userDataDirName: string
  /** Copyright line shown in product information. */
  copyright: string
  /** Canonical public source repository. */
  repositoryUrl: string
  /** Repository mirroring the pinned runtime binaries (see resources.lock.json). */
  vendorRepositoryUrl: string
}

export const APP_IDENTITY: AppIdentity = identity

export const PRODUCT_NAME = APP_IDENTITY.productName
export const EXECUTABLE_NAME = APP_IDENTITY.executableName
export const APP_ID = APP_IDENTITY.appId
export const USER_DATA_DIR_NAME = APP_IDENTITY.userDataDirName
export const COPYRIGHT = APP_IDENTITY.copyright
export const REPOSITORY_URL = APP_IDENTITY.repositoryUrl
export const VENDOR_REPOSITORY_URL = APP_IDENTITY.vendorRepositoryUrl

/**
 * Whether `id` is a usable Windows AppUserModelID / electron-builder `appId`:
 * at least two dot-separated segments of ASCII letters, digits, or hyphens,
 * each starting with a letter. Windows silently ignores a malformed
 * AppUserModelID (taskbar grouping and notifications then fall back to the
 * executable path), so this is asserted at build time by a test rather than
 * discovered after a release.
 */
export function isValidAppId(id: string): boolean {
  return /^[A-Za-z][A-Za-z0-9-]*(\.[A-Za-z][A-Za-z0-9-]*)+$/.test(id)
}
