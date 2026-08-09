import type { UpdateUnsupportedReason } from '../shared/update'
import type { UpdatePackage } from '../shared/update'

export type UpdateSupport =
  | { supported: true; packageType: UpdatePackage }
  | { supported: false; reason: UpdateUnsupportedReason }

export interface UpdateRuntimeFacts {
  isPackaged: boolean
  platform: NodeJS.Platform
  appImagePath?: string
  packageType?: string
  hasUpdateConfiguration: boolean
}

/** Selects only the package formats whose metadata Kizuna publishes. */
export function detectUpdateSupport(facts: UpdateRuntimeFacts): UpdateSupport {
  if (!facts.isPackaged) return { supported: false, reason: 'unpackaged' }
  if (!facts.hasUpdateConfiguration) return { supported: false, reason: 'missingConfiguration' }
  if (facts.platform === 'win32') return { supported: true, packageType: 'nsis' }
  if (facts.platform !== 'linux') return { supported: false, reason: 'unsupportedPlatform' }
  if (facts.packageType === 'deb') return { supported: true, packageType: 'deb' }
  if (facts.appImagePath) return { supported: true, packageType: 'appImage' }
  return { supported: false, reason: 'unsupportedPackage' }
}
