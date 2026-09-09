import { randomBytes } from 'node:crypto'
import { Unzip as FflateUnzip, UnzipInflate, UnzipPassThrough } from 'fflate'
import type {
  JimakuEpisodeRange,
  JimakuRankedFile,
  JimakuVideoIdentity
} from '../../../shared/jimakuMatching'
import { parseJimakuVideoIdentity, rankJimakuFiles } from '../../../shared/jimakuMatching'
import type { JimakuFileRecord } from './client'
import type {
  JimakuDownloadErrorCode,
  JimakuDownloadStore,
  JimakuPreparedPackage,
  JimakuPreparedSubtitle
} from './downloadStore'
import { JIMAKU_ARCHIVE_DOWNLOAD_MAX_BYTES } from './downloadStore'

export const JIMAKU_ARCHIVE_MAX_COMPRESSED_BYTES = JIMAKU_ARCHIVE_DOWNLOAD_MAX_BYTES
export const JIMAKU_ARCHIVE_MAX_EXPANDED_BYTES = 100 * 1024 * 1024
export const JIMAKU_ARCHIVE_MAX_MEMBER_BYTES = 10 * 1024 * 1024
export const JIMAKU_ARCHIVE_MAX_ENTRIES = 2_000
export const JIMAKU_ARCHIVE_FEED_CHUNK_BYTES = 64 * 1024

export type JimakuArchiveErrorCode =
  JimakuDownloadErrorCode | 'invalidArchive' | 'unsupportedArchive' | 'invalidMember'

export interface JimakuArchiveError {
  code: JimakuArchiveErrorCode
  recoveryUrl?: string
}

export type JimakuArchiveResult<T> =
  { ok: true; value: T } | { ok: false; error: JimakuArchiveError }

export interface JimakuArchiveMember {
  /** Opaque ID valid only while its package handle is retained. */
  memberId: string
  displayName: string
  format: 'srt' | 'ass' | 'ssa'
  /** Actual expanded size, not an untrusted ZIP header value. */
  size: number
  inferredEpisode?: number
  inferredEpisodeRange?: JimakuEpisodeRange
  status: JimakuRankedFile['status']
  reasons: string[]
}

export interface JimakuArchiveInspection {
  /** Opaque package ID used by prepareMember. */
  packageHandle: string
  entryId: number
  sourceFileName: string
  members: JimakuArchiveMember[]
}

export interface JimakuArchiveService {
  inspect(
    entryId: number,
    file: JimakuFileRecord,
    identity: JimakuVideoIdentity,
    movie: boolean,
    signal?: AbortSignal
  ): Promise<JimakuArchiveResult<JimakuArchiveInspection>>
  prepareMember(
    packageHandle: string,
    memberId: string,
    signal?: AbortSignal
  ): Promise<JimakuArchiveResult<JimakuPreparedSubtitle>>
  releasePackage(packageHandle: string): void
}

export interface CreateJimakuArchiveServiceDeps {
  downloads: Pick<
    JimakuDownloadStore,
    'preparePackage' | 'prepareExtracted' | 'readPrepared' | 'releasePrepared'
  >
  maxCompressedBytes?: number
  maxExpandedBytes?: number
  maxMemberBytes?: number
  maxEntries?: number
  feedChunkBytes?: number
  makePackageHandle?: () => string
  makeMemberId?: (packageHandle: string, entryIndex: number) => string
}

const ZIP_EOCD = 0x06054b50
const ZIP_CENTRAL_DIRECTORY = 0x02014b50
const ZIP_LOCAL_FILE = 0x04034b50
const ZIP64_SENTINEL = 0xffffffff
const ZIP_ENCRYPTED = 0x0001
const ZIP_UTF8 = 0x0800
const ZIP_SYMLINK = 0xa000
const ZIP_DIRECTORY = 0x4000
const ARCHIVE_TOO_LARGE = Symbol('jimaku-archive-too-large')
const ARCHIVE_CANCELLED = Symbol('jimaku-archive-cancelled')

