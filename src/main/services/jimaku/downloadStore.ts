import { createHash, randomBytes } from 'node:crypto'
import { mkdir, readdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { pathApiFor } from '../../platformPath'
import { decodeSubtitleBytes } from '../../media/subtitleEncoding'
import { pickParser } from '../../media/subtitleLoader'
import type { Cue } from '../../../shared/cue'
import type { HttpFetch, HttpResponse } from '../http'
import { JIMAKU_API_ORIGIN, type JimakuFileRecord } from './client'

export const JIMAKU_DOWNLOAD_ORIGIN = JIMAKU_API_ORIGIN
export const JIMAKU_DOWNLOAD_MAX_BYTES = 10 * 1024 * 1024
export const JIMAKU_DOWNLOAD_TIMEOUT_MS = 60_000
export const JIMAKU_MAX_REDIRECTS = 3
export const JIMAKU_CACHE_MAX_BYTES = 100 * 1024 * 1024
export const JIMAKU_TEMP_MAX_AGE_MS = 24 * 60 * 60 * 1000
export const JIMAKU_DOWNLOAD_INDEX_NAME = 'index.json'

const INDEX_VERSION = 1
const TEMP_PREFIX = '.jimaku-'
const TIMEOUT = Symbol('jimaku-download-timeout')
const CANCELLED = Symbol('jimaku-download-cancelled')
const TOO_LARGE = Symbol('jimaku-download-too-large')

type TimerHandle = ReturnType<typeof setTimeout>
type SetTimeoutFn = (callback: () => void, delayMs: number) => TimerHandle
type ClearTimeoutFn = (handle: TimerHandle) => void

export type JimakuSubtitleFormat = 'srt' | 'ass' | 'ssa'

export type JimakuDownloadErrorCode =
  | 'cancelled'
  | 'timeout'
  | 'network'
  | 'unauthorized'
  | 'notFound'
  | 'rateLimited'
  | 'serviceUnavailable'
  | 'invalidResponse'
  | 'tooLarge'
  | 'invalidSubtitle'
  | 'unsupportedDownload'
  | 'storage'

export interface JimakuDownloadError {
  code: JimakuDownloadErrorCode
  /** Main-process recovery action for URLs that are not downloadable. */
  recoveryUrl?: string
}

export type JimakuDownloadResult<T> =
  { ok: true; value: T } | { ok: false; error: JimakuDownloadError }

export interface JimakuPreparedSubtitle {
  /** Opaque handle used by main-process consumers to retain this preparation. */
  handle: string
  /** SHA-256 of the original downloaded bytes, not decoded subtitle text. */
  contentVersion: string
  originalName: string
  format: JimakuSubtitleFormat
  /** Owned by main; never derive this path from renderer input. */
  managedPath: string
  size: number
  provenance: {
    entryId: number
    remoteFilename: string
    remoteRevision: string
  }
}

export interface JimakuDownloadFileStat {
  size: number
  mtimeMs: number
  isFile?: boolean
}

export interface JimakuDownloadDirEntry extends JimakuDownloadFileStat {
  name: string
}

/** All disk access is injected so the store is testable without user files. */
export interface JimakuDownloadFs {
  mkdir(path: string): Promise<void>
  readFile(path: string): Promise<Uint8Array>
  writeFile(path: string, data: Uint8Array | string): Promise<void>
  rename(from: string, to: string): Promise<void>
  unlink(path: string): Promise<void>
  readDirectory(path: string): Promise<readonly JimakuDownloadDirEntry[]>
  stat(path: string): Promise<JimakuDownloadFileStat>
}

/** Production node:fs adapter. Tests use an in-memory implementation. */
export const nodeJimakuDownloadFs: JimakuDownloadFs = {
  mkdir: async (path) => {
    await mkdir(path, { recursive: true })
  },
  readFile: async (path) => readFile(path),
  writeFile: async (path, data) => {
    await writeFile(path, data)
  },
  rename: (from, to) => rename(from, to),
  unlink: (path) => unlink(path),
  readDirectory: async (directory) => {
    const pathApi = pathApiFor()
    const entries = await readdir(directory, { withFileTypes: true })
    const files: JimakuDownloadDirEntry[] = []
    for (const entry of entries) {
      if (!entry.isFile()) continue
      try {
        const details = await stat(pathApi.join(directory, entry.name))
        files.push({
          name: entry.name,
          size: details.size,
          mtimeMs: details.mtimeMs,
          isFile: true
        })
      } catch {
        // A concurrent cleanup can remove an entry between readdir and stat.
      }
    }
    return files
  },
  stat: async (path) => {
    const details = await stat(path)
    return { size: details.size, mtimeMs: details.mtimeMs, isFile: details.isFile() }
  }
}

export type JimakuSubtitleParser = (text: string, format: JimakuSubtitleFormat) => readonly Cue[]

export interface CreateJimakuDownloadStoreDeps {
  fetch: HttpFetch
  cacheRoot: string
  fs?: JimakuDownloadFs
  now?: () => number
  parseSubtitle?: JimakuSubtitleParser
  downloadTimeoutMs?: number
  maxDownloadBytes?: number
  maxRedirects?: number
  tempMaxAgeMs?: number
  setTimeoutFn?: SetTimeoutFn
  clearTimeoutFn?: ClearTimeoutFn
  platform?: NodeJS.Platform
}

export interface JimakuDownloadStore {
  prepareDirect(
    entryId: number,
    file: JimakuFileRecord,
    signal?: AbortSignal
  ): Promise<JimakuDownloadResult<JimakuPreparedSubtitle>>
  lookupPrepared(handle: string): JimakuPreparedSubtitle | undefined
  lookupCached(entryId: number, file: JimakuFileRecord): Promise<JimakuPreparedSubtitle | undefined>
  releasePrepared(handle: string): void
  /** Removes stale temporary files; completed-file eviction is deferred to the history slice. */
  cleanup(protectedPaths?: Iterable<string>): Promise<void>
}

interface CacheIndexEntry {
  entryId: number
  remoteFilename: string
  remoteSize: number
  remoteRevision: string
  contentVersion: string
  format: JimakuSubtitleFormat
  byteSize: number
  lastUsedAt: number
}

interface CacheIndex {
  version: typeof INDEX_VERSION
  entries: Record<string, CacheIndexEntry>
}

interface DownloadedSubtitle {
  bytes: Uint8Array
  format: JimakuSubtitleFormat
  contentVersion: string
}

/**
 * Owns direct Jimaku subtitle downloads and their small JSON cache index.
 * This slice deliberately has no renderer, player, history, or ZIP behavior.
 */
export function createJimakuDownloadStore(
  deps: CreateJimakuDownloadStoreDeps
): JimakuDownloadStore {
  const fs = deps.fs ?? nodeJimakuDownloadFs
  const now = deps.now ?? Date.now
  const parseSubtitle = deps.parseSubtitle ?? defaultParseSubtitle
  const timeoutMs = deps.downloadTimeoutMs ?? JIMAKU_DOWNLOAD_TIMEOUT_MS
  const maxBytes = deps.maxDownloadBytes ?? JIMAKU_DOWNLOAD_MAX_BYTES
  const maxRedirects = deps.maxRedirects ?? JIMAKU_MAX_REDIRECTS
  const tempMaxAgeMs = deps.tempMaxAgeMs ?? JIMAKU_TEMP_MAX_AGE_MS
  const setTimeoutFn = deps.setTimeoutFn ?? ((callback, delayMs) => setTimeout(callback, delayMs))
  const clearTimeoutFn =
    deps.clearTimeoutFn ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>))
  const pathApi = pathApiFor(deps.platform)
  const indexPath = pathApi.join(deps.cacheRoot, JIMAKU_DOWNLOAD_INDEX_NAME)

  let index: CacheIndex | undefined
  let operationTail = Promise.resolve()
  let temporaryCounter = 0
  let handleCounter = 0
  const active = new Map<string, JimakuPreparedSubtitle>()
  const temporaryPaths = new Set<string>()
  const safeUnlink = async (path: string): Promise<void> => {
    await fs.unlink(path).catch(() => {})
  }

  function exclusive<T>(work: () => Promise<T>): Promise<T> {
    const operation = operationTail.then(work, work)
    operationTail = operation.then(
      () => undefined,
      () => undefined
    )
    return operation
  }

  function temporaryPath(kind: 'download' | 'index'): string {
    const name = `${TEMP_PREFIX}${kind}-${process.pid}-${(temporaryCounter += 1)}-${randomBytes(8).toString('hex')}.tmp`
    return pathApi.join(deps.cacheRoot, name)
  }

  function contentPath(contentVersion: string, format: JimakuSubtitleFormat): string {
    return pathApi.join(deps.cacheRoot, `${contentVersion}.${format}`)
  }

  async function ensureIndex(): Promise<CacheIndex> {
    if (index !== undefined) return index

    try {
      index = parseIndex(await fs.readFile(indexPath))
    } catch {
      // Missing and corrupt indexes are both recoverable misses. Never remove
      // completed files while recovering, because history may still reference them.
      index = emptyIndex()
    }
    return index
  }

  async function saveIndex(): Promise<void> {
    await fs.mkdir(deps.cacheRoot)
    const path = temporaryPath('index')
    temporaryPaths.add(path)
    try {
      await fs.writeFile(path, JSON.stringify(index ?? emptyIndex()))
      await fs.rename(path, indexPath)
      temporaryPaths.delete(path)
    } finally {
      if (temporaryPaths.has(path)) {
        temporaryPaths.delete(path)
        await safeUnlink(path)
      }
    }
  }

  async function findCached(
    entryId: number,
    file: JimakuFileRecord,
    removeMissing: boolean
  ): Promise<CacheIndexEntry | undefined> {
    const currentIndex = await ensureIndex()
    const key = jimakuCacheKey(entryId, file)
    const cached = currentIndex.entries[key]
    if (cached === undefined || !cacheEntryMatchesFile(cached, entryId, file)) return undefined

    const path = contentPath(cached.contentVersion, cached.format)
    try {
      const details = await fs.stat(path)
      if (details.isFile === false || details.size !== cached.byteSize)
        throw new Error('cache miss')
    } catch {
      if (removeMissing) {
        delete currentIndex.entries[key]
        await saveIndex().catch(() => {})
      }
      return undefined
    }

    return cached
  }

  function makePrepared(entry: CacheIndexEntry): JimakuPreparedSubtitle {
    const handle = `jimaku-${(handleCounter += 1)}-${randomBytes(12).toString('hex')}`
    const prepared: JimakuPreparedSubtitle = {
      handle,
      contentVersion: entry.contentVersion,
      originalName: entry.remoteFilename,
      format: entry.format,
      managedPath: contentPath(entry.contentVersion, entry.format),
      size: entry.byteSize,
      provenance: {
        entryId: entry.entryId,
        remoteFilename: entry.remoteFilename,
        remoteRevision: entry.remoteRevision
      }
    }
    active.set(handle, prepared)
    return prepared
  }

  async function touchCache(cached: CacheIndexEntry): Promise<void> {
    const previous = cached.lastUsedAt
    cached.lastUsedAt = safeNow(now())
    try {
      await saveIndex()
    } catch {
      cached.lastUsedAt = previous
    }
  }

  async function installContent(downloaded: DownloadedSubtitle): Promise<string> {
    const finalPath = contentPath(downloaded.contentVersion, downloaded.format)

    try {
      const existing = await fs.readFile(finalPath)
      if (
        existing.byteLength === downloaded.bytes.byteLength &&
        sha256(existing) === downloaded.contentVersion
      ) {
        return finalPath
      }
      await safeUnlink(finalPath)
    } catch {
      // The content file is either absent or was not readable; the atomic
      // replacement below will establish a valid managed file.
    }

    await fs.mkdir(deps.cacheRoot)
    const temporary = temporaryPath('download')
    temporaryPaths.add(temporary)
    try {
      await fs.writeFile(temporary, downloaded.bytes)
      try {
        await fs.rename(temporary, finalPath)
        temporaryPaths.delete(temporary)
      } catch (error) {
        // Another preparation may have installed the same hash first. Reuse
        // it only after verifying the bytes, never a partial or foreign file.
        try {
          const existing = await fs.readFile(finalPath)
          if (
            existing.byteLength !== downloaded.bytes.byteLength ||
            sha256(existing) !== downloaded.contentVersion
          ) {
            throw error
          }
          temporaryPaths.delete(temporary)
          await safeUnlink(temporary)
        } catch {
          throw error
        }
      }
      return finalPath
    } finally {
      if (temporaryPaths.has(temporary)) {
        temporaryPaths.delete(temporary)
        await safeUnlink(temporary)
      }
    }
  }

  async function prepareDirect(
    entryId: number,
    file: JimakuFileRecord,
    signal?: AbortSignal
  ): Promise<JimakuDownloadResult<JimakuPreparedSubtitle>> {
    const format = subtitleFormat(file.name)
    if (!isValidFileRecord(entryId, file) || format === undefined) {
      return failure('invalidSubtitle')
    }

    const allowedUrl = allowedDownloadUrl(file.url, entryId)
    if (allowedUrl === undefined) {
      return failure('unsupportedDownload', recoveryUrl(entryId))
    }

    try {
      return await exclusive(async () => {
        const key = jimakuCacheKey(entryId, file)
        const cached = await findCached(entryId, file, true)
        if (cached !== undefined) {
          await touchCache(cached)
          return success(makePrepared(cached))
        }

        const downloaded = await downloadDirect(allowedUrl, entryId, format, signal)
        if (!downloaded.ok) return downloaded

        await installContent(downloaded.value)
        const currentIndex = await ensureIndex()
        const previous = currentIndex.entries[key]
        const entry: CacheIndexEntry = {
          entryId,
          remoteFilename: file.name,
          remoteSize: file.size,
          remoteRevision: file.lastModified,
          contentVersion: downloaded.value.contentVersion,
          format,
          byteSize: downloaded.value.bytes.byteLength,
          lastUsedAt: safeNow(now())
        }
        currentIndex.entries[key] = entry
        try {
          await saveIndex()
        } catch {
          if (previous === undefined) delete currentIndex.entries[key]
          else currentIndex.entries[key] = previous
          return failure('storage')
        }

        return success(makePrepared(entry))
      })
    } catch {
      return failure('storage')
    }
  }

  async function lookupCached(
    entryId: number,
    file: JimakuFileRecord
  ): Promise<JimakuPreparedSubtitle | undefined> {
    if (!isValidFileRecord(entryId, file) || subtitleFormat(file.name) === undefined) {
      return undefined
    }
    try {
      return await exclusive(async () => {
        const cached = await findCached(entryId, file, true)
        if (cached === undefined) return undefined
        await touchCache(cached)
        return makePrepared(cached)
      })
    } catch {
      return undefined
    }
  }

  async function cleanup(protectedPaths: Iterable<string> = []): Promise<void> {
    try {
      await exclusive(async () => {
        const protectedSet = new Set(protectedPaths)
        for (const prepared of active.values()) protectedSet.add(prepared.managedPath)

        let entries: readonly JimakuDownloadDirEntry[]
        try {
          entries = await fs.readDirectory(deps.cacheRoot)
        } catch {
          return
        }

        const cutoff = safeNow(now()) - tempMaxAgeMs
        for (const entry of entries) {
          if (!entry.isFile || !entry.name.startsWith(TEMP_PREFIX)) continue
          const path = pathApi.join(deps.cacheRoot, entry.name)
          if (!isWithinRoot(pathApi, deps.cacheRoot, path)) continue
          if (temporaryPaths.has(path) || protectedSet.has(path)) continue
          if (!Number.isFinite(entry.mtimeMs) || entry.mtimeMs > cutoff) continue
          await safeUnlink(path)
        }
      })
    } catch {
      // Cleanup is best effort and must never make startup or playback fail.
    }
  }

  async function downloadDirect(
    initialUrl: string,
    entryId: number,
    format: JimakuSubtitleFormat,
    signal?: AbortSignal
  ): Promise<JimakuDownloadResult<DownloadedSubtitle>> {
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
      }, timeoutMs)
    })
    const onAbort = () => {
      callerCancelled = true
      controller.abort()
      rejectCancellation?.(CANCELLED)
    }

    signal?.addEventListener('abort', onAbort, { once: true })

    try {
      let url = initialUrl
      let redirectCount = 0
      while (true) {
        let response: HttpResponse
        try {
          response = await Promise.race([
            deps.fetch(url, {
              method: 'GET',
              redirect: 'manual',
              signal: controller.signal
            }),
            timeout,
            cancellation
          ])
        } catch (error) {
          return downloadFailure(error, callerCancelled, timedOut, signal)
        }

        if (callerCancelled || signal?.aborted) return failure('cancelled')
        if (!Number.isInteger(response.status) || response.status < 100) {
          return failure('invalidResponse')
        }

        if (isRedirect(response.status)) {
          if (redirectCount >= maxRedirects) return failure('invalidResponse')
          const location = responseHeader(response, 'location')
          if (location === null) return failure('invalidResponse')
          let next: URL
          try {
            next = new URL(location, url)
          } catch {
            return failure('unsupportedDownload', recoveryUrl(entryId))
          }
          const allowed = allowedDownloadUrl(next.toString(), entryId)
          if (allowed === undefined) return failure('unsupportedDownload', recoveryUrl(entryId))
          url = allowed
          redirectCount += 1
          continue
        }

        if (response.status === 401 || response.status === 403) return failure('unauthorized')
        if (response.status === 404) return failure('notFound')
        if (response.status === 429) return failure('rateLimited')
        if (response.status >= 500 && response.status <= 599) {
          return failure('serviceUnavailable')
        }
        if (response.status < 200 || response.status >= 300) {
          return failure('invalidResponse')
        }

        const advertisedSize = parseContentLength(responseHeader(response, 'content-length'))
        if (advertisedSize !== undefined && advertisedSize > maxBytes) {
          controller.abort()
          return failure('tooLarge')
        }

        let bytes: Uint8Array
        try {
          bytes = await readResponseBytes(response, maxBytes, controller, timeout, cancellation)
        } catch (error) {
          return downloadFailure(error, callerCancelled, timedOut, signal)
        }

        try {
          const text = decodeSubtitleBytes(bytes, 'auto')
          if (looksLikeHtmlOrLogin(text)) return failure('invalidSubtitle')
          const cues = parseSubtitle(text, format)
          if (!Array.isArray(cues) || cues.length === 0) return failure('invalidSubtitle')
        } catch {
          return failure('invalidSubtitle')
        }

        return success({ bytes, format, contentVersion: sha256(bytes) })
      }
    } finally {
      if (timer !== undefined) clearTimeoutFn(timer)
      signal?.removeEventListener('abort', onAbort)
    }
  }

  return {
    prepareDirect,
    lookupPrepared: (handle) => active.get(handle),
    lookupCached,
    releasePrepared: (handle) => {
      active.delete(handle)
    },
    cleanup
  }
}

