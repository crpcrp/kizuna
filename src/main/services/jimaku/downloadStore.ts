import { createHash, randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathApiFor } from '../../platformPath'
import { decodeSubtitleBytes } from '../../media/subtitleEncoding'
import { pickParser } from '../../media/subtitleLoader'
import type { Cue } from '../../../shared/cue'
import type { JimakuSubtitleProvenance } from '../../../shared/mediaHistory'
import { HttpBodyTooLargeError, isTimeoutError, readBody, type HttpFetch } from '../http'
import { JIMAKU_API_ORIGIN, type JimakuFileRecord } from './client'
import { isRecord, isPositiveSafeInteger } from '../../../shared/guards'
import { fail, ok } from './result'

export const JIMAKU_DOWNLOAD_ORIGIN = JIMAKU_API_ORIGIN
export const JIMAKU_DOWNLOAD_MAX_BYTES = 10 * 1024 * 1024
export const JIMAKU_ARCHIVE_DOWNLOAD_MAX_BYTES = 50 * 1024 * 1024
export const JIMAKU_DOWNLOAD_TIMEOUT_MS = 60_000
export const JIMAKU_MAX_REDIRECTS = 3
export const JIMAKU_CACHE_MAX_BYTES = 100 * 1024 * 1024
export const JIMAKU_TEMP_MAX_AGE_MS = 24 * 60 * 60 * 1000
export const JIMAKU_DOWNLOAD_INDEX_NAME = 'index.json'

const DEFAULT_LIMITS = {
  maxDownloadBytes: JIMAKU_DOWNLOAD_MAX_BYTES,
  tempMaxAgeMs: JIMAKU_TEMP_MAX_AGE_MS,
  maxCacheBytes: JIMAKU_CACHE_MAX_BYTES
}

const INDEX_VERSION = 1
const TEMP_PREFIX = '.jimaku-'

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
    archiveMemberName?: string
  }
}

export interface JimakuPreparedPackage {
  /** Opaque handle used only by the main-process archive service. */
  handle: string
  /** SHA-256 of the original ZIP bytes. */
  contentVersion: string
  originalName: string
  format: 'zip'
  /** Owned by main; never derive this path from renderer input. */
  managedPath: string
  size: number
  provenance: {
    entryId: number
    remoteFilename: string
    remoteRevision: string
  }
}

export type JimakuPreparedDownload = JimakuPreparedSubtitle | JimakuPreparedPackage

export interface JimakuManagedSubtitle {
  path: string
  bytes: Uint8Array
  format: JimakuSubtitleFormat
}

interface CreateJimakuDownloadStoreDeps {
  fetch: HttpFetch
  cacheRoot: string
  limits?: Partial<typeof DEFAULT_LIMITS>
}

export interface JimakuDownloadStore {
  prepareDirect(
    entryId: number,
    file: JimakuFileRecord,
    signal?: AbortSignal
  ): Promise<JimakuDownloadResult<JimakuPreparedSubtitle>>
  preparePackage(
    entryId: number,
    file: JimakuFileRecord,
    signal?: AbortSignal
  ): Promise<JimakuDownloadResult<JimakuPreparedPackage>>
  prepareExtracted(
    entryId: number,
    sourceFile: JimakuFileRecord,
    memberName: string,
    bytes: Uint8Array,
    signal?: AbortSignal
  ): Promise<JimakuDownloadResult<JimakuPreparedSubtitle>>
  readManagedSubtitle(
    provenance: JimakuSubtitleProvenance
  ): Promise<JimakuManagedSubtitle | undefined>
  lookupPrepared(handle: string): JimakuPreparedDownload | undefined
  readPrepared(handle: string): Promise<Uint8Array | undefined>
  lookupCached(entryId: number, file: JimakuFileRecord): Promise<JimakuPreparedSubtitle | undefined>
  lookupCachedPackage(
    entryId: number,
    file: JimakuFileRecord
  ): Promise<JimakuPreparedPackage | undefined>
  releasePrepared(handle: string): void
  /** Removes stale temporary files and unprotected completed cache files. */
  cleanup(protectedPaths?: Iterable<string>): Promise<void>
}

interface CacheIndexEntry {
  entryId: number
  remoteFilename: string
  remoteSize: number
  remoteRevision: string
  contentVersion: string
  format: JimakuManagedFormat
  originalName?: string
  archiveMemberName?: string
  byteSize: number
  lastUsedAt: number
}

