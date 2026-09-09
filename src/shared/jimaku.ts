// Shared, serializable Jimaku contracts. The main-process client keeps the
// remote download URL out of this public file descriptor.

import type { JimakuSubtitleProvenance, StoredSubtitleSelection } from './mediaHistory'

export interface JimakuEntryFlags {
  anime: boolean
  movie: boolean
  external: boolean
  unverified: boolean
  adult: boolean
}

export interface JimakuEntry {
  id: number
  name: string
  flags: JimakuEntryFlags
  englishName?: string
  japaneseName?: string
  anilistId?: number
  tmdbId?: string
}

/** A file listed by Jimaku without its main-process-only download URL. */
export interface JimakuFile {
  name: string
  size: number
  lastModified: string
}

export interface JimakuSearchRequest {
  query: string
  anime: boolean
}

export type JimakuSearchCategory = 'anime' | 'liveAction' | 'all'

export interface JimakuTitleSearchRequest {
  query: string
  category?: JimakuSearchCategory
  refresh?: boolean
}

export interface JimakuSourcePage {
  entryId: number
  url: string
}

export type JimakuFileFormat = 'srt' | 'ass' | 'ssa' | 'zip' | 'unsupported'
export type JimakuCandidateStatus = 'eligible' | 'browseOnly' | 'excluded'

export interface JimakuFileCandidate {
  candidateId: string
  entryId: number
  sourcePage: JimakuSourcePage
  name: string
  size: number
  lastModified: string
  format: JimakuFileFormat
  status: JimakuCandidateStatus
  reasons: string[]
}

export interface JimakuArchiveMember {
  memberId: string
  displayName: string
  format: 'srt' | 'ass' | 'ssa'
  size: number
  inferredEpisode?: number
  inferredEpisodeRange?: { start: number; end: number }
  status: JimakuCandidateStatus
  reasons: string[]
}

export interface JimakuTitleSearchResult {
  entries: JimakuEntry[]
  partial: boolean
  failedCategories?: Array<'anime' | 'liveAction'>
}

export interface JimakuFileListResult {
  entryId: number
  sourcePage: JimakuSourcePage
  files: JimakuFileCandidate[]
}

export interface JimakuPreparedSubtitleResult {
  kind: 'preparedSubtitle'
  handle: string
  contentVersion: string
  originalName: string
  format: 'srt' | 'ass' | 'ssa'
  provenance: JimakuSubtitleProvenance
  /** Trusted main-owned path descriptor for the existing external loader. */
  selection: Extract<StoredSubtitleSelection, { mode: 'external' }>
}

export interface JimakuArchiveMembersResult {
  kind: 'archiveMembers'
  packageId: string
  entryId: number
  sourcePage: JimakuSourcePage
  sourceFileName: string
  members: JimakuArchiveMember[]
}

export type JimakuPrepareResult = JimakuPreparedSubtitleResult | JimakuArchiveMembersResult

export interface JimakuSession {
  sessionId: string
  mediaGeneration: number
}

export type JimakuServiceErrorCode =
  | JimakuErrorCode
  | 'invalidSession'
  | 'staleMedia'
  | 'invalidEntry'
  | 'invalidCandidate'
  | 'invalidPackage'
  | 'invalidMember'
  | 'expired'
  | 'openExternalFailed'
  | 'storage'
  | 'tooLarge'
  | 'invalidSubtitle'
  | 'unsupportedDownload'
  | 'unsupportedArchive'
  | 'invalidArchive'

export interface JimakuServiceError {
  code: JimakuServiceErrorCode
  retryAt?: string
  recoveryUrl?: string
}

export type JimakuServiceResult<T> =
  { ok: true; value: T } | { ok: false; error: JimakuServiceError }

export type JimakuErrorCode =
  | 'cancelled'
  | 'timeout'
  | 'network'
  | 'unauthorized'
  | 'notFound'
  | 'rateLimited'
  | 'serviceUnavailable'
  | 'invalidResponse'
  | 'notConfigured'
  | 'invalidRequest'

export interface JimakuError {
  code: JimakuErrorCode
  /** ISO timestamp after which a rate-limited request may be retried. */
  retryAt?: string
}

export type JimakuResult<T> = { ok: true; value: T } | { ok: false; error: JimakuError }

export type JimakuTestOutcome =
  { status: 'notTested' } | { status: 'connected' } | { status: 'error'; error: JimakuError }

/** Credential state exposed to the renderer; no key or encrypted value crosses this boundary. */
export interface JimakuSettingsStatus {
  configured: boolean
  secretStorageAvailable: boolean
  testOutcome: JimakuTestOutcome
}
