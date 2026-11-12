import { createHash, randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathApiFor } from '../../platformPath'
import type { JimakuSubtitleProvenance } from '../../../shared/mediaHistory'
import { isPositiveSafeInteger } from '../../../shared/guards'
import type { HttpFetch } from '../http'
import type { JimakuFileRecord } from './client'
import {
  allowedDownloadUrl,
  downloadContent,
  isSubtitleFormat,
  JIMAKU_DOWNLOAD_ORIGIN,
  subtitleFormat,
  validateSubtitleBytes,
  type JimakuManagedFormat
} from './download'
import { fail, ok } from './result'

export const JIMAKU_ARCHIVE_DOWNLOAD_MAX_BYTES = 50 * 1024 * 1024
const DEFAULT_LIMITS = {
  maxDownloadBytes: 10 * 1024 * 1024,
  tempMaxAgeMs: 24 * 60 * 60 * 1000,
  cacheMaxAgeMs: 30 * 24 * 60 * 60 * 1000,
  maxCacheBytes: 100 * 1024 * 1024
}
const TEMP_PREFIX = '.jimaku-'
const CONTENT_NAME = /^[a-f0-9]{64}\.(srt|ass|ssa|zip)$/u

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
  releasePrepared(handle: string): void
  /** Removes stale temporary files and unprotected completed cache files. */
  cleanup(protectedPaths?: Iterable<string>): Promise<void>
}