interface CacheIndex {
  version: typeof INDEX_VERSION
  entries: Record<string, CacheIndexEntry>
}

type JimakuManagedFormat = JimakuSubtitleFormat | 'zip'
type PreparedKind = 'subtitle' | 'zip'

interface DownloadedContent {
  bytes: Uint8Array
  format: JimakuManagedFormat
  contentVersion: string
}

/**
 * Owns Jimaku downloads and their small JSON cache index. ZIP bytes are only
 * prepared as main-process package inputs; archive inspection is separate.
 */
export function createJimakuDownloadStore(
  deps: CreateJimakuDownloadStoreDeps
): JimakuDownloadStore {
  const {
    maxDownloadBytes: maxBytes,
    tempMaxAgeMs,
    maxCacheBytes
  } = { ...DEFAULT_LIMITS, ...deps.limits }
  const timeoutMs = JIMAKU_DOWNLOAD_TIMEOUT_MS
  const maxPackageBytes = JIMAKU_ARCHIVE_DOWNLOAD_MAX_BYTES
  const maxRedirects = JIMAKU_MAX_REDIRECTS
  const indexPath = join(deps.cacheRoot, JIMAKU_DOWNLOAD_INDEX_NAME)

  let index: CacheIndex | undefined
  let operationTail = Promise.resolve()
  let temporaryCounter = 0
  let handleCounter = 0
  const active = new Map<string, JimakuPreparedDownload>()
  const safeUnlink = async (path: string): Promise<boolean> => {
    try {
      await fs.unlink(path)
      return true
    } catch {
      return false
    }
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
    return join(deps.cacheRoot, name)
  }

  function contentPath(contentVersion: string, format: JimakuManagedFormat): string {
    return join(deps.cacheRoot, `${contentVersion}.${format}`)
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
    await fs.mkdir(deps.cacheRoot, { recursive: true })
    const path = temporaryPath('index')
    try {
      await fs.writeFile(path, JSON.stringify(index ?? emptyIndex()))
      await fs.rename(path, indexPath)
    } catch (error) {
      await safeUnlink(path)
      throw error
    }
  }

  async function findCached(
    entryId: number,
    file: JimakuFileRecord,
    removeMissing: boolean,
    archiveMemberName?: string
  ): Promise<CacheIndexEntry | undefined> {
    const currentIndex = await ensureIndex()
    const key = jimakuCacheKey(entryId, file, archiveMemberName)
    const cached = currentIndex.entries[key]
    if (cached === undefined || !cacheEntryMatchesFile(cached, entryId, file, archiveMemberName))
      return undefined

    const path = contentPath(cached.contentVersion, cached.format)
    try {
      const details = await fs.stat(path)
      if (!details.isFile() || details.size !== cached.byteSize) throw new Error('cache miss')
    } catch {
      if (removeMissing) {
        delete currentIndex.entries[key]
        await saveIndex().catch(() => {})
      }
      return undefined
    }

    return cached
  }

  function makePrepared(entry: CacheIndexEntry): JimakuPreparedDownload {
    const handle = `jimaku-${(handleCounter += 1)}-${randomBytes(12).toString('hex')}`
    const common = {
      handle,
      contentVersion: entry.contentVersion,
      format: entry.format,
      managedPath: contentPath(entry.contentVersion, entry.format),
      size: entry.byteSize,
      provenance: {
        entryId: entry.entryId,
        remoteFilename: entry.remoteFilename,
        remoteRevision: entry.remoteRevision,
        ...(entry.archiveMemberName === undefined
          ? {}
          : { archiveMemberName: entry.archiveMemberName })
      }
    }
    if (entry.format === 'zip') {
      const prepared: JimakuPreparedPackage = {
        ...common,
        originalName: entry.originalName ?? entry.remoteFilename,
        format: 'zip',
        provenance: {
          entryId: entry.entryId,
          remoteFilename: entry.remoteFilename,
          remoteRevision: entry.remoteRevision
        }
      }
      active.set(handle, prepared)
      return prepared
    }

    const prepared: JimakuPreparedSubtitle = {
      ...common,
      originalName: entry.originalName ?? entry.archiveMemberName ?? entry.remoteFilename,
      format: entry.format,
      provenance: common.provenance
    }
    active.set(handle, prepared)
    return prepared
  }

  async function touchCache(cached: CacheIndexEntry): Promise<void> {
    const previous = cached.lastUsedAt
    cached.lastUsedAt = Date.now()
    try {
      await saveIndex()
    } catch {
      cached.lastUsedAt = previous
    }
  }

  async function installContent(downloaded: DownloadedContent): Promise<string> {
    const finalPath = contentPath(downloaded.contentVersion, downloaded.format)
    // Content files are named by hash and installed by atomic rename, so an
    // existing file of the expected size is the same content.
    const installed = async (): Promise<boolean> => {
      try {
        return (await fs.stat(finalPath)).size === downloaded.bytes.byteLength
      } catch {
        return false
      }
    }
    if (await installed()) return finalPath

    await fs.mkdir(deps.cacheRoot, { recursive: true })
    const temporary = temporaryPath('download')
    try {
      await fs.writeFile(temporary, downloaded.bytes)
      await fs.rename(temporary, finalPath)
    } catch (error) {
      await safeUnlink(temporary)
      if (await installed()) return finalPath
      throw error
    }
    return finalPath
  }

  async function storeDownloaded(
    entryId: number,
    file: JimakuFileRecord,
    downloaded: DownloadedContent,
    originalName: string = file.name,
    archiveMemberName?: string
  ): Promise<JimakuDownloadResult<JimakuPreparedDownload>> {
    const key = jimakuCacheKey(entryId, file, archiveMemberName)
    await installContent(downloaded)
    const currentIndex = await ensureIndex()
    const previous = currentIndex.entries[key]
    const entry: CacheIndexEntry = {
      entryId,
      remoteFilename: file.name,
      remoteSize: file.size,
      remoteRevision: file.lastModified,
      contentVersion: downloaded.contentVersion,
      format: downloaded.format,
      ...(originalName === file.name ? {} : { originalName }),
      ...(archiveMemberName === undefined ? {} : { archiveMemberName }),
      byteSize: downloaded.bytes.byteLength,
      lastUsedAt: Date.now()
    }
    currentIndex.entries[key] = entry
    try {
      await saveIndex()
    } catch {
      if (previous === undefined) delete currentIndex.entries[key]
      else currentIndex.entries[key] = previous
      return fail({ code: 'storage' })
    }

    return ok(makePrepared(entry))
  }

  function validateSubtitleBytes(
    bytes: Uint8Array,
    format: JimakuSubtitleFormat
  ): JimakuDownloadResult<true> {
    try {
      const text = decodeSubtitleBytes(bytes, 'auto')
      if (looksLikeHtmlOrLogin(text)) return fail({ code: 'invalidSubtitle' })
      const cues = defaultParseSubtitle(text, format)
      if (!Array.isArray(cues) || cues.length === 0) return fail({ code: 'invalidSubtitle' })
    } catch {
      return fail({ code: 'invalidSubtitle' })
    }
    return ok(true)
  }

  async function prepareRemote(
    entryId: number,
    file: JimakuFileRecord,
    kind: PreparedKind,
    signal?: AbortSignal
  ): Promise<JimakuDownloadResult<JimakuPreparedDownload>> {
    const format = subtitleFormat(file.name)
    if (!isKind(format, kind)) return fail({ code: 'invalidSubtitle' })
    const limit = kind === 'zip' ? maxPackageBytes : maxBytes
    if (kind === 'zip' && file.size > limit) return fail({ code: 'tooLarge' })

    const allowedUrl = allowedDownloadUrl(file.url, entryId)
    if (allowedUrl === undefined) {
      return fail({ code: 'unsupportedDownload', recoveryUrl: recoveryUrl(entryId) })
    }

    try {
      return await exclusive(async () => {
        const cached = await findCached(entryId, file, true)
        if (cached !== undefined && isKind(cached.format, kind)) {
          await touchCache(cached)
          return ok(makePrepared(cached))
        }

        const downloaded = await downloadContent(allowedUrl, entryId, format, limit, signal)
        if (!downloaded.ok) return downloaded
        return await storeDownloaded(entryId, file, downloaded.value)
      })
    } catch {
      return fail({ code: 'storage' })
    }
  }

  async function prepareExtracted(
    entryId: number,
    sourceFile: JimakuFileRecord,
    memberName: string,
    bytes: Uint8Array,
    signal?: AbortSignal
  ): Promise<JimakuDownloadResult<JimakuPreparedSubtitle>> {
    const format = subtitleFormat(memberName)
    if (!isSubtitleFormat(format)) return fail({ code: 'invalidSubtitle' })
    if (signal?.aborted) return fail({ code: 'cancelled' })
    if (bytes.byteLength > maxBytes) return fail({ code: 'tooLarge' })
    const valid = validateSubtitleBytes(bytes, format)
    if (!valid.ok) return valid

    try {
      return await exclusive(async () => {
        if (signal?.aborted) return fail({ code: 'cancelled' })
        const cached = await findCached(entryId, sourceFile, true, memberName)
        if (cached !== undefined && isSubtitleFormat(cached.format)) {
          await touchCache(cached)
          return ok(makePrepared(cached) as JimakuPreparedSubtitle)
        }
        const stored = await storeDownloaded(
          entryId,
          sourceFile,
          {
            bytes: bytes.slice(),
            format,
            contentVersion: sha256(bytes)
          },
          memberName,
          memberName
        )
        if (!stored.ok) return stored
        return ok(stored.value as JimakuPreparedSubtitle)
      })
    } catch {
      return fail({ code: 'storage' })
    }
  }

  async function lookup(
    entryId: number,
    file: JimakuFileRecord,
    kind: PreparedKind
  ): Promise<JimakuPreparedDownload | undefined> {
    if (!isKind(subtitleFormat(file.name), kind)) return undefined
    try {
      return await exclusive(async () => {
        const cached = await findCached(entryId, file, true)
        if (cached === undefined || !isKind(cached.format, kind)) return undefined
        await touchCache(cached)
        return makePrepared(cached)
      })
    } catch {
      return undefined
    }
  }

  async function readManagedSubtitle(
    provenance: JimakuSubtitleProvenance
  ): Promise<JimakuManagedSubtitle | undefined> {
    const format = subtitleFormat(provenance.fileName)
    if (
      provenance.provider !== 'jimaku' ||
      !isPositiveSafeInteger(provenance.entryId) ||
      !isSubtitleFormat(format) ||
      !/^[a-f0-9]{64}$/u.test(provenance.contentVersion)
    ) {
      return undefined
    }

    try {
      return await exclusive(async () => {
        const currentIndex = await ensureIndex()
        const cached = Object.values(currentIndex.entries).find(
          (entry) =>
            entry.entryId === provenance.entryId &&
            entry.contentVersion === provenance.contentVersion &&
            entry.format === format &&
            (entry.originalName ?? entry.remoteFilename) === provenance.fileName &&
            entry.archiveMemberName === provenance.archiveMemberName
        )
        if (!cached) return undefined

        const path = contentPath(cached.contentVersion, cached.format)
        const bytes = await fs.readFile(path)
        if (bytes.byteLength !== cached.byteSize) return undefined
        await touchCache(cached)
        return { path, bytes, format }
      })
    } catch {
      return undefined
    }
  }

  async function cleanup(protectedPaths: Iterable<string> = []): Promise<void> {
    try {
      await exclusive(async () => {
        const canonical = (path: string): string => {
          const resolved = resolve(path)
          return process.platform === 'win32' ? resolved.toLowerCase() : resolved
        }
        const protectedSet = new Set([...protectedPaths].map(canonical))
        for (const prepared of active.values()) protectedSet.add(canonical(prepared.managedPath))

        let entries: Awaited<ReturnType<typeof readDirectory>>
        try {
          entries = await readDirectory(deps.cacheRoot)
        } catch {
          return
        }

        const cutoff = Date.now() - tempMaxAgeMs
        for (const entry of entries) {
          if (!entry.isFile || !entry.name.startsWith(TEMP_PREFIX)) continue
          const path = join(deps.cacheRoot, entry.name)
          if (protectedSet.has(canonical(path))) continue
          if (!Number.isFinite(entry.mtimeMs) || entry.mtimeMs > cutoff) continue
          await safeUnlink(path)
        }

        const currentIndex = await ensureIndex()
        const filesByPath = new Map(
          entries
            .filter((entry) => entry.isFile)
            .map((entry) => [canonical(join(deps.cacheRoot, entry.name)), entry])
        )
        const managed = new Map<
          string,
          { path: string; size: number; lastUsedAt: number; keys: string[] }
        >()
        for (const [key, cached] of Object.entries(currentIndex.entries)) {
          const path = contentPath(cached.contentVersion, cached.format)
          const disk = filesByPath.get(canonical(path))
          if (!disk) continue
          const existing = managed.get(canonical(path))
          if (existing) {
            existing.lastUsedAt = Math.max(existing.lastUsedAt, cached.lastUsedAt)
            existing.keys.push(key)
          } else {
            managed.set(canonical(path), {
              path,
              size: disk.size,
              lastUsedAt: cached.lastUsedAt,
              keys: [key]
            })
          }
        }

        let total = [...managed.values()].reduce((sum, file) => sum + file.size, 0)
        if (total <= maxCacheBytes) return
        let indexChanged = false
        const candidates = [...managed.values()]
          .filter((file) => !protectedSet.has(canonical(file.path)))
          .sort((left, right) => left.lastUsedAt - right.lastUsedAt)
        for (const file of candidates) {
          if (total <= maxCacheBytes) break
          if (!(await safeUnlink(file.path))) continue
          total -= file.size
          indexChanged = true
          for (const key of file.keys) delete currentIndex.entries[key]
        }
        if (indexChanged) await saveIndex().catch(() => {})
      })
    } catch {
      // Cleanup is best effort and must never make startup or playback fail.
    }
  }

  async function downloadContent(
    initialUrl: string,
    entryId: number,
    format: JimakuManagedFormat,
    requestMaxBytes: number,
    signal?: AbortSignal
  ): Promise<JimakuDownloadResult<DownloadedContent>> {
    if (signal?.aborted) return fail({ code: 'cancelled' })

    let bytes: Uint8Array
    try {
      let url = initialUrl
      let redirectCount = 0
      while (true) {
        const response = await deps.fetch(url, {
          method: 'GET',
          redirect: 'manual',
          signal,
          timeoutMs
        })

        if (isRedirect(response.status)) {
          if (redirectCount >= maxRedirects) return fail({ code: 'invalidResponse' })
          const location = response.headers.get('location')
          if (location === null) return fail({ code: 'invalidResponse' })
          let next: URL
          try {
            next = new URL(location, url)
          } catch {
            return fail({ code: 'unsupportedDownload', recoveryUrl: recoveryUrl(entryId) })
          }
          const allowed = allowedDownloadUrl(next.toString(), entryId)
          if (allowed === undefined)
            return fail({ code: 'unsupportedDownload', recoveryUrl: recoveryUrl(entryId) })
          url = allowed
          redirectCount += 1
          continue
        }

        if (response.status === 401 || response.status === 403)
          return fail({ code: 'unauthorized' })
        if (response.status === 404) return fail({ code: 'notFound' })
        if (response.status === 429) return fail({ code: 'rateLimited' })
        if (response.status >= 500 && response.status <= 599) {
          return fail({ code: 'serviceUnavailable' })
        }
        if (response.status < 200 || response.status >= 300) {
          return fail({ code: 'invalidResponse' })
        }

        const advertisedSize = parseContentLength(response.headers.get('content-length'))
        if (advertisedSize !== undefined && advertisedSize > requestMaxBytes) {
          return fail({ code: 'tooLarge' })
        }

        bytes = await readBody(response, requestMaxBytes)
        break
      }
    } catch (error) {
      if (signal?.aborted) return fail({ code: 'cancelled' })
      if (isTimeoutError(error)) return fail({ code: 'timeout' })
      if (error instanceof HttpBodyTooLargeError) return fail({ code: 'tooLarge' })
      return fail({ code: 'network' })
    }

    if (isSubtitleFormat(format)) {
      const valid = validateSubtitleBytes(bytes, format)
      if (!valid.ok) return valid
    }

    return ok({ bytes, format, contentVersion: sha256(bytes) })
  }

  return {
    prepareDirect: (entryId, file, signal) =>
      prepareRemote(entryId, file, 'subtitle', signal) as Promise<
        JimakuDownloadResult<JimakuPreparedSubtitle>
      >,
    preparePackage: (entryId, file, signal) =>
      prepareRemote(entryId, file, 'zip', signal) as Promise<
        JimakuDownloadResult<JimakuPreparedPackage>
      >,
    prepareExtracted,
    readManagedSubtitle,
    lookupPrepared: (handle) => active.get(handle),
    readPrepared: async (handle) => {
      const prepared = active.get(handle)
      if (prepared === undefined) return undefined
      return fs.readFile(prepared.managedPath).catch(() => undefined)
    },
    lookupCached: (entryId, file) =>
      lookup(entryId, file, 'subtitle') as Promise<JimakuPreparedSubtitle | undefined>,
    lookupCachedPackage: (entryId, file) =>
      lookup(entryId, file, 'zip') as Promise<JimakuPreparedPackage | undefined>,
    releasePrepared: (handle) => {
      active.delete(handle)
    },
    cleanup
  }
}

