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
import type { JimakuArchiveError, JimakuArchiveInspection, JimakuArchiveService } from './archive'
import type {
  JimakuDownloadError,
  JimakuDownloadStore,
  JimakuPreparedSubtitle
} from './downloadStore'
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
  client: Pick<JimakuClient, 'searchEntries' | 'listFiles'>
  settings: Pick<JimakuSettingsService, 'getConfigGeneration' | 'onConfigChange'>
  downloads: Pick<JimakuDownloadStore, 'prepareDirect' | 'releasePrepared'> &
    Partial<Pick<JimakuDownloadStore, 'cleanup'>>
  archive: JimakuArchiveService
  mediaHistory?: Pick<MediaHistoryService, 'applyPreparedSubtitle'> &
    Partial<Pick<MediaHistoryService, 'getPlaybackHistory' | 'getProtectedJimakuPaths'>>
  openExternal: (url: string) => Promise<void>
  now?: () => number
  cacheTtlMs?: number
  makeId?: (kind: IdKind, counter: number) => string
}

export interface JimakuService {
  beginSession(
    sender: unknown,
    mediaPath: unknown,
    mediaGeneration: unknown
  ): JimakuServiceResult<JimakuSession>
  searchTitles(
    sender: unknown,
    sessionId: unknown,
    request: unknown
  ): Promise<JimakuServiceResult<JimakuTitleSearchResult>>
  listFiles(
    sender: unknown,
    sessionId: unknown,
    entryId: unknown,
    refresh?: unknown
  ): Promise<JimakuServiceResult<JimakuFileListResult>>
  prepareFile(
    sender: unknown,
    sessionId: unknown,
    candidateId: unknown
  ): Promise<JimakuServiceResult<JimakuPrepareResult>>
  prepareArchiveMember(
    sender: unknown,
    sessionId: unknown,
    packageId: unknown,
    memberId: unknown
  ): Promise<JimakuServiceResult<JimakuPreparedSubtitleResult>>
  cancelPending(sender: unknown, sessionId: unknown): JimakuServiceResult<void>
  endSession(sender: unknown, sessionId: unknown): JimakuServiceResult<void>
  openSourcePage(
    sender: unknown,
    sessionId: unknown,
    entryId: unknown
  ): Promise<JimakuServiceResult<void>>
  commitPreparedSubtitle(
    sender: unknown,
    sessionId: unknown,
    handle: unknown
  ): JimakuServiceResult<Extract<StoredSubtitleSelection, { mode: 'external' }>>
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

  const currentConfigGeneration = (): number => {
    try {
      return deps.settings.getConfigGeneration()
    } catch {
      return 0
    }
  }

  const safeNow = (): number => {
    const value = now()
    return Number.isFinite(value) ? value : Date.now()
  }