export function jimakuCacheKey(entryId: number, file: JimakuFileRecord): string {
  return JSON.stringify([entryId, file.name, file.size, file.lastModified])
}

function defaultParseSubtitle(text: string, format: JimakuSubtitleFormat): readonly Cue[] {
  return pickParser(`jimaku.${format}`)(text)
}

function subtitleFormat(name: string): JimakuSubtitleFormat | undefined {
  const dot = name.lastIndexOf('.')
  if (dot < 0) return undefined
  const extension = name.slice(dot + 1).toLowerCase()
  return extension === 'srt' || extension === 'ass' || extension === 'ssa' ? extension : undefined
}

function isValidFileRecord(entryId: number, file: JimakuFileRecord): boolean {
  return (
    Number.isSafeInteger(entryId) &&
    entryId > 0 &&
    typeof file.name === 'string' &&
    file.name.trim() !== '' &&
    Number.isSafeInteger(file.size) &&
    file.size >= 0 &&
    typeof file.lastModified === 'string' &&
    file.lastModified.trim() !== '' &&
    typeof file.url === 'string' &&
    file.url.trim() !== ''
  )
}

function allowedDownloadUrl(value: string, entryId: number): string | undefined {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return undefined
  }
  if (url.origin !== JIMAKU_DOWNLOAD_ORIGIN || url.protocol !== 'https:') return undefined
  const prefix = `/entry/${entryId}/download/`
  if (!url.pathname.startsWith(prefix) || url.pathname.length <= prefix.length) return undefined
  return url.toString()
}

