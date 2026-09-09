import type {
  JimakuEntry,
  JimakuErrorCode,
  JimakuFile,
  JimakuResult,
  JimakuSearchRequest
} from '../../../shared/jimaku'
import type { HttpFetch, HttpResponse } from '../http'

export const JIMAKU_API_ORIGIN = 'https://jimaku.cc'
export const JIMAKU_API_BASE = `${JIMAKU_API_ORIGIN}/api`
export const JIMAKU_REQUEST_TIMEOUT_MS = 15_000
export const JIMAKU_MAX_QUERY_LENGTH = 200
export const JIMAKU_MAX_RESPONSE_BYTES = 10 * 1024 * 1024

const JIMAKU_RATE_LIMIT_FALLBACK_MS = 60_000

type TimerHandle = ReturnType<typeof setTimeout>
type SetTimeoutFn = (callback: () => void, delayMs: number) => TimerHandle
type ClearTimeoutFn = (handle: TimerHandle) => void

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
  setTimeoutFn?: SetTimeoutFn
  clearTimeoutFn?: ClearTimeoutFn
}

const TIMEOUT = Symbol('jimaku-timeout')
const CANCELLED = Symbol('jimaku-cancelled')
const INVALID = Symbol('jimaku-invalid')

/** Creates a read-only, fixed-origin Jimaku API client. */
export function createJimakuClient(deps: CreateJimakuClientDeps): JimakuClient {
  const now = deps.now ?? Date.now
  const requestTimeoutMs = deps.requestTimeoutMs ?? JIMAKU_REQUEST_TIMEOUT_MS
  const setTimeoutFn = deps.setTimeoutFn ?? ((callback, delayMs) => setTimeout(callback, delayMs))
  const clearTimeoutFn =
    deps.clearTimeoutFn ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>))

  let cooldownUntilMs: number | undefined

  function readApiKey(): string | undefined {
    try {
      const value = deps.getApiKey()
      return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
    } catch {
      return undefined
    }
  }

  async function request<T>(
    url: string,
    parse: (raw: unknown) => T | undefined,
    signal?: AbortSignal
  ): Promise<JimakuResult<T>> {
    const apiKey = readApiKey()
    if (apiKey === undefined) return failure('notConfigured')

    const currentTime = now()
    if (cooldownUntilMs !== undefined && currentTime < cooldownUntilMs) {
      return failure('rateLimited', toIsoTimestamp(cooldownUntilMs))
    }
    if (signal?.aborted) return failure('cancelled')

    const controller = new AbortController()
    let callerCancelled = false
    let timedOut = false
    let timer: TimerHandle | undefined
    let rejectCancellation: ((reason?: unknown) => void) | undefined

    const cancellation = signal
      ? new Promise<never>((_, reject) => {
          rejectCancellation = reject
        })
      : new Promise<never>(() => {})
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeoutFn(() => {
        timedOut = true
        controller.abort()
        reject(TIMEOUT)
      }, requestTimeoutMs)
    })

    const onAbort = () => {
      callerCancelled = true
      controller.abort()
      rejectCancellation?.(CANCELLED)
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    try {
      if (signal?.aborted) {
        onAbort()
        return failure('cancelled')
      }

      let response: HttpResponse
      try {
        response = await Promise.race([
          deps.fetch(url, {
            method: 'GET',
            headers: { Authorization: apiKey },
            signal: controller.signal
          }),
          timeout,
          cancellation
        ])
      } catch (error) {
        return requestFailure(error, callerCancelled, timedOut, signal)
      }

      if (callerCancelled || signal?.aborted) return failure('cancelled')
      if (!Number.isInteger(response.status) || response.status < 100) {
        return failure('invalidResponse')
      }
      if (response.status === 401 || response.status === 403) {
        return failure('unauthorized')
      }
      if (response.status === 404) return failure('notFound')
      if (response.status === 429) {
        const retryAt = recordRateLimit(response, now())
        return failure('rateLimited', retryAt)
      }
      if (response.status >= 500 && response.status <= 599) {
        return failure('serviceUnavailable')
      }
      if (response.status < 200 || response.status >= 300) {
        return failure('invalidResponse')
      }

      const contentLength = parseNonNegativeNumber(getHeader(response, 'content-length'))
      if (contentLength !== undefined && contentLength > JIMAKU_MAX_RESPONSE_BYTES) {
        return failure('invalidResponse')
      }

      let body: string
      try {
        body = await Promise.race([response.text(), timeout, cancellation])
      } catch (error) {
        return requestFailure(error, callerCancelled, timedOut, signal)
      }
      if (callerCancelled || signal?.aborted) return failure('cancelled')
      if (typeof body !== 'string') return failure('invalidResponse')
      if (utf8ByteLength(body) > JIMAKU_MAX_RESPONSE_BYTES) {
        return failure('invalidResponse')
      }

      let raw: unknown
      try {
        raw = JSON.parse(body)
      } catch {
        return failure('invalidResponse')
      }

      try {
        const value = parse(raw)
        return value === undefined ? failure('invalidResponse') : success(value)
      } catch {
        return failure('invalidResponse')
      }
    } finally {
      if (timer !== undefined) clearTimeoutFn(timer)
      signal?.removeEventListener('abort', onAbort)
    }
  }

  return {
    searchEntries(request, signal) {
      if (
        !isRecord(request) ||
        typeof request.query !== 'string' ||
        typeof request.anime !== 'boolean'
      ) {
        return Promise.resolve(failure('invalidRequest'))
      }

      const query = request.query.trim()
      if (query === '' || [...query].length > JIMAKU_MAX_QUERY_LENGTH) {
        return Promise.resolve(failure('invalidRequest'))
      }

      const params = new URLSearchParams({ query, anime: String(request.anime) })
      return requestUrl(
        `${JIMAKU_API_BASE}/entries/search?${params.toString()}`,
        parseEntries,
        signal
      )
    },

    getEntry(id, signal) {
      if (!isPositiveSafeInteger(id)) return Promise.resolve(failure('invalidRequest'))
      return requestUrl(`${JIMAKU_API_BASE}/entries/${id}`, parseEntry, signal)
    },

    listFiles(entryId, signal) {
      if (!isPositiveSafeInteger(entryId)) return Promise.resolve(failure('invalidRequest'))
      return requestUrl(`${JIMAKU_API_BASE}/entries/${entryId}/files`, parseFiles, signal)
    }
  }

  function requestUrl<T>(
    url: string,
    parse: (raw: unknown) => T | undefined,
    signal?: AbortSignal
  ): Promise<JimakuResult<T>> {
    return request(url, parse, signal)
  }

  function recordRateLimit(response: HttpResponse, currentTime: number): string {
    const resetAfter = parseNonNegativeNumber(getHeader(response, 'x-ratelimit-reset-after'))
    const resetTimestamp = parseNonNegativeNumber(getHeader(response, 'x-ratelimit-reset'))
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

function requestFailure<T>(
  error: unknown,
  callerCancelled: boolean,
  timedOut: boolean,
  signal: AbortSignal | undefined
): JimakuResult<T> {
  if (error === CANCELLED || callerCancelled || signal?.aborted) return failure('cancelled')
  if (error === TIMEOUT || timedOut) return failure('timeout')
  return failure('network')
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function parseNonNegativeNumber(value: string | null): number | undefined {
  if (value === null || value.trim() === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

function getHeader(response: HttpResponse, name: string): string | null {
  const aliases = [name, name.toLowerCase(), titleCaseHeader(name)]
  if (name === 'x-ratelimit-reset-after') aliases.push('X-RateLimit-Reset-After')
  if (name === 'x-ratelimit-reset') aliases.push('X-RateLimit-Reset')
  for (const alias of aliases) {
    const value = response.headers.get(alias)
    if (value !== null) return value
  }
  return null
}

function titleCaseHeader(name: string): string {
  return name
    .split('-')
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join('-')
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
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
