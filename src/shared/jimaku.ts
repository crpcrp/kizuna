// Shared, serializable Jimaku contracts. The main-process client keeps the
// remote download URL out of this public file descriptor.

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
