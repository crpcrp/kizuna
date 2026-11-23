// Shared, pure app-information types and derivation. Runtime-only operations
// (Electron version lookup, shell, and filesystem access) stay in main.

import { COPYRIGHT, PRODUCT_NAME, REPOSITORY_URL } from './appIdentity'
import { COPULA_SOURCE, YOMITAN_SOURCE } from './inflection'

/** Re-exported so UI code has one obvious name to import. */
export const APP_NAME = PRODUCT_NAME

/** Approved About-dialog destinations. The main process maps these names to
 * these exact URLs; the renderer never supplies an arbitrary URL. */
export const APP_INFO_LINKS = {
  repository: REPOSITORY_URL,
  license: `${REPOSITORY_URL}/blob/main/LICENSE`,
  issues: `${REPOSITORY_URL}/issues`,
  jimakuAccount: 'https://jimaku.cc/account',
  yomitanTransforms: YOMITAN_SOURCE.url,
  wiktionaryCopula: COPULA_SOURCE.url,
  tatoeba: 'https://tatoeba.org',
  tatoebaLicense: 'https://creativecommons.org/licenses/by/2.0/fr/'
} as const

export type AppInfoLink = keyof typeof APP_INFO_LINKS

/** The approved link name for `url`, or undefined when it is not approved. */
export function appInfoLinkForUrl(url: string): AppInfoLink | undefined {
  return (Object.keys(APP_INFO_LINKS) as AppInfoLink[]).find((link) => APP_INFO_LINKS[link] === url)
}

export interface AppInfo {
  name: string
  version: string
  description: string
  license: string
  repositoryUrl: string
  issuesUrl: string
  copyright: string
}

export interface AppInfoMetadata {
  description: string
  license: string
  copyright?: string
}

export type NoticeOpenResult =
  | { status: 'opened' }
  | { status: 'unavailable'; message: string }
  | { status: 'error'; message: string }

/** Builds the narrow product-information payload returned to the renderer. */
export function createAppInfo(version: string, metadata: AppInfoMetadata): AppInfo {
  return {
    name: APP_NAME,
    version,
    description: metadata.description,
    license: metadata.license,
    repositoryUrl: APP_INFO_LINKS.repository,
    issuesUrl: APP_INFO_LINKS.issues,
    copyright: metadata.copyright ?? COPYRIGHT
  }
}
