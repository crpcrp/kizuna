import { randomBytes } from 'node:crypto'
import { isRemoteUrl } from '../../../shared/mediaFileTypes'
import {
  type JimakuSubtitleProvenance,
  type StoredSubtitleSelection
} from '../../../shared/mediaHistory'
import {
  type JimakuArchiveMembersResult,
  type JimakuEntry,
  type JimakuFileCandidate,
  type JimakuFileFormat,
  type JimakuFileListResult,
  type JimakuPreparedSubtitleResult,
  type JimakuPrepareResult,
  type JimakuSearchCategory,
  type JimakuServiceError,
  type JimakuServiceResult,
  type JimakuSession,
  type JimakuSourcePage,
  type JimakuSubtitleExportRequest,
  type JimakuSubtitleExportResult,
  type JimakuTitleSearchRequest,
  type JimakuTitleSearchResult
} from '../../../shared/jimaku'
import {
  parseJimakuVideoIdentityFromPath,
  rankJimakuFiles,
  type JimakuVideoIdentity
} from '../../../shared/jimakuMatching'
import {
  JIMAKU_API_ORIGIN,
  JIMAKU_MAX_QUERY_LENGTH,
  type JimakuClient,
  type JimakuFileRecord
} from './client'
import type { JimakuArchiveInspection, JimakuArchiveService } from './archive'
import type { JimakuDownloadStore, JimakuPreparedSubtitle } from './downloadStore'
import {
  exportManagedJimakuSubtitle,
  type JimakuExportFs,
  type ShowJimakuSaveDialog
} from './export'
import type { JimakuSettingsService } from './settings'
import type { MediaHistoryService } from '../mediaHistory'

export const JIMAKU_SEARCH_CACHE_TTL_MS = 5 * 60 * 1000

type IdKind = 'session' | 'candidate' | 'package' | 'prepared'
type PendingOperation = { token: number; controller: AbortController }

interface CandidateRecord {
  entryId: number
  file: JimakuFileRecord
  format: JimakuFileFormat
}

interface CachedFiles {
  expiresAt: number
  files: JimakuFileRecord[]
}

interface CachedTitles {
  expiresAt: number
  result: JimakuTitleSearchResult
}

interface PackageRecord {
  archiveHandle: string
  entryId: number
  memberIds: Set<string>
}

interface PreparedRecord {
  prepared: JimakuPreparedSubtitle
  committed: boolean
}

interface SessionState {
  sender: unknown
  sessionId: string
  mediaPath: string
  mediaGeneration: number
  identity: JimakuVideoIdentity
  rememberedEntryId?: number
  configGeneration: number
  operationToken: number
  pending?: PendingOperation
  titleCache: Map<string, CachedTitles>
  fileCache: Map<number, CachedFiles>
  entries: Map<number, JimakuEntry>
  candidates: Map<string, CandidateRecord>
  packages: Map<string, PackageRecord>
  prepared: Map<string, PreparedRecord>
  protectedPaths: Set<string>
  valid: boolean
}

export interface CreateJimakuServiceDeps {
  client: Pick<JimakuClient, 'searchEntries' | 'getEntry' | 'listFiles'>
  settings: Pick<JimakuSettingsService, 'getConfigGeneration' | 'onConfigChange' | 'getFolderHint'>
  downloads: Pick<JimakuDownloadStore, 'prepareDirect' | 'releasePrepared'> &
    Partial<Pick<JimakuDownloadStore, 'cleanup' | 'readManagedSubtitle'>>
  archive: JimakuArchiveService
  mediaHistory?: Pick<MediaHistoryService, 'applyPreparedSubtitle'> &
    Partial<
      Pick<MediaHistoryService, 'getPlaybackHistory' | 'getProtectedJimakuPaths' | 'isCurrentMedia'>
    >
  subtitleExport?: {
    showSaveDialog: ShowJimakuSaveDialog
    fs?: JimakuExportFs
    platform?: NodeJS.Platform
  }
  openExternal: (url: string) => Promise<void>
  now?: () => number
  cacheTtlMs?: number
  makeId?: (kind: IdKind, counter: number) => string
}