interface ZipEntry {
  centralIndex: number
  name: string
  flags: number
  compression: number
  compressedSize: number
  declaredSize: number
  localOffset: number
  isDirectory: boolean
  format?: 'srt' | 'ass' | 'ssa'
  actualSize?: number
}

interface ActivePackage {
  prepared: JimakuPreparedPackage
  sourceFile: JimakuFileRecord
  bytes: Uint8Array
  localEntries: ZipEntry[]
  members: Map<string, { entry: ZipEntry; descriptor: JimakuArchiveMember }>
}

interface StreamedZipEntry {
  index: number
  name: string
  size: number
  bytes: Uint8Array
}

export function createJimakuArchiveService(
  deps: CreateJimakuArchiveServiceDeps
): JimakuArchiveService {
  const maxCompressedBytes = deps.maxCompressedBytes ?? JIMAKU_ARCHIVE_MAX_COMPRESSED_BYTES
  const maxExpandedBytes = deps.maxExpandedBytes ?? JIMAKU_ARCHIVE_MAX_EXPANDED_BYTES
  const maxMemberBytes = deps.maxMemberBytes ?? JIMAKU_ARCHIVE_MAX_MEMBER_BYTES
  const maxEntries = deps.maxEntries ?? JIMAKU_ARCHIVE_MAX_ENTRIES
  const feedChunkBytes = deps.feedChunkBytes ?? JIMAKU_ARCHIVE_FEED_CHUNK_BYTES
  const makePackageHandle = deps.makePackageHandle ?? defaultPackageHandle
  const makeMemberId = deps.makeMemberId ?? defaultMemberId
  const activePackages = new Map<string, ActivePackage>()

  async function inspect(
    entryId: number,
    file: JimakuFileRecord,
    identity: JimakuVideoIdentity,
    movie: boolean,
    signal?: AbortSignal
  ): Promise<JimakuArchiveResult<JimakuArchiveInspection>> {
    if (signal?.aborted) return failure('cancelled')

    const prepared = await deps.downloads.preparePackage(entryId, file, signal)
    if (!prepared.ok) return fromDownload(prepared)

    const bytes = await deps.downloads.readPrepared(prepared.value.handle)
    if (bytes === undefined) {
      deps.downloads.releasePrepared(prepared.value.handle)
      return failure('storage')
    }
    if (signal?.aborted) {
      deps.downloads.releasePrepared(prepared.value.handle)
      return failure('cancelled')
    }
    if (bytes.byteLength > maxCompressedBytes) {
      deps.downloads.releasePrepared(prepared.value.handle)
      return failure('tooLarge')
    }

    let parsed: ParsedArchive
    try {
      parsed = inspectZip(bytes, maxEntries, maxExpandedBytes)
      streamZipEntries(
        bytes,
        (entry) => {
          const target = parsed.localEntries[entry.index]
          if (target === undefined || target.name !== entry.name) throw new Error('entry mismatch')
          target.actualSize = entry.size
        },
        {
          maxEntryBytes: maxExpandedBytes,
          maxTotalBytes: maxExpandedBytes,
          feedChunkBytes,
          signal,
          captureEntry: () => false
        }
      )
      if (parsed.localEntries.some((entry) => entry.actualSize === undefined)) {
        throw new Error('missing archive entry')
      }
    } catch (error) {
      deps.downloads.releasePrepared(prepared.value.handle)
      return failure(mapArchiveError(error))
    }

    const packageHandle = makePackageHandle()
    const members = new Map<string, { entry: ZipEntry; descriptor: JimakuArchiveMember }>()
    for (const entryInfo of parsed.entries) {
      if (entryInfo.format === undefined || entryInfo.isDirectory) continue
      const memberId = makeMemberId(packageHandle, entryInfo.centralIndex)
      const memberIdentity = parseJimakuVideoIdentity(entryInfo.name)
      const ranked = rankJimakuFiles({ flags: { movie } }, identity, [entryInfo.name], {
        showAllFiles: true
      })[0]
      if (ranked === undefined) continue

      const reasons = [...ranked.reasons]
      if (entryInfo.declaredSize > maxMemberBytes) {
        reasons.push('Declared subtitle size exceeds limit')
      }
      if ((entryInfo.actualSize ?? 0) > maxMemberBytes) {
        reasons.push('Subtitle size exceeds limit')
      }

      const descriptor: JimakuArchiveMember = {
        memberId,
        displayName: entryInfo.name,
        format: entryInfo.format,
        size: entryInfo.actualSize ?? 0,
        ...(memberIdentity.episode === undefined
          ? {}
          : { inferredEpisode: memberIdentity.episode }),
        ...(memberIdentity.episodeRange === undefined
          ? {}
          : { inferredEpisodeRange: memberIdentity.episodeRange }),
        status: rankStatusWithSize(ranked.status, entryInfo, maxMemberBytes),
        reasons
      }
      members.set(memberId, { entry: entryInfo, descriptor })
    }

    if (members.size === 0) {
      deps.downloads.releasePrepared(prepared.value.handle)
      return failure('unsupportedArchive')
    }

    activePackages.set(packageHandle, {
      prepared: prepared.value,
      sourceFile: file,
      bytes: bytes.slice(),
      localEntries: parsed.localEntries,
      members
    })
    return success({
      packageHandle,
      entryId,
      sourceFileName: file.name,
      members: [...members.values()].map(({ descriptor }) => descriptor)
    })
  }

  async function prepareMember(
    packageHandle: string,
    memberId: string,
    signal?: AbortSignal
  ): Promise<JimakuArchiveResult<JimakuPreparedSubtitle>> {
    const active = activePackages.get(packageHandle)
    if (active === undefined) return failure('invalidMember')
    const member = active.members.get(memberId)
    if (member === undefined) return failure('invalidMember')
    if (signal?.aborted) return failure('cancelled')
    if (
      member.entry.declaredSize > maxMemberBytes ||
      (member.entry.actualSize ?? 0) > maxMemberBytes
    ) {
      return failure('tooLarge')
    }

    let selected: Uint8Array | undefined
    try {
      streamZipEntries(
        active.bytes,
        (entry) => {
          if (active.localEntries[entry.index] === member.entry) selected = entry.bytes
        },
        {
          maxEntryBytes: (index) =>
            active.localEntries[index] === member.entry ? maxMemberBytes : maxExpandedBytes,
          maxTotalBytes: maxExpandedBytes,
          feedChunkBytes,
          signal,
          captureEntry: (index) => active.localEntries[index] === member.entry
        }
      )
    } catch (error) {
      return failure(mapArchiveError(error))
    }

    if (selected === undefined) return failure('invalidArchive')
    if (selected.byteLength > maxMemberBytes) return failure('tooLarge')
    const prepared = await deps.downloads.prepareExtracted(
      active.prepared.provenance.entryId,
      active.sourceFile,
      member.entry.name,
      selected,
      signal
    )
    return prepared.ok ? success(prepared.value) : fromDownload(prepared)
  }

  function releasePackage(packageHandle: string): void {
    const active = activePackages.get(packageHandle)
    if (active === undefined) return
    activePackages.delete(packageHandle)
    deps.downloads.releasePrepared(active.prepared.handle)
  }

  return { inspect, prepareMember, releasePackage }
}

