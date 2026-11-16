// JSON lets runtime bundles and the CommonJS packager read the same identity before a build.

import identity from './appIdentity.json'

export interface AppIdentity {
  productName: string
  /** Base name of the packaged Windows executable, without `.exe`. */
  executableName: string
  /** Windows AppUserModelID / electron-builder `appId`. Never change after a public release. */
  appId: string
  /** Directory name under `%APPDATA%` holding settings and databases. */
  userDataDirName: string

  copyright: string

  repositoryUrl: string
  /** Repository mirroring the pinned runtime binaries. */
  vendorRepositoryUrl: string
}

const APP_IDENTITY: AppIdentity = identity

export const PRODUCT_NAME = APP_IDENTITY.productName
export const APP_ID = APP_IDENTITY.appId
export const USER_DATA_DIR_NAME = APP_IDENTITY.userDataDirName
export const COPYRIGHT = APP_IDENTITY.copyright
export const REPOSITORY_URL = APP_IDENTITY.repositoryUrl
