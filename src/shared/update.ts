export type UpdateCheckOrigin = 'automatic' | 'manual'

export interface UpdateSettings {
  checkAutomatically: boolean
}

export type UpdatePackage = 'nsis' | 'appImage' | 'deb'

export type UpdateUnsupportedReason =
  'unpackaged' | 'unsupportedPlatform' | 'unsupportedPackage' | 'missingConfiguration'

export type UpdateErrorStage = 'check' | 'download' | 'install'

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
  | ({ status: 'available' } & UpdateRelease)
  | ({ status: 'downloading'; progress: UpdateProgress } & UpdateRelease)
  | ({ status: 'downloaded' } & UpdateRelease)
  | {
      status: 'error'
      stage: UpdateErrorStage
      message: string
      retryable: boolean
      cancelled?: boolean
    }