interface ParsedArchive {
  entries: ZipEntry[]
  localEntries: ZipEntry[]
}

function inspectZip(
  bytes: Uint8Array,
  maxEntries: number,
  maxExpandedBytes: number
): ParsedArchive {
  const eocd = findEndOfCentralDirectory(bytes)
  if (eocd === undefined) throw new Error('invalid archive')

  const disk = readU16(bytes, eocd + 4)
  const centralDisk = readU16(bytes, eocd + 6)
  const entriesOnDisk = readU16(bytes, eocd + 8)
  const totalEntries = readU16(bytes, eocd + 10)
  const centralSize = readU32(bytes, eocd + 12)
  const centralOffset = readU32(bytes, eocd + 16)
  const commentLength = readU16(bytes, eocd + 20)
  if (eocd + 22 + commentLength > bytes.length) throw new Error('invalid archive')
  if (disk !== 0 || centralDisk !== 0 || entriesOnDisk !== totalEntries) {
    throw new UnsupportedArchiveError()
  }
  if (totalEntries > maxEntries) throw ARCHIVE_TOO_LARGE
  if (centralOffset + centralSize > bytes.length) throw new Error('invalid archive')

  const entries: ZipEntry[] = []
  let offset = centralOffset
  let declaredTotal = 0
  for (let centralIndex = 0; centralIndex < totalEntries; centralIndex += 1) {
    if (
      offset + 46 > centralOffset + centralSize ||
      readU32(bytes, offset) !== ZIP_CENTRAL_DIRECTORY
    ) {
      throw new Error('invalid archive')
    }
    const madeBy = readU16(bytes, offset + 4)
    const flags = readU16(bytes, offset + 8)
    const compression = readU16(bytes, offset + 10)
    const compressedSize = readU32(bytes, offset + 20)
    const declaredSize = readU32(bytes, offset + 24)
    const nameLength = readU16(bytes, offset + 28)
    const extraLength = readU16(bytes, offset + 30)
    const commentLengthForEntry = readU16(bytes, offset + 32)
    const diskStart = readU16(bytes, offset + 34)
    const externalAttributes = readU32(bytes, offset + 38)
    const localOffset = readU32(bytes, offset + 42)
    if (
      compressedSize === ZIP64_SENTINEL ||
      declaredSize === ZIP64_SENTINEL ||
      localOffset === ZIP64_SENTINEL
    ) {
      throw new UnsupportedArchiveError()
    }

    const nameStart = offset + 46
    const recordEnd = nameStart + nameLength + extraLength + commentLengthForEntry
    if (recordEnd > centralOffset + centralSize || recordEnd > bytes.length) {
      throw new Error('invalid archive')
    }
    const nameBytes = bytes.subarray(nameStart, nameStart + nameLength)
    const name = decodeName(nameBytes, flags)
    if (!isSafeMemberName(name)) throw new UnsupportedArchiveError()
    if (flags & ZIP_ENCRYPTED) throw new UnsupportedArchiveError()
    if (compression !== 0 && compression !== 8) throw new UnsupportedArchiveError()
    if (diskStart !== 0) throw new UnsupportedArchiveError()

    const unixMode = (externalAttributes >>> 16) & 0xffff
    if (madeBy >>> 8 === 3 && (unixMode & 0xf000) === ZIP_SYMLINK) {
      throw new UnsupportedArchiveError()
    }
    const isDirectory =
      name.endsWith('/') ||
      (madeBy >>> 8 === 3 && (unixMode & 0xf000) === ZIP_DIRECTORY) ||
      (madeBy >>> 8 !== 3 && (externalAttributes & 0x10) !== 0)

    validateLocalRecord(
      bytes,
      localOffset,
      nameBytes,
      flags,
      compression,
      declaredSize,
      compressedSize
    )
    declaredTotal += declaredSize
    if (declaredTotal > maxExpandedBytes) throw ARCHIVE_TOO_LARGE

    const format = isDirectory ? undefined : directSubtitleFormat(name)
    entries.push({
      centralIndex,
      name,
      flags,
      compression,
      compressedSize,
      declaredSize,
      localOffset,
      isDirectory,
      ...(format === undefined ? {} : { format })
    })
    offset = recordEnd
  }
  if (offset !== centralOffset + centralSize) throw new Error('invalid archive')

  const localEntries = [...entries].sort((left, right) => left.localOffset - right.localOffset)
  return { entries, localEntries }
}

