import type { UpdateCheckFailureReason } from '../shared/update'

/** Network-layer failures that a user can act on by fixing their connection. */
const NETWORK_CODES = new Set([
  'EAI_AGAIN',
  'ECONNABORTED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETDOWN',
  'ENETUNREACH',
  'ENOTFOUND',
  'EPIPE',
  'ETIMEDOUT',
  'UND_ERR_CONNECT_TIMEOUT'
])

/**
 * electron-updater codes meaning the provider exposes no update metadata. A
 * repository whose only release is a draft looks exactly like this to an
 * unauthenticated client.
 */
const MISSING_METADATA_CODES = new Set([
  'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND',
  'ERR_UPDATER_LATEST_VERSION_NOT_FOUND'
])

const MALFORMED_METADATA_CODES = new Set([
  'ERR_UPDATER_INVALID_UPDATE_INFO',
  'ERR_UPDATER_INVALID_VERSION',
  'ERR_UPDATER_ASSET_NOT_FOUND'
])

/** An update check failure that already carries its classification. */
export class UpdaterCheckError extends Error {
  readonly reason: UpdateCheckFailureReason

  constructor(reason: UpdateCheckFailureReason, options?: { cause?: unknown }) {
    super(`Update check failed (${reason}).`, options as ErrorOptions)
    this.name = 'UpdaterCheckError'
    this.reason = reason
  }
}

function field(error: unknown, key: string): unknown {
  return error && typeof error === 'object' ? (error as Record<string, unknown>)[key] : undefined
}

function statusCode(error: unknown): number | undefined {
  const value = field(error, 'statusCode') ?? field(error, 'status')
  return typeof value === 'number' ? value : undefined
}

function text(error: unknown): string {
  const description = field(error, 'description')
  const base = error instanceof Error ? `${error.name} ${error.message}` : String(error)
  return `${base} ${typeof description === 'string' ? description : ''}`
}

/**
 * Maps an updater failure onto a truthful outcome so a draft-only release is
 * never reported as a broken connection.
 */
export function classifyUpdaterError(error: unknown): UpdateCheckFailureReason {
  if (error instanceof UpdaterCheckError) return error.reason

  const code = field(error, 'code')
  const status = statusCode(error)
  const message = text(error)

  if (typeof code === 'string') {
    if (MISSING_METADATA_CODES.has(code)) return 'noPublishedRelease'
    if (MALFORMED_METADATA_CODES.has(code)) return 'metadata'
    if (NETWORK_CODES.has(code)) return 'network'
  }

  if (status === 429 || /rate limit/i.test(message)) return 'rateLimited'
  if (status === 404) return 'noPublishedRelease'
  if (status === 401 || status === 403) return 'permission'
  if (/cannot find channel file|latest\.yml.*not found/i.test(message)) return 'noPublishedRelease'
  if (/getaddrinfo|socket hang up|network|timed? ?out/i.test(message)) return 'network'
  if (/yaml|unable to parse|cannot parse|invalid update info/i.test(message)) return 'metadata'

  return 'unknown'
}
