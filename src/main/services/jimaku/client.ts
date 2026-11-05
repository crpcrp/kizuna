import type {
  JimakuEntry,
  JimakuErrorCode,
  JimakuFile,
  JimakuResult,
  JimakuSearchRequest
} from '../../../shared/jimaku'
import {
  HttpBodyTooLargeError,
  isTimeoutError,
  readBody,
  type HttpFetch,
  type HttpResponse
} from '../http'
import { isRecord, isPositiveSafeInteger, isNonNegativeSafeInteger } from '../../../shared/guards'

export const JIMAKU_API_ORIGIN = 'https://jimaku.cc'
export const JIMAKU_API_BASE = `${JIMAKU_API_ORIGIN}/api`
export const JIMAKU_REQUEST_TIMEOUT_MS = 15_000
export const JIMAKU_MAX_QUERY_LENGTH = 200
export const JIMAKU_MAX_RESPONSE_BYTES = 10 * 1024 * 1024

const JIMAKU_RATE_LIMIT_FALLBACK_MS = 60_000

/** The remote URL is intentionally available only to main-process consumers. */
export interface JimakuFileRecord extends JimakuFile {
  url: string
}

export interface JimakuClient {
  searchEntries(
    request: JimakuSearchRequest,
    signal?: AbortSignal
  ): Promise<JimakuResult<JimakuEntry[]>>
  getEntry(id: number, signal?: AbortSignal): Promise<JimakuResult<JimakuEntry>>
  listFiles(entryId: number, signal?: AbortSignal): Promise<JimakuResult<JimakuFileRecord[]>>
}

export interface CreateJimakuClientDeps {
  getApiKey: () => string | null | undefined
  fetch: HttpFetch
  now?: () => number
  requestTimeoutMs?: number
}

const INVALID = Symbol('jimaku-invalid')

/** Creates a read-only, fixed-origin Jimaku API client. */
export function createJimakuClient(deps: CreateJimakuClientDeps): JimakuClient {
  const now = deps.now ?? Date.now
  const requestTimeoutMs = deps.requestTimeoutMs ?? JIMAKU_REQUEST_TIMEOUT_MS

  let cooldownUntilMs: number | undefined

  async function request<T>(
    url: string,
    parse: (raw: unknown) => T | undefined,
    signal?: AbortSignal
  ): Promise<JimakuResult<T>> {
    const apiKey = deps.getApiKey()?.trim() || undefined
    if (apiKey === undefined) return failure('notConfigured')

    if (cooldownUntilMs !== undefined && now() < cooldownUntilMs) {
      return failure('rateLimited', toIsoTimestamp(cooldownUntilMs))
    }
    if (signal?.aborted) return failure('cancelled')

    try {
      const response = await deps.fetch(url, {
        method: 'GET',
        headers: { Authorization: apiKey },
        signal,
        timeoutMs: requestTimeoutMs
      })
      if (response.status === 401 || response.status === 403) return failure('unauthorized')
      if (response.status === 404) return failure('notFound')
      if (response.status === 429) return failure('rateLimited', recordRateLimit(response, now()))
      if (response.status >= 500 && response.status <= 599) return failure('serviceUnavailable')
      if (response.status < 200 || response.status >= 300) return failure('invalidResponse')

      const contentLength = parseNonNegativeNumber(response.headers.get('content-length'))
      if (contentLength !== undefined && contentLength > JIMAKU_MAX_RESPONSE_BYTES) {
        return failure('invalidResponse')
      }

      const bytes = await readBody(response, JIMAKU_MAX_RESPONSE_BYTES)
      const value = parse(JSON.parse(new TextDecoder().decode(bytes)))
      return value === undefined ? failure('invalidResponse') : success(value)
    } catch (error) {
      if (signal?.aborted) return failure('cancelled')
      if (isTimeoutError(error)) return failure('timeout')
      if (error instanceof HttpBodyTooLargeError || error instanceof SyntaxError) {
        return failure('invalidResponse')
      }
      return failure('network')
    }
  }

  return {
    searchEntries(input, signal) {
      if (!isRecord(input) || typeof input.query !== 'string' || typeof input.anime !== 'boolean') {
        return Promise.resolve(failure('invalidRequest'))
      }

      const query = input.query.trim()
      if (query === '' || [...query].length > JIMAKU_MAX_QUERY_LENGTH) {
        return Promise.resolve(failure('invalidRequest'))
      }

      const params = new URLSearchParams({ query, anime: String(input.anime) })
      return request(`${JIMAKU_API_BASE}/entries/search?${params.toString()}`, parseEntries, signal)
    },

    getEntry(id, signal) {
      if (!isPositiveSafeInteger(id)) return Promise.resolve(failure('invalidRequest'))
      return request(`${JIMAKU_API_BASE}/entries/${id}`, parseEntry, signal)
    },

    listFiles(entryId, signal) {
      if (!isPositiveSafeInteger(entryId)) return Promise.resolve(failure('invalidRequest'))
      return request(`${JIMAKU_API_BASE}/entries/${entryId}/files`, parseFiles, signal)
    }
  }

  function recordRateLimit(response: HttpResponse, currentTime: number): string {
    const resetAfter = parseNonNegativeNumber(response.headers.get('x-ratelimit-reset-after'))
    const resetTimestamp = parseNonNegativeNumber(response.headers.get('x-ratelimit-reset'))
    const requestedUntil =
      resetAfter === undefined
        ? resetTimestamp === undefined
          ? currentTime + JIMAKU_RATE_LIMIT_FALLBACK_MS
          : resetTimestamp * 1000
        : currentTime + resetAfter * 1000

    cooldownUntilMs = Math.max(cooldownUntilMs ?? 0, requestedUntil)
    return toIsoTimestamp(cooldownUntilMs)
  }
}