function streamZipEntries(
  bytes: Uint8Array,
  onEntry: (entry: StreamedZipEntry) => void,
  options: {
    maxEntryBytes: number | ((index: number) => number)
    maxTotalBytes: number
    feedChunkBytes: number
    captureEntry?: (index: number, name: string) => boolean
    signal?: AbortSignal
  }
): void {
  if (options.signal?.aborted) throw ARCHIVE_CANCELLED
  let total = 0
  let streamIndex = 0
  let failure: unknown
  const unzip = new FflateUnzip((file) => {
    const index = streamIndex++
    const chunks: Uint8Array[] = []
    const capture = options.captureEntry?.(index, file.name) ?? true
    let entrySize = 0
    let completed = false
    file.ondata = (error, chunk, final) => {
      if (failure !== undefined) return
      if (options.signal?.aborted) {
        failure = ARCHIVE_CANCELLED
        return
      }
      if (error) {
        failure = error
        return
      }
      entrySize += chunk.byteLength
      total += chunk.byteLength
      const maxEntryBytes =
        typeof options.maxEntryBytes === 'function'
          ? options.maxEntryBytes(index)
          : options.maxEntryBytes
      if (
        !Number.isSafeInteger(maxEntryBytes) ||
        maxEntryBytes < 0 ||
        entrySize > maxEntryBytes ||
        total > options.maxTotalBytes
      ) {
        failure = ARCHIVE_TOO_LARGE
        return
      }
      if (capture) chunks.push(chunk)
      if (final) {
        completed = true
        try {
          onEntry({
            index,
            name: file.name,
            size: entrySize,
            bytes: capture ? concatChunks(chunks, entrySize) : new Uint8Array()
          })
        } catch (error) {
          failure = error
        }
      }
    }
    try {
      file.start()
    } catch (error) {
      failure = error
    }
    if (!completed && failure !== undefined) file.terminate()
  })
  unzip.register(UnzipInflate)
  unzip.register(UnzipPassThrough)

  if (!Number.isSafeInteger(options.feedChunkBytes) || options.feedChunkBytes <= 0) {
    throw new Error('invalid feed chunk size')
  }
  for (
    let offset = 0;
    offset < bytes.length && failure === undefined;
    offset += options.feedChunkBytes
  ) {
    if (options.signal?.aborted) {
      failure = ARCHIVE_CANCELLED
      break
    }
    const end = Math.min(offset + options.feedChunkBytes, bytes.length)
    try {
      unzip.push(bytes.subarray(offset, end), end === bytes.length)
    } catch (error) {
      failure = error
    }
  }
  if (failure !== undefined) throw failure
}