function recoveryUrl(entryId: number): string {
  return `${JIMAKU_DOWNLOAD_ORIGIN}/entry/${entryId}`
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308
}

function responseHeader(response: HttpResponse, name: string): string | null {
  const aliases = [name, name.toLowerCase(), titleCaseHeader(name)]
  for (const alias of aliases) {
    try {
      const value = response.headers.get(alias)
      if (value !== null) return value
    } catch {
      return null
    }
  }
  return null
}

function titleCaseHeader(name: string): string {
  return name
    .split('-')
    .map((part) => `${part[0]?.toUpperCase() ?? ''}${part.slice(1)}`)
    .join('-')
}

function parseContentLength(value: string | null): number | undefined {
  if (value === null || value.trim() === '') return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined
}

async function readResponseBytes(
  response: HttpResponse,
  maxBytes: number,
  controller: AbortController,
  timeout: Promise<never>,
  cancellation: Promise<never>
): Promise<Uint8Array> {
  if (response.body !== undefined && response.body !== null) {
    const iterator = response.body[Symbol.asyncIterator]()
    const chunks: Uint8Array[] = []
    let total = 0
    let completed = false
    try {
      while (true) {
        const result = await Promise.race([iterator.next(), timeout, cancellation])
        if (result.done) {
          completed = true
          break
        }
        const chunk = result.value
        if (!(chunk instanceof Uint8Array)) throw new Error('invalid response body')
        total += chunk.byteLength
        if (total > maxBytes) {
          controller.abort()
          throw TOO_LARGE
        }
        chunks.push(chunk)
      }
      return joinChunks(chunks, total)
    } finally {
      if (!completed) await iterator.return?.().catch(() => {})
    }
  }

  if (response.arrayBuffer !== undefined) {
    const bytes = new Uint8Array(
      await Promise.race([response.arrayBuffer(), timeout, cancellation])
    )
    if (bytes.byteLength > maxBytes) {
      controller.abort()
      throw TOO_LARGE
    }
    return bytes
  }

  const text = await Promise.race([response.text(), timeout, cancellation])
  const bytes = new TextEncoder().encode(text)
  if (bytes.byteLength > maxBytes) {
    controller.abort()
    throw TOO_LARGE
  }
  return bytes
}