export interface JimakuService {
  beginSession(
    sender: unknown,
    mediaPath: string,
    mediaGeneration: number
  ): JimakuServiceResult<JimakuSession>
  searchTitles(
    sender: unknown,
    sessionId: string,
    request: JimakuTitleSearchRequest
  ): Promise<JimakuServiceResult<JimakuTitleSearchResult>>
  listFiles(
    sender: unknown,
    sessionId: string,
    entryId: number,
    refresh?: boolean
  ): Promise<JimakuServiceResult<JimakuFileListResult>>
  prepareFile(
    sender: unknown,
    sessionId: string,
    candidateId: string
  ): Promise<JimakuServiceResult<JimakuPrepareResult>>
  prepareArchiveMember(
    sender: unknown,
    sessionId: string,
    packageId: string,
    memberId: string
  ): Promise<JimakuServiceResult<JimakuPreparedSubtitleResult>>
  cancelPending(sender: unknown, sessionId: string): JimakuServiceResult<void>
  endSession(sender: unknown, sessionId: string): JimakuServiceResult<void>
  openSourcePage(
    sender: unknown,
    sessionId: string,
    entryId: number
  ): Promise<JimakuServiceResult<void>>
  commitPreparedSubtitle(
    sender: unknown,
    sessionId: string,
    handle: string
  ): JimakuServiceResult<Extract<StoredSubtitleSelection, { mode: 'external' }>>
  exportActiveSubtitle(
    sender: unknown,
    request: JimakuSubtitleExportRequest
  ): Promise<JimakuSubtitleExportResult>
  disposeSender(sender: unknown): void
  dispose(): void
}