export function jimakuCacheKey(
  entryId: number,
  file: JimakuFileRecord,
  archiveMemberName?: string
): string {
  const key = [entryId, file.name, file.size, file.lastModified]
  if (archiveMemberName !== undefined) key.push(archiveMemberName)
  return JSON.stringify(key)
}

/** Checks the main-owned filename shape used for downloaded subtitle content. */
export function isJimakuManagedSubtitlePath(
  path: string,
  provenance: JimakuSubtitleProvenance,
  cacheRoot: string,
  platform: NodeJS.Platform = process.platform
): boolean {
  if (
    provenance.provider !== 'jimaku' ||
    !/^[a-f0-9]{64}$/u.test(provenance.contentVersion) ||
    typeof path !== 'string' ||
    typeof cacheRoot !== 'string'
  ) {
    return false
  }
  const pathApi = pathApiFor(platform)
  const canonical = (value: string): string => {
    const resolved = pathApi.resolve(value)
    return platform === 'win32' ? resolved.toLowerCase() : resolved
  }
  const normalizedPath = canonical(path)
  return (['srt', 'ass', 'ssa'] as const).some(
    (format) =>
      normalizedPath ===
      canonical(pathApi.join(cacheRoot, `${provenance.contentVersion}.${format}`))
  )
}