function joinChunks(chunks: readonly Uint8Array[], total: number): Uint8Array {
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

function downloadFailure<T>(
  error: unknown,
  callerCancelled: boolean,
  timedOut: boolean,
  signal: AbortSignal | undefined
): JimakuDownloadResult<T> {
  if (error === CANCELLED || callerCancelled || signal?.aborted) return failure('cancelled')
  if (error === TIMEOUT || timedOut) return failure('timeout')
  if (error === TOO_LARGE) return failure('tooLarge')
  return failure('network')
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function looksLikeHtmlOrLogin(text: string): boolean {
  const prefix = text.trimStart().slice(0, 512).toLowerCase()
  return (
    prefix.startsWith('<!doctype html') ||
    prefix.startsWith('<html') ||
    prefix.startsWith('<head') ||
    prefix.startsWith('<body') ||
    prefix.startsWith('<form') ||
    (prefix.includes('<html') && prefix.includes('login'))
  )
}

function emptyIndex(): CacheIndex {
  return { version: INDEX_VERSION, entries: Object.create(null) as Record<string, CacheIndexEntry> }
}

function parseIndex(bytes: Uint8Array): CacheIndex {
  try {
    const raw: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))
    if (!isRecord(raw) || raw.version !== INDEX_VERSION || !isRecord(raw.entries)) {
      return emptyIndex()
    }

    const entries = Object.create(null) as Record<string, CacheIndexEntry>
    for (const [key, value] of Object.entries(raw.entries)) {
      if (isCacheIndexEntry(value)) entries[key] = value
    }
    return { version: INDEX_VERSION, entries }
  } catch {
    return emptyIndex()
  }
}

