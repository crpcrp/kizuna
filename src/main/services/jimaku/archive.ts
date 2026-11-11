import { randomBytes } from 'node:crypto'
import { unzipSync } from 'fflate'
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
import { fail, ok } from './result'

export const JIMAKU_ARCHIVE_MAX_COMPRESSED_BYTES = JIMAKU_ARCHIVE_DOWNLOAD_MAX_BYTES
export const JIMAKU_ARCHIVE_MAX_EXPANDED_BYTES = 100 * 1024 * 1024
export const JIMAKU_ARCHIVE_MAX_MEMBER_BYTES = 10 * 1024 * 1024

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
  makePackageHandle?: () => string
  makeMemberId?: (packageHandle: string, entryIndex: number) => string
}

const ARCHIVE_TOO_LARGE = Symbol('jimaku-archive-too-large')

interface ActiveMember {
  name: string
  bytes: Uint8Array
  descriptor: JimakuArchiveMember
}

interface ActivePackage {
  prepared: JimakuPreparedPackage
  sourceFile: JimakuFileRecord
  members: Map<string, ActiveMember>
}

export function createJimakuArchiveService(
  deps: CreateJimakuArchiveServiceDeps
): JimakuArchiveService {
  const maxCompressedBytes = deps.maxCompressedBytes ?? JIMAKU_ARCHIVE_MAX_COMPRESSED_BYTES
  const maxExpandedBytes = deps.maxExpandedBytes ?? JIMAKU_ARCHIVE_MAX_EXPANDED_BYTES
  const maxMemberBytes = deps.maxMemberBytes ?? JIMAKU_ARCHIVE_MAX_MEMBER_BYTES
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
    if (signal?.aborted) return fail({ code: 'cancelled' })

    const prepared = await deps.downloads.preparePackage(entryId, file, signal)
    if (!prepared.ok) return fromDownload(prepared)

    const bytes = await deps.downloads.readPrepared(prepared.value.handle)
    if (bytes === undefined) {
      deps.downloads.releasePrepared(prepared.value.handle)
      return fail({ code: 'storage' })
    }
    if (signal?.aborted) {
      deps.downloads.releasePrepared(prepared.value.handle)
      return fail({ code: 'cancelled' })
    }
    if (bytes.byteLength > maxCompressedBytes) {
      deps.downloads.releasePrepared(prepared.value.handle)
      return fail({ code: 'tooLarge' })
    }

    let extracted: Array<{ name: string; bytes: Uint8Array }>
    try {
      extracted = extractSubtitles(bytes, maxMemberBytes, maxExpandedBytes)
    } catch (error) {
      deps.downloads.releasePrepared(prepared.value.handle)
      return fail({ code: mapArchiveError(error) })
    }

    const packageHandle = makePackageHandle()
    const members = new Map<string, ActiveMember>()
    for (const [index, { name, bytes: memberBytes }] of extracted.entries()) {
      const format = directSubtitleFormat(name)
      if (format === undefined) continue
      const ranked = rankJimakuFiles({ flags: { movie } }, identity, [name], {
        showAllFiles: true
      })[0]
      if (ranked === undefined) continue
      const memberId = makeMemberId(packageHandle, index)
      const memberIdentity = parseJimakuVideoIdentity(name)
      const descriptor: JimakuArchiveMember = {
        memberId,
        displayName: name,
        format,
        size: memberBytes.byteLength,
        ...(memberIdentity.episode === undefined
          ? {}
          : { inferredEpisode: memberIdentity.episode }),
        ...(memberIdentity.episodeRange === undefined
          ? {}
          : { inferredEpisodeRange: memberIdentity.episodeRange }),
        status: ranked.status,
        reasons: [...ranked.reasons]
      }
      members.set(memberId, { name, bytes: memberBytes, descriptor })
    }

    if (members.size === 0) {
      deps.downloads.releasePrepared(prepared.value.handle)
      return fail({ code: 'unsupportedArchive' })
    }

    activePackages.set(packageHandle, {
      prepared: prepared.value,
      sourceFile: file,
      members
    })
    return ok({
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
    if (active === undefined) return fail({ code: 'invalidMember' })
    const member = active.members.get(memberId)
    if (member === undefined) return fail({ code: 'invalidMember' })
    if (signal?.aborted) return fail({ code: 'cancelled' })
    const prepared = await deps.downloads.prepareExtracted(
      active.prepared.provenance.entryId,
      active.sourceFile,
      member.name,
      member.bytes,
      signal
    )
    return prepared.ok ? ok(prepared.value) : fromDownload(prepared)
  }

  function releasePackage(packageHandle: string): void {
    const active = activePackages.get(packageHandle)
    if (active === undefined) return
    activePackages.delete(packageHandle)
    deps.downloads.releasePrepared(active.prepared.handle)
  }

  return { inspect, prepareMember, releasePackage }
}

/**
 * Decompresses only safe subtitle members. fflate bounds inflated output by the
 * declared size; stored members are sliced by compressed size, hence the recheck.
 */
function extractSubtitles(
  bytes: Uint8Array,
  maxMemberBytes: number,
  maxExpandedBytes: number
): Array<{ name: string; bytes: Uint8Array }> {
  let declaredTotal = 0
  const files = unzipSync(bytes, {
    filter: (file) => {
      if (directSubtitleFormat(file.name) === undefined || !isSafeMemberName(file.name)) {
        return false
      }
      if (file.compression !== 0 && file.compression !== 8) throw new UnsupportedArchiveError()
      declaredTotal += file.originalSize
      if (file.originalSize > maxMemberBytes || declaredTotal > maxExpandedBytes) {
        throw ARCHIVE_TOO_LARGE
      }
      return true
    }
  })
  const extracted = Object.entries(files).map(([name, data]) => ({ name, bytes: data }))
  if (extracted.some((file) => file.bytes.byteLength > maxMemberBytes)) throw ARCHIVE_TOO_LARGE
  return extracted
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

function mapArchiveError(error: unknown): JimakuArchiveErrorCode {
  if (error === ARCHIVE_TOO_LARGE) return 'tooLarge'
  if (error instanceof UnsupportedArchiveError) return 'unsupportedArchive'
  return 'invalidArchive'
}

function fromDownload<T>(
  result:
    | { ok: true; value: T }
    | { ok: false; error: { code: JimakuDownloadErrorCode; recoveryUrl?: string } }
): JimakuArchiveResult<T> {
  return result.ok ? ok(result.value) : fail({ ...result.error })
}

function defaultPackageHandle(): string {
  return `jimaku-package-${randomBytes(12).toString('hex')}`
}

function defaultMemberId(packageHandle: string, entryIndex: number): string {
  return `${packageHandle}-member-${entryIndex}`
}

class UnsupportedArchiveError extends Error {
  constructor() {
    super('unsupported archive')
  }
}