export function createJimakuService(deps: CreateJimakuServiceDeps): JimakuService {
  const now = deps.now ?? Date.now
  const cacheTtlMs = deps.cacheTtlMs ?? JIMAKU_SEARCH_CACHE_TTL_MS
  let idCounter = 0
  let disposed = false
  const sessions = new Map<string, SessionState>()
  const activeBySender = new Map<unknown, SessionState>()
  const lastGenerationBySender = new Map<unknown, number>()

  const makeId = (kind: IdKind): string => {
    idCounter += 1
    return (
      deps.makeId?.(kind, idCounter) ??
      `jimaku-${kind}-${idCounter}-${randomBytes(10).toString('hex')}`
    )
  }

  const currentConfigGeneration = (): number => deps.settings.getConfigGeneration()

  const sessionFor = (sender: unknown, sessionId: string): SessionState | undefined => {
    const session = sessions.get(sessionId)
    return session &&
      session.valid &&
      session.sender === sender &&
      activeBySender.get(sender) === session
      ? session
      : undefined
  }

  const abortPending = (session: SessionState): void => {
    session.operationToken += 1
    const pending = session.pending
    session.pending = undefined
    pending?.controller.abort()
  }

  const beginOperation = (session: SessionState): PendingOperation => {
    abortPending(session)
    const pending: PendingOperation = {
      token: ++session.operationToken,
      controller: new AbortController()
    }
    session.pending = pending
    return pending
  }

  const isCurrent = (session: SessionState, pending: PendingOperation): boolean =>
    !disposed &&
    session.valid &&
    activeBySender.get(session.sender) === session &&
    session.pending === pending &&
    session.configGeneration === currentConfigGeneration()

  const finishOperation = (session: SessionState, pending: PendingOperation): void => {
    if (session.pending === pending) session.pending = undefined
  }

  const releasePrepared = (session: SessionState, keepCommitted = true): void => {
    for (const [handle, record] of session.prepared) {
      if (keepCommitted && record.committed) continue
      deps.downloads.releasePrepared(record.prepared.handle)
      session.prepared.delete(handle)
    }
  }

  const releasePackages = (session: SessionState, keep?: string): void => {
    for (const [packageId, record] of session.packages) {
      if (packageId === keep) continue
      deps.archive.releasePackage(record.archiveHandle)
      session.packages.delete(packageId)
    }
  }

  const cleanupDownloads = (session?: SessionState): void => {
    const cleanup = deps.downloads.cleanup
    if (!cleanup) return
    const protectedPaths = new Set(session?.protectedPaths ?? [])
    try {
      for (const path of deps.mediaHistory?.getProtectedJimakuPaths?.() ?? []) {
        protectedPaths.add(path)
      }
    } catch {
      // Cleanup remains best effort when history is unavailable.
    }
    void cleanup(protectedPaths).catch(() => undefined)
  }

  const clearFileResults = (session: SessionState): void => {
    releasePackages(session)
    releasePrepared(session)
    session.candidates.clear()
    cleanupDownloads(session)
  }

  const clearSearchResults = (session: SessionState): void => {
    clearFileResults(session)
    session.entries.clear()
    session.fileCache.clear()
  }

  const releaseSession = (session: SessionState): void => {
    session.valid = false
    abortPending(session)
    releasePackages(session)
    releasePrepared(session, false)
    session.titleCache.clear()
    session.fileCache.clear()
    session.entries.clear()
    session.candidates.clear()
    session.prepared.clear()
    sessions.delete(session.sessionId)
    if (activeBySender.get(session.sender) === session) activeBySender.delete(session.sender)
    cleanupDownloads(session)
  }

  const handleConfigChange = (generation: number): void => {
    for (const session of sessions.values()) {
      abortPending(session)
      clearSearchResults(session)
      session.titleCache.clear()
      session.configGeneration = generation
    }
  }

  let removeConfigListener: (() => void) | undefined =
    deps.settings.onConfigChange(handleConfigChange)

  function beginSession(
    sender: unknown,
    path: string,
    mediaGeneration: number
  ): JimakuServiceResult<JimakuSession> {
    if (disposed) return failure('invalidSession')
    if (isRemoteUrl(path)) return failure('invalidRequest')

    const previousGeneration = lastGenerationBySender.get(sender)
    if (previousGeneration !== undefined && mediaGeneration < previousGeneration) {
      return failure('staleMedia')
    }

    const identity = identityForPath(path)
    if (!identity) return failure('invalidRequest')

    const previous = activeBySender.get(sender)
    if (previous) releaseSession(previous)

    const session: SessionState = {
      sender,
      sessionId: makeId('session'),
      mediaPath: path,
      mediaGeneration: mediaGeneration,
      identity,
      rememberedEntryId: rememberedEntryId(path, identity),
      configGeneration: currentConfigGeneration(),
      operationToken: 0,
      titleCache: new Map(),
      fileCache: new Map(),
      entries: new Map(),
      candidates: new Map(),
      packages: new Map(),
      prepared: new Map(),
      protectedPaths: new Set(),
      valid: true
    }
    sessions.set(session.sessionId, session)
    activeBySender.set(sender, session)
    lastGenerationBySender.set(sender, mediaGeneration)
    return success({ sessionId: session.sessionId, mediaGeneration: mediaGeneration })
  }

  async function searchTitles(
    sender: unknown,
    sessionId: string,
    request: JimakuTitleSearchRequest
  ): Promise<JimakuServiceResult<JimakuTitleSearchResult>> {
    const session = sessionFor(sender, sessionId)
    if (!session) return failure('invalidSession')
    session.rememberedEntryId = undefined

    const query = request.query.trim()
    const category = request.category ?? 'all'
    if (query === '' || [...query].length > JIMAKU_MAX_QUERY_LENGTH) {
      return failure('invalidRequest')
    }

    const cacheKey = `${category}\u0000${query}`
    const cached = session.titleCache.get(cacheKey)
    const refresh = request.refresh === true
    const pending = beginOperation(session)

    if (!refresh && cached && cached.expiresAt > now()) {
      clearSearchResults(session)
      session.entries = new Map(cached.result.entries.map((entry) => [entry.id, entry]))
      finishOperation(session, pending)
      return success(cached.result)
    }

    const result = await searchCategory(category, query, pending.controller.signal)
    if (!isCurrent(session, pending)) return failure('cancelled')
    finishOperation(session, pending)
    if (!result.ok) {
      clearSearchResults(session)
      return result
    }

    clearSearchResults(session)
    session.entries = new Map(result.value.entries.map((entry) => [entry.id, entry]))
    session.titleCache.set(cacheKey, {
      expiresAt: now() + cacheTtlMs,
      result: result.value
    })
    return success(result.value)
  }

  async function listFiles(
    sender: unknown,
    sessionId: string,
    entryId: number,
    refresh?: boolean
  ): Promise<JimakuServiceResult<JimakuFileListResult>> {
    const session = sessionFor(sender, sessionId)
    if (!session) return failure('invalidSession')
    let entry = session.entries.get(entryId)
    if (!entry && session.rememberedEntryId !== entryId) return failure('invalidEntry')

    const pending = beginOperation(session)
    if (!entry) {
      const resolved = await deps.client.getEntry(entryId, pending.controller.signal)
      if (!isCurrent(session, pending)) return failure('cancelled')
      if (!resolved.ok) {
        finishOperation(session, pending)
        clearFileResults(session)
        return { ok: false, error: resolved.error }
      }
      if (resolved.value.id !== entryId) {
        finishOperation(session, pending)
        clearFileResults(session)
        return failure('invalidResponse')
      }
      entry = resolved.value
      session.entries.set(entry.id, entry)
    }

    const cached = session.fileCache.get(entry.id)
    if (refresh !== true && cached && cached.expiresAt > now()) {
      clearFileResults(session)
      const value = materializeFiles(session, entry, cached.files)
      finishOperation(session, pending)
      return success(value)
    }

    const result = await deps.client.listFiles(entry.id, pending.controller.signal)
    if (!isCurrent(session, pending)) return failure('cancelled')
    finishOperation(session, pending)
    if (!result.ok) {
      clearFileResults(session)
      return { ok: false, error: result.error }
    }

    clearFileResults(session)
    const files = result.value.map((file) => ({ ...file }))
    session.fileCache.set(entry.id, { expiresAt: now() + cacheTtlMs, files })
    return success(materializeFiles(session, entry, files))
  }

  async function prepareFile(
    sender: unknown,
    sessionId: string,
    candidateId: string
  ): Promise<JimakuServiceResult<JimakuPrepareResult>> {
    const session = sessionFor(sender, sessionId)
    if (!session) return failure('invalidSession')
    const candidate = session.candidates.get(candidateId)
    if (!candidate) return failure('invalidCandidate')
    const entry = session.entries.get(candidate.entryId)
    if (!entry) return failure('invalidEntry')
    if (candidate.format === 'unsupported') return failure('invalidSubtitle')

    const pending = beginOperation(session)

    if (candidate.format === 'zip') {
      const inspected = await deps.archive.inspect(
        entry.id,
        candidate.file,
        session.identity,
        entry.flags.movie,
        pending.controller.signal
      )
      if (!isCurrent(session, pending)) {
        if (inspected.ok) deps.archive.releasePackage(inspected.value.packageHandle)
        return failure('cancelled')
      }
      finishOperation(session, pending)
      if (!inspected.ok) {
        releasePackages(session)
        releasePrepared(session)
        return { ok: false, error: inspected.error }
      }

      releasePackages(session)
      releasePrepared(session)
      const packageId = makeId('package')
      session.packages.set(packageId, {
        archiveHandle: inspected.value.packageHandle,
        entryId: entry.id,
        memberIds: new Set(inspected.value.members.map((member) => member.memberId))
      })
      return success(toArchiveMembersResult(packageId, entry.id, inspected.value))
    }

    const prepared = await deps.downloads.prepareDirect(
      entry.id,
      candidate.file,
      pending.controller.signal
    )
    if (!isCurrent(session, pending)) {
      if (prepared.ok) deps.downloads.releasePrepared(prepared.value.handle)
      return failure('cancelled')
    }
    finishOperation(session, pending)
    if (!prepared.ok) {
      releasePackages(session)
      releasePrepared(session)
      return { ok: false, error: prepared.error }
    }
    releasePackages(session)
    releasePrepared(session)
    return success(storePrepared(session, prepared.value))
  }

  async function prepareArchiveMember(
    sender: unknown,
    sessionId: string,
    packageId: string,
    memberId: string
  ): Promise<JimakuServiceResult<JimakuPreparedSubtitleResult>> {
    const session = sessionFor(sender, sessionId)
    if (!session) return failure('invalidSession')
    const packageRecord = session.packages.get(packageId)
    if (!packageRecord) return failure('invalidPackage')
    if (!packageRecord.memberIds.has(memberId)) return failure('invalidMember')

    const pending = beginOperation(session)
    const prepared = await deps.archive.prepareMember(
      packageRecord.archiveHandle,
      memberId,
      pending.controller.signal
    )
    if (!isCurrent(session, pending)) {
      if (prepared.ok) deps.downloads.releasePrepared(prepared.value.handle)
      return failure('cancelled')
    }
    finishOperation(session, pending)
    if (!prepared.ok) {
      releasePrepared(session)
      return { ok: false, error: prepared.error }
    }
    releasePackages(session, packageId)
    releasePrepared(session)
    const result = storePrepared(session, prepared.value)
    return success(result)
  }

  function cancelPending(sender: unknown, sessionId: string): JimakuServiceResult<void> {
    const session = sessionFor(sender, sessionId)
    if (!session) return failure('invalidSession')
    abortPending(session)
    return success(undefined)
  }

  function endSession(sender: unknown, sessionId: string): JimakuServiceResult<void> {
    const session = sessionFor(sender, sessionId)
    if (!session) return failure('invalidSession')
    releaseSession(session)
    return success(undefined)
  }

  async function openSourcePage(
    sender: unknown,
    sessionId: string,
    entryId: number
  ): Promise<JimakuServiceResult<void>> {
    const session = sessionFor(sender, sessionId)
    if (!session) return failure('invalidSession')
    const entry = session.entries.get(entryId)
    if (!entry) return failure('invalidEntry')
    const url = sourcePage(entry.id).url
    try {
      await deps.openExternal(url)
    } catch {
      return failure('openExternalFailed')
    }
    return success(undefined)
  }

  function commitPreparedSubtitle(
    sender: unknown,
    sessionId: string,
    handle: string
  ): JimakuServiceResult<Extract<StoredSubtitleSelection, { mode: 'external' }>> {
    const session = sessionFor(sender, sessionId)
    if (!session) return failure('invalidSession')
    const record = session.prepared.get(handle)
    if (!record) return failure('expired')
    if (!deps.mediaHistory) return failure('storage')
    try {
      const previous = deps.mediaHistory.getPlaybackHistory?.(session.mediaPath)
      if (
        previous?.subtitle?.mode === 'external' &&
        previous.subtitle.provenance?.provider === 'jimaku'
      ) {
        session.protectedPaths.add(previous.subtitle.path)
      }
      const selection = deps.mediaHistory.applyPreparedSubtitle(
        session.mediaPath,
        record.prepared,
        'auto'
      )
      if (!selection || selection.mode !== 'external') return failure('storage')
      record.committed = true
      cleanupDownloads(session)
      return success(selection)
    } catch {
      return failure('storage')
    }
  }

  async function exportActiveSubtitle(
    _sender: unknown,
    request: JimakuSubtitleExportRequest
  ): Promise<JimakuSubtitleExportResult> {
    const history = deps.mediaHistory
    const readManagedSubtitle = deps.downloads.readManagedSubtitle
    const exportOptions = deps.subtitleExport
    if (
      !history?.getPlaybackHistory ||
      !history.isCurrentMedia ||
      !readManagedSubtitle ||
      !exportOptions
    ) {
      return { status: 'error', code: 'notAvailable' }
    }
    const getPlaybackHistory = history.getPlaybackHistory
    const isCurrentMedia = history.isCurrentMedia
    if (!isCurrentMedia(request.mediaPath, request.mediaGeneration)) {
      return { status: 'error', code: 'staleMedia' }
    }

    const isActive = (): boolean => {
      try {
        const selection = getPlaybackHistory(request.mediaPath)?.subtitle
        return (
          selection?.mode === 'external' &&
          selection.provenance !== undefined &&
          sameProvenance(selection.provenance, request.provenance)
        )
      } catch {
        return false
      }
    }
    if (!isActive()) return { status: 'error', code: 'notAvailable' }

    return exportManagedJimakuSubtitle(request, {
      readSource: () => readManagedSubtitle(request.provenance),
      isCurrent: () => isCurrentMedia(request.mediaPath, request.mediaGeneration),
      isActive,
      showSaveDialog: exportOptions.showSaveDialog,
      fs: exportOptions.fs,
      platform: exportOptions.platform
    })
  }

  function disposeSender(sender: unknown): void {
    const session = activeBySender.get(sender)
    if (session) releaseSession(session)
    lastGenerationBySender.delete(sender)
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    removeConfigListener?.()
    removeConfigListener = undefined
    for (const session of [...sessions.values()]) releaseSession(session)
    sessions.clear()
    activeBySender.clear()
    lastGenerationBySender.clear()
  }

  return {
    beginSession,
    searchTitles,
    listFiles,
    prepareFile,
    prepareArchiveMember,
    cancelPending,
    endSession,
    openSourcePage,
    commitPreparedSubtitle,
    exportActiveSubtitle,
    disposeSender,
    dispose
  }

  async function searchCategory(
    category: JimakuSearchCategory,
    query: string,
    signal: AbortSignal
  ): Promise<JimakuServiceResult<JimakuTitleSearchResult>> {
    if (category !== 'all') {
      const result = await deps.client.searchEntries({ query, anime: category === 'anime' }, signal)
      return result.ok
        ? success({ entries: result.value, partial: false })
        : { ok: false, error: result.error }
    }

    const [anime, liveAction] = await Promise.all([
      deps.client.searchEntries({ query, anime: true }, signal),
      deps.client.searchEntries({ query, anime: false }, signal)
    ])
    const successes = [anime, liveAction].filter(
      (result): result is { ok: true; value: JimakuEntry[] } => result.ok
    )
    if (successes.length === 0) {
      if (!anime.ok) return { ok: false, error: anime.error }
      if (!liveAction.ok) return { ok: false, error: liveAction.error }
      return failure('network')
    }

    const entries = mergeEntries(successes.flatMap((result) => result.value))
    const failedCategories: Array<'anime' | 'liveAction'> = []
    if (!anime.ok) failedCategories.push('anime')
    if (!liveAction.ok) failedCategories.push('liveAction')
    return success({
      entries,
      partial: failedCategories.length > 0,
      ...(failedCategories.length === 0 ? {} : { failedCategories })
    })
  }

  function materializeFiles(
    session: SessionState,
    entry: JimakuEntry,
    files: readonly JimakuFileRecord[]
  ): JimakuFileListResult {
    const ranked = rankJimakuFiles(
      { flags: { movie: entry.flags.movie } },
      session.identity,
      files.map((file) => file.name),
      { showAllFiles: true }
    )
    const unused = files.map((file) => ({ file }))
    const candidates: JimakuFileCandidate[] = []
    for (const rankedFile of ranked) {
      const matchIndex = unused.findIndex(({ file }) => file.name === rankedFile.name)
      if (matchIndex < 0) continue
      const match = unused.splice(matchIndex, 1)[0]
      if (!match) continue
      const candidateId = makeId('candidate')
      session.candidates.set(candidateId, {
        entryId: entry.id,
        file: match.file,
        format: rankedFile.format
      })
      candidates.push({
        candidateId,
        entryId: entry.id,
        sourcePage: sourcePage(entry.id),
        name: rankedFile.name,
        size: match.file.size,
        lastModified: match.file.lastModified,
        format: rankedFile.format,
        status: rankedFile.status,
        reasons: [...rankedFile.reasons]
      })
    }
    return {
      entryId: entry.id,
      sourcePage: sourcePage(entry.id),
      files: candidates
    }
  }

  function rememberedEntryId(mediaPath: string, identity: JimakuVideoIdentity): number | undefined {
    try {
      return deps.settings.getFolderHint(mediaPath, identity.season)?.entryId
    } catch {
      return undefined
    }
  }

  function storePrepared(
    session: SessionState,
    prepared: JimakuPreparedSubtitle
  ): JimakuPreparedSubtitleResult {
    const handle = makeId('prepared')
    session.prepared.set(handle, { prepared, committed: false })
    return toPreparedResult(handle, prepared)
  }
}