function isCacheIndexEntry(value: unknown): value is CacheIndexEntry {
  if (!isRecord(value)) return false
  return (
    isPositiveSafeInteger(value.entryId) &&
    typeof value.remoteFilename === 'string' &&
    value.remoteFilename.trim() !== '' &&
    isNonNegativeSafeInteger(value.remoteSize) &&
    typeof value.remoteRevision === 'string' &&
    value.remoteRevision.trim() !== '' &&
    typeof value.contentVersion === 'string' &&
    /^[a-f0-9]{64}$/.test(value.contentVersion) &&
    isSubtitleFormat(value.format) &&
    isNonNegativeSafeInteger(value.byteSize) &&
    typeof value.lastUsedAt === 'number' &&
    Number.isFinite(value.lastUsedAt) &&
    value.lastUsedAt >= 0
  )
}

function cacheEntryMatchesFile(
  entry: CacheIndexEntry,
  entryId: number,
  file: JimakuFileRecord
): boolean {
  return (
    entry.entryId === entryId &&
    entry.remoteFilename === file.name &&
    entry.remoteSize === file.size &&
    entry.remoteRevision === file.lastModified
  )
}

function isSubtitleFormat(value: unknown): value is JimakuSubtitleFormat {
  return value === 'srt' || value === 'ass' || value === 'ssa'
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

function safeNow(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : Date.now()
}

function isWithinRoot(
  pathApi: typeof import('node:path').posix,
  root: string,
  candidate: string
): boolean {
  const relative = pathApi.relative(pathApi.resolve(root), pathApi.resolve(candidate))
  return relative === '' || (!relative.startsWith('..' + pathApi.sep) && relative !== '..')
}

function success<T>(value: T): JimakuDownloadResult<T> {
  return { ok: true, value }
}

function failure<T>(
  code: JimakuDownloadErrorCode,
  recoveryUrlValue?: string
): JimakuDownloadResult<T> {
  return {
    ok: false,
    error: recoveryUrlValue === undefined ? { code } : { code, recoveryUrl: recoveryUrlValue }
  }
}