function defaultParseSubtitle(text: string, format: JimakuSubtitleFormat): readonly Cue[] {
  return pickParser(`jimaku.${format}`)(text)
}

function subtitleFormat(name: string): JimakuManagedFormat | undefined {
  const dot = name.lastIndexOf('.')
  if (dot < 0) return undefined
  const extension = name.slice(dot + 1).toLowerCase()
  if (extension === 'srt' || extension === 'ass' || extension === 'ssa' || extension === 'zip') {
    return extension
  }
  return undefined
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

function parseContentLength(value: string | null): number | undefined {
  if (value === null || value.trim() === '') return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : undefined
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

/** Checks only the fields that build a content path or match a request; anything else is a miss. */
function isCacheIndexEntry(value: unknown): value is CacheIndexEntry {
  return (
    isRecord(value) &&
    typeof value.entryId === 'number' &&
    typeof value.remoteFilename === 'string' &&
    typeof value.contentVersion === 'string' &&
    /^[a-f0-9]{64}$/u.test(value.contentVersion) &&
    isManagedFormat(value.format)
  )
}

function cacheEntryMatchesFile(
  entry: CacheIndexEntry,
  entryId: number,
  file: JimakuFileRecord,
  archiveMemberName?: string
): boolean {
  return (
    entry.entryId === entryId &&
    entry.remoteFilename === file.name &&
    entry.remoteSize === file.size &&
    entry.remoteRevision === file.lastModified &&
    entry.archiveMemberName === archiveMemberName
  )
}

function isSubtitleFormat(value: unknown): value is JimakuSubtitleFormat {
  return value === 'srt' || value === 'ass' || value === 'ssa'
}

function isManagedFormat(value: unknown): value is JimakuManagedFormat {
  return isSubtitleFormat(value) || value === 'zip'
}

function isKind(
  format: JimakuManagedFormat | undefined,
  kind: PreparedKind
): format is JimakuManagedFormat {
  return kind === 'zip' ? format === 'zip' : isSubtitleFormat(format)
}

async function readDirectory(directory: string) {
  const entries = await fs.readdir(directory, { withFileTypes: true })
  const files: { name: string; size: number; mtimeMs: number; isFile: boolean }[] = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    try {
      const details = await fs.stat(join(directory, entry.name))
      files.push({ name: entry.name, size: details.size, mtimeMs: details.mtimeMs, isFile: true })
    } catch {
      // A concurrent cleanup can remove an entry between readdir and stat.
    }
  }
  return files
}