function validateLocalRecord(
  bytes: Uint8Array,
  localOffset: number,
  centralName: Uint8Array,
  centralFlags: number,
  centralCompression: number,
  declaredSize: number,
  compressedSize: number
): void {
  if (localOffset + 30 > bytes.length || readU32(bytes, localOffset) !== ZIP_LOCAL_FILE) {
    throw new Error('invalid archive')
  }
  const localFlags = readU16(bytes, localOffset + 6)
  const localCompression = readU16(bytes, localOffset + 8)
  const localCompressedSize = readU32(bytes, localOffset + 18)
  const localDeclaredSize = readU32(bytes, localOffset + 22)
  if (
    localFlags !== centralFlags ||
    localCompression !== centralCompression ||
    ((localFlags & 0x0008) === 0 &&
      (localCompressedSize !== compressedSize || localDeclaredSize !== declaredSize))
  ) {
    throw new Error('invalid archive')
  }
  const nameLength = readU16(bytes, localOffset + 26)
  const extraLength = readU16(bytes, localOffset + 28)
  const dataStart = localOffset + 30 + nameLength + extraLength
  if (dataStart + compressedSize > bytes.length) throw new Error('invalid archive')
  const localName = bytes.subarray(localOffset + 30, dataStart - extraLength)
  if (!sameBytes(localName, centralName)) throw new Error('invalid archive')
}