function buildEntry(raw: unknown): JimakuEntry | undefined {
  if (!isRecord(raw)) return undefined
  if (!isPositiveSafeInteger(raw.id) || typeof raw.name !== 'string' || raw.name.trim() === '') {
    return undefined
  }

  const flags = parseFlags(raw.flags)
  if (flags === undefined) return undefined

  const englishName = optionalString(raw.english_name)
  const japaneseName = optionalString(raw.japanese_name)
  const anilistId = optionalId(raw.anilist_id)
  const tmdbId = optionalString(raw.tmdb_id)
  if (
    englishName === INVALID ||
    japaneseName === INVALID ||
    anilistId === INVALID ||
    tmdbId === INVALID
  ) {
    return undefined
  }

  return {
    id: raw.id,
    name: raw.name,
    flags,
    ...(englishName === undefined ? {} : { englishName }),
    ...(japaneseName === undefined ? {} : { japaneseName }),
    ...(anilistId === undefined ? {} : { anilistId }),
    ...(tmdbId === undefined ? {} : { tmdbId })
  }
}

function parseEntry(raw: unknown): JimakuEntry | undefined {
  return buildEntry(raw)
}

function parseEntries(raw: unknown): JimakuEntry[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const entries: JimakuEntry[] = []
  for (const item of raw) {
    const entry = buildEntry(item)
    if (entry === undefined) return undefined
    entries.push(entry)
  }
  return entries
}

function parseFiles(raw: unknown): JimakuFileRecord[] | undefined {
  if (!Array.isArray(raw)) return undefined
  const files: JimakuFileRecord[] = []
  for (const item of raw) {
    if (!isRecord(item)) return undefined
    if (
      typeof item.name !== 'string' ||
      item.name.trim() === '' ||
      typeof item.url !== 'string' ||
      item.url.trim() === '' ||
      !isNonNegativeSafeInteger(item.size) ||
      typeof item.last_modified !== 'string' ||
      item.last_modified.trim() === ''
    ) {
      return undefined
    }
    files.push({
      name: item.name,
      url: item.url,
      size: item.size,
      lastModified: item.last_modified
    })
  }
  return files
}

function parseFlags(raw: unknown): JimakuEntry['flags'] | undefined {
  if (!isRecord(raw)) return undefined
  const anime = optionalBoolean(raw.anime)
  const movie = optionalBoolean(raw.movie)
  const external = optionalBoolean(raw.external)
  const unverified = optionalBoolean(raw.unverified)
  const adult = optionalBoolean(raw.adult)
  if (
    anime === INVALID ||
    movie === INVALID ||
    external === INVALID ||
    unverified === INVALID ||
    adult === INVALID
  ) {
    return undefined
  }
  return {
    anime: anime ?? false,
    movie: movie ?? false,
    external: external ?? false,
    unverified: unverified ?? false,
    adult: adult ?? false
  }
}

function optionalBoolean(value: unknown): boolean | undefined | typeof INVALID {
  if (value === undefined) return undefined
  return typeof value === 'boolean' ? value : INVALID
}

function optionalString(value: unknown): string | undefined | typeof INVALID {
  if (value === undefined || value === null) return undefined
  return typeof value === 'string' ? value : INVALID
}

function optionalId(value: unknown): number | undefined | typeof INVALID {
  if (value === undefined || value === null) return undefined
  return isPositiveSafeInteger(value) ? value : INVALID
}

function parseNonNegativeNumber(value: string | null): number | undefined {
  if (value === null || value.trim() === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

function toIsoTimestamp(epochMs: number): string {
  return new Date(epochMs).toISOString()
}

function success<T>(value: T): JimakuResult<T> {
  return { ok: true, value }
}

function failure<T>(code: JimakuErrorCode, retryAt?: string): JimakuResult<T> {
  return {
    ok: false,
    error: retryAt === undefined ? { code } : { code, retryAt }
  }
}