export function createJimakuDownloadStore(
  deps: CreateJimakuDownloadStoreDeps
): JimakuDownloadStore {
  const limits = { ...DEFAULT_LIMITS, ...deps.limits }
  const active = new Map<string, JimakuPreparedDownload>()
  let storageTail = Promise.resolve()

  // Order installation and eviction only; HTTP requests remain independent.
  function exclusive<T>(work: () => Promise<T>): Promise<T> {
    const result = storageTail.then(work, work)
    storageTail = result.then(
      () => {},
      () => {}
    )
    return result
  }

  const contentPath = (hash: string, format: JimakuManagedFormat) =>
    join(deps.cacheRoot, `${hash}.${format}`)

  async function store(
    entryId: number,
    file: JimakuFileRecord,
    bytes: Uint8Array,
    format: JimakuManagedFormat,
    signal?: AbortSignal,
    memberName?: string
  ): Promise<JimakuDownloadResult<JimakuPreparedDownload>> {
    try {
      return await exclusive(async () => {
        if (signal?.aborted) return fail({ code: 'cancelled' })
        const contentVersion = createHash('sha256').update(bytes).digest('hex')
        const managedPath = contentPath(contentVersion, format)
        const existing = await fs.stat(managedPath).catch(() => undefined)
        if (!existing?.isFile() || existing.size !== bytes.byteLength) {
          const temporary = join(
            deps.cacheRoot,
            `${TEMP_PREFIX}${randomBytes(12).toString('hex')}.tmp`
          )
          await fs.mkdir(deps.cacheRoot, { recursive: true })
          try {
            await fs.writeFile(temporary, bytes)
            if (signal?.aborted) return fail({ code: 'cancelled' })
            await fs.rename(temporary, managedPath)
          } finally {
            await fs.unlink(temporary).catch(() => {})
          }
        }
        if (signal?.aborted) return fail({ code: 'cancelled' })
        const prepared: JimakuPreparedDownload = {
          handle: `jimaku-${randomBytes(12).toString('hex')}`,
          contentVersion,
          originalName: memberName ?? file.name,
          format,
          managedPath,
          size: bytes.byteLength,
          provenance: {
            entryId,
            remoteFilename: file.name,
            remoteRevision: file.lastModified,
            ...(memberName === undefined ? {} : { archiveMemberName: memberName })
          }
        }
        active.set(prepared.handle, prepared)
        return ok(prepared)
      })
    } catch {
      return fail({ code: 'storage' })
    }
  }

  async function prepareRemote(
    entryId: number,
    file: JimakuFileRecord,
    kind: 'subtitle' | 'zip',
    signal?: AbortSignal
  ): Promise<JimakuDownloadResult<JimakuPreparedDownload>> {
    const format = subtitleFormat(file.name)
    if (format === undefined || (kind === 'zip' ? format !== 'zip' : !isSubtitleFormat(format)))
      return fail({ code: 'invalidSubtitle' })
    if (signal?.aborted) return fail({ code: 'cancelled' })
    const maxBytes = kind === 'zip' ? JIMAKU_ARCHIVE_DOWNLOAD_MAX_BYTES : limits.maxDownloadBytes
    if (file.size > maxBytes) return fail({ code: 'tooLarge' })
    const url = allowedDownloadUrl(file.url, entryId)
    if (url === undefined)
      return fail({
        code: 'unsupportedDownload',
        recoveryUrl: `${JIMAKU_DOWNLOAD_ORIGIN}/entry/${entryId}`
      })
    const downloaded = await downloadContent(deps.fetch, url, entryId, format, maxBytes, signal)
    if (!downloaded.ok) return downloaded
    return store(entryId, file, downloaded.value, format, signal)
  }

  async function prepareExtracted(
    entryId: number,
    file: JimakuFileRecord,
    memberName: string,
    bytes: Uint8Array,
    signal?: AbortSignal
  ): Promise<JimakuDownloadResult<JimakuPreparedSubtitle>> {
    const format = subtitleFormat(memberName)
    if (!isSubtitleFormat(format)) return fail({ code: 'invalidSubtitle' })
    if (signal?.aborted) return fail({ code: 'cancelled' })
    if (bytes.byteLength > limits.maxDownloadBytes) return fail({ code: 'tooLarge' })
    const valid = validateSubtitleBytes(bytes, format)
    if (!valid.ok) return valid
    return store(entryId, file, bytes, format, signal, memberName) as Promise<
      JimakuDownloadResult<JimakuPreparedSubtitle>
    >
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
    )
      return undefined
    const path = contentPath(provenance.contentVersion, format)
    try {
      const bytes = await fs.readFile(path)
      if (
        createHash('sha256').update(bytes).digest('hex') !== provenance.contentVersion ||
        !validateSubtitleBytes(bytes, format).ok
      )
        return undefined
      return { path, bytes, format }
    } catch {
      return undefined
    }
  }

  async function cleanup(protectedPaths: Iterable<string> = []): Promise<void> {
    await exclusive(async () => {
      const canonical = (path: string) =>
        process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path)
      const protectedSet = new Set([...protectedPaths].map(canonical))
      for (const prepared of active.values()) protectedSet.add(canonical(prepared.managedPath))
      const entries = await fs.readdir(deps.cacheRoot, { withFileTypes: true })
      const files = []
      for (const entry of entries) {
        if (
          !entry.isFile() ||
          (!CONTENT_NAME.test(entry.name) && !entry.name.startsWith(TEMP_PREFIX))
        )
          continue
        const path = join(deps.cacheRoot, entry.name)
        const stat = await fs.stat(path).catch(() => undefined)
        if (stat) files.push({ path, ...stat, temporary: entry.name.startsWith(TEMP_PREFIX) })
      }
      let total = files.filter((file) => !file.temporary).reduce((sum, file) => sum + file.size, 0)
      for (const file of files.sort((a, b) => a.mtimeMs - b.mtimeMs)) {
        if (protectedSet.has(canonical(file.path))) continue
        const maxAge = file.temporary ? limits.tempMaxAgeMs : limits.cacheMaxAgeMs
        if (
          Date.now() - file.mtimeMs <= maxAge &&
          (file.temporary || total <= limits.maxCacheBytes)
        )
          continue
        try {
          await fs.unlink(file.path)
          if (!file.temporary) total -= file.size
        } catch {
          // Cleanup is best effort; a locked file must not block other evictions.
        }
      }
    }).catch(() => {})
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
      return prepared ? fs.readFile(prepared.managedPath).catch(() => undefined) : undefined
    },
    releasePrepared: (handle) => {
      active.delete(handle)
    },
    cleanup
  }
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