function findEndOfCentralDirectory(bytes: Uint8Array): number | undefined {
  const first = Math.max(0, bytes.length - 22 - 65_535)
  for (let offset = bytes.length - 22; offset >= first; offset -= 1) {
    if (offset >= 0 && offset + 22 <= bytes.length && readU32(bytes, offset) === ZIP_EOCD) {
      return offset
    }
  }
  return undefined
}

function decodeName(bytes: Uint8Array, flags: number): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    if ((flags & ZIP_UTF8) !== 0) throw new UnsupportedArchiveError()
    throw new UnsupportedArchiveError()
  }
}

function isSafeMemberName(name: string): boolean {
  if (name.includes('\0')) return false
  const normalized = name.replaceAll('\\', '/')
  if (normalized.startsWith('/') || normalized.startsWith('//') || /^[A-Za-z]:/u.test(normalized)) {
    return false
  }
  return !normalized.split('/').some((part) => part === '..')
}

function directSubtitleFormat(name: string): 'srt' | 'ass' | 'ssa' | undefined {
  const base = name.split(/[\\/]/u).at(-1) ?? name
  const extension = base.slice(base.lastIndexOf('.') + 1).toLowerCase()
  return extension === 'srt' || extension === 'ass' || extension === 'ssa' ? extension : undefined
}

function rankStatusWithSize(
  status: JimakuRankedFile['status'],
  entry: ZipEntry,
  maxMemberBytes: number
): JimakuRankedFile['status'] {
  if (entry.declaredSize > maxMemberBytes || (entry.actualSize ?? 0) > maxMemberBytes) {
    return status === 'excluded' ? status : 'browseOnly'
  }
  return status
}

function mapArchiveError(error: unknown): JimakuArchiveErrorCode {
  if (error === ARCHIVE_CANCELLED) return 'cancelled'
  if (error === ARCHIVE_TOO_LARGE) return 'tooLarge'
  if (error instanceof UnsupportedArchiveError) return 'unsupportedArchive'
  return 'invalidArchive'
}

function fromDownload<T>(
  result:
    | { ok: true; value: T }
    | { ok: false; error: { code: JimakuDownloadErrorCode; recoveryUrl?: string } }
): JimakuArchiveResult<T> {
  return result.ok ? success(result.value) : failure(result.error.code, result.error.recoveryUrl)
}

function concatChunks(chunks: readonly Uint8Array[], total: number): Uint8Array {
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return bytes
}

function sameBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false
  }
  return true
}

function readU16(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 2 > bytes.length) throw new Error('invalid archive')
  return bytes[offset] | (bytes[offset + 1] << 8)
}

function readU32(bytes: Uint8Array, offset: number): number {
  if (offset < 0 || offset + 4 > bytes.length) throw new Error('invalid archive')
  return (
    (bytes[offset] |
      (bytes[offset + 1] << 8) |
      (bytes[offset + 2] << 16) |
      (bytes[offset + 3] << 24)) >>>
    0
  )
}

function defaultPackageHandle(): string {
  return `jimaku-package-${randomBytes(12).toString('hex')}`
}

function defaultMemberId(packageHandle: string, entryIndex: number): string {
  return `${packageHandle}-member-${entryIndex}`
}

function success<T>(value: T): JimakuArchiveResult<T> {
  return { ok: true, value }
}

function failure<T>(code: JimakuArchiveErrorCode, recoveryUrl?: string): JimakuArchiveResult<T> {
  return {
    ok: false,
    error: recoveryUrl === undefined ? { code } : { code, recoveryUrl }
  }
}

class UnsupportedArchiveError extends Error {
  constructor() {
    super('unsupported archive')
  }
}