function identityForPath(path: string): JimakuVideoIdentity | undefined {
  return parseJimakuVideoIdentityFromPath(path)
}

function sourcePage(entryId: number): JimakuSourcePage {
  return { entryId, url: `${JIMAKU_API_ORIGIN}/entry/${entryId}` }
}

function toArchiveMembersResult(
  packageId: string,
  entryId: number,
  inspection: JimakuArchiveInspection
): JimakuArchiveMembersResult {
  return {
    kind: 'archiveMembers',
    packageId,
    entryId,
    sourcePage: sourcePage(entryId),
    sourceFileName: inspection.sourceFileName,
    members: inspection.members.map((member) => ({ ...member, reasons: [...member.reasons] }))
  }
}

function toPreparedResult(
  handle: string,
  prepared: JimakuPreparedSubtitle
): JimakuPreparedSubtitleResult {
  const provenance: JimakuSubtitleProvenance = {
    provider: 'jimaku',
    entryId: prepared.provenance.entryId,
    fileName: prepared.originalName,
    contentVersion: prepared.contentVersion,
    ...(prepared.provenance.archiveMemberName === undefined
      ? {}
      : { archiveMemberName: prepared.provenance.archiveMemberName })
  }
  return {
    kind: 'preparedSubtitle',
    handle,
    contentVersion: prepared.contentVersion,
    originalName: prepared.originalName,
    format: prepared.format,
    provenance,
    selection: {
      mode: 'external',
      path: prepared.managedPath,
      encoding: 'auto',
      provenance
    }
  }
}

function mergeEntries(entries: readonly JimakuEntry[]): JimakuEntry[] {
  const unique = new Map<number, JimakuEntry>()
  for (const entry of entries) {
    if (!unique.has(entry.id)) unique.set(entry.id, entry)
  }
  return [...unique.values()]
}

function success<T>(value: T): JimakuServiceResult<T> {
  return { ok: true, value }
}

function failure<T>(code: JimakuServiceError['code']): JimakuServiceResult<T> {
  return { ok: false, error: { code } }
}

function sameProvenance(left: JimakuSubtitleProvenance, right: JimakuSubtitleProvenance): boolean {
  return (
    left.provider === right.provider &&
    left.entryId === right.entryId &&
    left.fileName === right.fileName &&
    left.contentVersion === right.contentVersion &&
    left.archiveMemberName === right.archiveMemberName
  )
}