  const sessionFor = (sender: unknown, sessionId: unknown): SessionState | undefined => {
    if (typeof sessionId !== 'string' || sessionId === '') return undefined
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

  let removeConfigListener: (() => void) | undefined
  try {
    removeConfigListener = deps.settings.onConfigChange(handleConfigChange)
  } catch {
    removeConfigListener = undefined
  }

  function beginSession(
    sender: unknown,
    mediaPathValue: unknown,
    mediaGenerationValue: unknown
  ): JimakuServiceResult<JimakuSession> {
    if (disposed) return failure('invalidSession')
    const path = normalizeMediaPathValue(mediaPathValue)
    if (!path || !isNonNegativeSafeInteger(mediaGenerationValue)) {
      return failure('invalidRequest')
    }

    const previousGeneration = lastGenerationBySender.get(sender)
    if (previousGeneration !== undefined && mediaGenerationValue <= previousGeneration) {
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
      mediaGeneration: mediaGenerationValue,
      identity,
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
    lastGenerationBySender.set(sender, mediaGenerationValue)
    return success({ sessionId: session.sessionId, mediaGeneration: mediaGenerationValue })
  }

  async function searchTitles(
    sender: unknown,
    sessionId: unknown,
    requestValue: unknown
  ): Promise<JimakuServiceResult<JimakuTitleSearchResult>> {
    const session = sessionFor(sender, sessionId)
    if (!session) return failure('invalidSession')
    const request = parseTitleRequest(requestValue)
    if (!request) return failure('invalidRequest')

    const query = request.query.trim()
    const category = request.category ?? 'all'
    if (query === '' || [...query].length > JIMAKU_MAX_QUERY_LENGTH) {
      return failure('invalidRequest')
    }

    const cacheKey = `${category}\u0000${query}`
    const cached = session.titleCache.get(cacheKey)
    const refresh = request.refresh === true
    const pending = beginOperation(session)

    if (!refresh && cached && cached.expiresAt > safeNow()) {
      clearSearchResults(session)
      session.entries = new Map(cached.result.entries.map((entry) => [entry.id, entry]))
      finishOperation(session, pending)
      return success(copyTitleResult(cached.result))
    }

    let result: JimakuServiceResult<JimakuTitleSearchResult>
    try {
      result = await searchCategory(category, query, pending.controller.signal)
    } catch {
      result = failure('network')
    }
    if (!isCurrent(session, pending)) return failure('cancelled')
    finishOperation(session, pending)
    if (!result.ok) {
      clearSearchResults(session)
      return result
    }

    clearSearchResults(session)
    session.entries = new Map(result.value.entries.map((entry) => [entry.id, entry]))
    session.titleCache.set(cacheKey, {
      expiresAt: safeNow() + cacheTtlMs,
      result: copyTitleResult(result.value)
    })
    return success(copyTitleResult(result.value))
  }

  async function listFiles(
    sender: unknown,
    sessionId: unknown,
    entryIdValue: unknown,
    refreshValue?: unknown
  ): Promise<JimakuServiceResult<JimakuFileListResult>> {
    const session = sessionFor(sender, sessionId)
    if (!session) return failure('invalidSession')
    if (!isPositiveSafeInteger(entryIdValue)) return failure('invalidRequest')
    if (refreshValue !== undefined && !isRefreshValue(refreshValue)) {
      return failure('invalidRequest')
    }
    const entry = session.entries.get(entryIdValue)
    if (!entry) return failure('invalidEntry')

    const pending = beginOperation(session)
    const cached = session.fileCache.get(entry.id)
    const refresh = refreshValue === true || isRefreshRequest(refreshValue)
    if (!refresh && cached && cached.expiresAt > safeNow()) {
      clearFileResults(session)
      const value = materializeFiles(session, entry, cached.files)
      finishOperation(session, pending)
      return success(value)
    }

    let result: Awaited<ReturnType<JimakuClient['listFiles']>>
    try {
      result = await deps.client.listFiles(entry.id, pending.controller.signal)
    } catch {
      result = failure('network') as Awaited<ReturnType<JimakuClient['listFiles']>>
    }
    if (!isCurrent(session, pending)) return failure('cancelled')
    finishOperation(session, pending)
    if (!result.ok) {
      clearFileResults(session)
      return mapError(result.error)
    }

    clearFileResults(session)
    const files = result.value.map((file) => ({ ...file }))
    session.fileCache.set(entry.id, { expiresAt: safeNow() + cacheTtlMs, files })
    return success(materializeFiles(session, entry, files))
  }

  async function prepareFile(
    sender: unknown,
    sessionId: unknown,
    candidateId: unknown
  ): Promise<JimakuServiceResult<JimakuPrepareResult>> {
    const session = sessionFor(sender, sessionId)
    if (!session) return failure('invalidSession')
    if (typeof candidateId !== 'string' || candidateId === '') return failure('invalidRequest')
    const candidate = session.candidates.get(candidateId)
    if (!candidate) return failure('invalidCandidate')
    const entry = session.entries.get(candidate.entryId)
    if (!entry) return failure('invalidEntry')
    if (candidate.format === 'unsupported') return failure('invalidSubtitle')

    const pending = beginOperation(session)

    if (candidate.format === 'zip') {
      let inspected: Awaited<ReturnType<JimakuArchiveService['inspect']>>
      try {
        inspected = await deps.archive.inspect(
          entry.id,
          candidate.file,
          session.identity,
          entry.flags.movie,
          pending.controller.signal
        )
      } catch {
        inspected = failure('storage') as Awaited<ReturnType<JimakuArchiveService['inspect']>>
      }
      if (!isCurrent(session, pending)) {
        if (inspected.ok) deps.archive.releasePackage(inspected.value.packageHandle)
        return failure('cancelled')
      }
      finishOperation(session, pending)
      if (!inspected.ok) {
        releasePackages(session)
        releasePrepared(session)
        return mapError(inspected.error)
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

    let prepared: Awaited<ReturnType<JimakuDownloadStore['prepareDirect']>>
    try {
      prepared = await deps.downloads.prepareDirect(
        entry.id,
        candidate.file,
        pending.controller.signal
      )
    } catch {
      prepared = failure('storage') as Awaited<ReturnType<JimakuDownloadStore['prepareDirect']>>
    }
    if (!isCurrent(session, pending)) {
      if (prepared.ok) deps.downloads.releasePrepared(prepared.value.handle)
      return failure('cancelled')
    }
    finishOperation(session, pending)
    if (!prepared.ok) {
      releasePackages(session)
      releasePrepared(session)
      return mapError(prepared.error)
    }
    releasePackages(session)
    releasePrepared(session)
    return success(storePrepared(session, prepared.value))
  }

  async function prepareArchiveMember(
    sender: unknown,
    sessionId: unknown,
    packageId: unknown,
    memberId: unknown
  ): Promise<JimakuServiceResult<JimakuPreparedSubtitleResult>> {
    const session = sessionFor(sender, sessionId)
    if (!session) return failure('invalidSession')
    if (typeof packageId !== 'string' || packageId === '') return failure('invalidRequest')
    if (typeof memberId !== 'string' || memberId === '') return failure('invalidRequest')
    const packageRecord = session.packages.get(packageId)
    if (!packageRecord) return failure('invalidPackage')
    if (!packageRecord.memberIds.has(memberId)) return failure('invalidMember')

    const pending = beginOperation(session)
    let prepared: Awaited<ReturnType<JimakuArchiveService['prepareMember']>>
    try {
      prepared = await deps.archive.prepareMember(
        packageRecord.archiveHandle,
        memberId,
        pending.controller.signal
      )
    } catch {
      prepared = failure('storage') as Awaited<ReturnType<JimakuArchiveService['prepareMember']>>
    }
    if (!isCurrent(session, pending)) {
      if (prepared.ok) deps.downloads.releasePrepared(prepared.value.handle)
      return failure('cancelled')
    }
    finishOperation(session, pending)
    if (!prepared.ok) {
      releasePrepared(session)
      return mapError(prepared.error)
    }
    releasePackages(session, packageId)
    releasePrepared(session)
    const result = storePrepared(session, prepared.value)
    return success(result)
  }

  function cancelPending(sender: unknown, sessionId: unknown): JimakuServiceResult<void> {
    const session = sessionFor(sender, sessionId)
    if (!session) return failure('invalidSession')
    abortPending(session)
    return success(undefined)
  }

  function endSession(sender: unknown, sessionId: unknown): JimakuServiceResult<void> {
    const session = sessionFor(sender, sessionId)
    if (!session) return failure('invalidSession')
    releaseSession(session)
    return success(undefined)
  }

  async function openSourcePage(
    sender: unknown,
    sessionId: unknown,
    entryIdValue: unknown
  ): Promise<JimakuServiceResult<void>> {
    const session = sessionFor(sender, sessionId)
    if (!session) return failure('invalidSession')
    if (!isPositiveSafeInteger(entryIdValue)) return failure('invalidRequest')
    const entry = session.entries.get(entryIdValue)
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
    sessionId: unknown,
    handle: unknown
  ): JimakuServiceResult<Extract<StoredSubtitleSelection, { mode: 'external' }>> {
    const session = sessionFor(sender, sessionId)
    if (!session) return failure('invalidSession')
    if (typeof handle !== 'string' || handle === '') return failure('invalidRequest')
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

  function disposeSender(sender: unknown): void {
    const session = activeBySender.get(sender)
    if (session) releaseSession(session)
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    removeConfigListener?.()
    removeConfigListener = undefined
    for (const session of [...sessions.values()]) releaseSession(session)
    sessions.clear()
    activeBySender.clear()
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
      return result.ok ? success({ entries: result.value, partial: false }) : mapError(result.error)
    }

    const [anime, liveAction] = await Promise.all([
      deps.client.searchEntries({ query, anime: true }, signal),
      deps.client.searchEntries({ query, anime: false }, signal)
    ])
    const successes = [anime, liveAction].filter(
      (result): result is { ok: true; value: JimakuEntry[] } => result.ok
    )
    if (successes.length === 0) {
      if (!anime.ok) return mapError(anime.error)
      if (!liveAction.ok) return mapError(liveAction.error)
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

  function storePrepared(
    session: SessionState,
    prepared: JimakuPreparedSubtitle
  ): JimakuPreparedSubtitleResult {
    const handle = makeId('prepared')
    session.prepared.set(handle, { prepared, committed: false })
    return toPreparedResult(handle, prepared)
  }
}

function normalizeMediaPathValue(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const path = value.trim()
  if (path === '' || isRemoteUrl(path)) return undefined
  return path
}

function identityForPath(path: string): JimakuVideoIdentity | undefined {
  return parseJimakuVideoIdentityFromPath(path)
}

function parseTitleRequest(value: unknown): JimakuTitleSearchRequest | undefined {
  if (!isRecord(value)) return undefined
  if (typeof value.query !== 'string') return undefined
  if (
    value.category !== undefined &&
    value.category !== 'anime' &&
    value.category !== 'liveAction' &&
    value.category !== 'all'
  ) {
    return undefined
  }
  if (value.refresh !== undefined && typeof value.refresh !== 'boolean') return undefined
  return {
    query: value.query,
    ...(value.category === undefined ? {} : { category: value.category }),
    ...(value.refresh === undefined ? {} : { refresh: value.refresh })
  }
}

function isRefreshValue(value: unknown): boolean {
  return typeof value === 'boolean' || isRefreshRequest(value)
}

function isRefreshRequest(value: unknown): value is { refresh?: boolean } {
  return isRecord(value) && (value.refresh === undefined || typeof value.refresh === 'boolean')
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

function copyTitleResult(result: JimakuTitleSearchResult): JimakuTitleSearchResult {
  return {
    entries: result.entries.map((entry) => ({
      ...entry,
      flags: { ...entry.flags }
    })),
    partial: result.partial,
    ...(result.failedCategories === undefined
      ? {}
      : { failedCategories: [...result.failedCategories] })
  }
}

function mapError(
  error: JimakuDownloadError | JimakuArchiveError | { code: string }
): JimakuServiceResult<never> {
  const value = error as { code?: unknown; retryAt?: unknown; recoveryUrl?: unknown }
  const mapped: JimakuServiceError = {
    code: isServiceErrorCode(value.code) ? value.code : 'network',
    ...(typeof value.retryAt === 'string' ? { retryAt: value.retryAt } : {}),
    ...(typeof value.recoveryUrl === 'string' ? { recoveryUrl: value.recoveryUrl } : {})
  }
  return { ok: false, error: mapped }
}

function isServiceErrorCode(value: unknown): value is JimakuServiceError['code'] {
  return (
    typeof value === 'string' &&
    [
      'cancelled',
      'timeout',
      'network',
      'unauthorized',
      'notFound',
      'rateLimited',
      'serviceUnavailable',
      'invalidResponse',
      'notConfigured',
      'invalidRequest',
      'invalidSession',
      'staleMedia',
      'invalidEntry',
      'invalidCandidate',
      'invalidPackage',
      'invalidMember',
      'expired',
      'openExternalFailed',
      'storage',
      'tooLarge',
      'invalidSubtitle',
      'unsupportedDownload',
      'unsupportedArchive',
      'invalidArchive'
    ].includes(value)
  )
}

function success<T>(value: T): JimakuServiceResult<T> {
  return { ok: true, value }
}

function failure<T>(code: JimakuServiceError['code']): JimakuServiceResult<T> {
  return { ok: false, error: { code } }
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
