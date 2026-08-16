export type UpdateCheckOrigin = 'automatic' | 'manual'

export interface UpdateSettings {
  checkAutomatically: boolean
}

export type UpdatePackage = 'nsis' | 'appImage' | 'deb'

export type UpdateUnsupportedReason =
  'unpackaged' | 'unsupportedPlatform' | 'unsupportedPackage' | 'missingConfiguration'

export type UpdateErrorStage = 'check' | 'download' | 'install'

/**
 * Why an update check could not produce a result. `noPublishedRelease` is the
 * expected outcome for a draft-only repository/channel and is not an error.
 */
export type UpdateCheckFailureReason =
  'noPublishedRelease' | 'network' | 'rateLimited' | 'permission' | 'metadata' | 'unknown'

export interface UpdateRelease {
  currentVersion: string
  version: string
  packageType: UpdatePackage
  releaseName?: string
  releaseDate?: string
  releaseNotes?: string
}

export interface UpdateProgress {
  percent: number
  transferred: number
  total: number
  bytesPerSecond: number
}

export type UpdateState =
  | { status: 'unsupported'; reason: UpdateUnsupportedReason }
  | { status: 'idle' }
  | { status: 'checking'; origin: UpdateCheckOrigin }
  | { status: 'upToDate'; currentVersion: string; checkedAt: string }
  | { status: 'noPublishedRelease'; currentVersion: string; checkedAt: string }
  | ({ status: 'available' } & UpdateRelease)
  | ({ status: 'downloading'; progress: UpdateProgress } & UpdateRelease)
  | ({ status: 'downloaded' } & UpdateRelease)
  | {
      status: 'error'
      stage: UpdateErrorStage
      message: string
      retryable: boolean
      reason?: UpdateCheckFailureReason
      cancelled?: boolean
    }

/**
 * True while the update state is a decision waiting for the person: a release
 * to download, or a downloaded release to install. Everything else is either
 * progress or an outcome they do not have to answer.
 */
export function isUpdateOffer(state: UpdateState): boolean {
  return state.status === 'available' || state.status === 'downloaded'
}
