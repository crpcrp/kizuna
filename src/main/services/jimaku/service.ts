import {
  materializeFiles,
  searchCategory,
  sourcePage,
  toArchiveMembersResult,
  toPreparedResult,
  type CandidateRecord
} from './results'
import { randomUUID } from 'node:crypto'
import { isRemoteUrl } from '../../../shared/mediaFileTypes'
import { type StoredSubtitleSelection } from '../../../shared/mediaHistory'
import {
  type JimakuEntry,
  type JimakuFileListResult,
  type JimakuPreparedSubtitleResult,
  type JimakuPrepareResult,
  type JimakuServiceResult,
  type JimakuSession,
  type JimakuSubtitleExportRequest,
  type JimakuTitleSearchRequest,
  type JimakuTitleSearchResult
} from '../../../shared/jimaku'
import {
  parseJimakuVideoIdentityFromPath,
  type JimakuVideoIdentity
} from '../../../shared/jimakuMatching'
import { JIMAKU_MAX_QUERY_LENGTH, type JimakuClient } from './client'
import type { JimakuArchiveInspection, JimakuArchiveService } from './archive'
import type { JimakuDownloadStore, JimakuPreparedSubtitle } from './downloadStore'
import { exportActiveSubtitle, type ShowJimakuSaveDialog } from './export'
import type { JimakuSettingsService } from './settings'
import type { MediaHistoryService } from '../mediaHistory'
import { fail, ok } from './result'

interface PreparedRecord {
  prepared: JimakuPreparedSubtitle
  committed: boolean
}

interface SessionState {
  sender: unknown
  sessionId: string
  mediaPath: string
  identity: JimakuVideoIdentity
  rememberedEntryId?: number
  pending?: AbortController
  entries: Map<number, JimakuEntry>
  candidates: Map<string, CandidateRecord>
  archive?: JimakuArchiveInspection
  prepared: Map<string, PreparedRecord>
  protectedPaths: Set<string>
}

interface CreateJimakuServiceDeps {
  client: Pick<JimakuClient, 'searchEntries' | 'getEntry' | 'listFiles'>
  settings: Pick<JimakuSettingsService, 'onConfigChange' | 'getFolderHint'>
  downloads: Pick<JimakuDownloadStore, 'prepareDirect' | 'releasePrepared'> &
    Partial<Pick<JimakuDownloadStore, 'cleanup' | 'readManagedSubtitle'>>
  archive: JimakuArchiveService
  mediaHistory?: Pick<MediaHistoryService, 'applyPreparedSubtitle'> &
    Partial<
      Pick<MediaHistoryService, 'getPlaybackHistory' | 'getProtectedJimakuPaths' | 'isCurrentMedia'>
    >
  subtitleExport?: {
    showSaveDialog: ShowJimakuSaveDialog
    platform?: NodeJS.Platform
  }
  openExternal: (url: string) => Promise<void>
}

export type JimakuService = ReturnType<typeof createJimakuService>

export function createJimakuService(deps: CreateJimakuServiceDeps) {
  let disposed = false
  const activeBySender = new Map<unknown, SessionState>()
  const lastGenerationBySender = new Map<unknown, number>()

  const sessionFor = (sender: unknown, sessionId: string): SessionState | undefined => {
    const session = activeBySender.get(sender)
    return session?.sessionId === sessionId ? session : undefined
  }

  const beginOperation = (session: SessionState): AbortSignal => {
    session.pending?.abort()
    session.pending = new AbortController()
    return session.pending.signal
  }

  const releasePrepared = (session: SessionState, keepCommitted = true): void => {
    for (const [handle, record] of session.prepared) {
      if (keepCommitted && record.committed) continue
      deps.downloads.releasePrepared(handle)
      session.prepared.delete(handle)
    }
  }

  const releasePackage = (session: SessionState): void => {
    if (session.archive) deps.archive.releasePackage(session.archive.packageHandle)
    session.archive = undefined
  }

  const cleanupDownloads = (session: SessionState): void => {
    const cleanup = deps.downloads.cleanup
    if (!cleanup) return
    const protectedPaths = new Set(session.protectedPaths)
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
    releasePackage(session)
    releasePrepared(session)
    session.candidates.clear()
    cleanupDownloads(session)
  }

  const clearSearchResults = (session: SessionState): void => {
    clearFileResults(session)
    session.entries.clear()
  }

  const releaseSession = (session: SessionState): void => {
    session.pending?.abort()
    releasePackage(session)
    releasePrepared(session, false)
    activeBySender.delete(session.sender)
    cleanupDownloads(session)
  }

  const removeConfigListener = deps.settings.onConfigChange(() => {
    for (const session of activeBySender.values()) {
      session.pending?.abort()
      clearSearchResults(session)
    }
  })

  function beginSession(
    sender: unknown,
    path: string,
    mediaGeneration: number
  ): JimakuServiceResult<JimakuSession> {
    if (disposed) return fail({ code: 'invalidSession' })
    if (isRemoteUrl(path)) return fail({ code: 'invalidRequest' })

    const previousGeneration = lastGenerationBySender.get(sender)
    if (previousGeneration !== undefined && mediaGeneration < previousGeneration) {
      return fail({ code: 'staleMedia' })
    }

    const identity = parseJimakuVideoIdentityFromPath(path)
    if (!identity) return fail({ code: 'invalidRequest' })

    const previous = activeBySender.get(sender)
    if (previous) releaseSession(previous)

    const session: SessionState = {
      sender,
      sessionId: randomUUID(),
      mediaPath: path,
      identity,
      rememberedEntryId: rememberedEntryId(path, identity),
      entries: new Map(),
      candidates: new Map(),
      prepared: new Map(),
      protectedPaths: new Set()
    }
    activeBySender.set(sender, session)
    lastGenerationBySender.set(sender, mediaGeneration)
    return ok({ sessionId: session.sessionId, mediaGeneration })
  }

  async function searchTitles(
    sender: unknown,
    sessionId: string,
    request: JimakuTitleSearchRequest
  ): Promise<JimakuServiceResult<JimakuTitleSearchResult>> {
    const session = sessionFor(sender, sessionId)
    if (!session) return fail({ code: 'invalidSession' })
    session.rememberedEntryId = undefined

    const query = request.query.trim()
    const category = request.category ?? 'all'
    if (query === '' || [...query].length > JIMAKU_MAX_QUERY_LENGTH) {
      return fail({ code: 'invalidRequest' })
    }

    const signal = beginOperation(session)
    const result = await searchCategory(deps.client, category, query, signal)
    if (signal.aborted) return fail({ code: 'cancelled' })
    clearSearchResults(session)
    if (!result.ok) return result
    session.entries = new Map(result.value.entries.map((entry) => [entry.id, entry]))
    return result
  }

  async function listFiles(
    sender: unknown,
    sessionId: string,
    entryId: number,
    _refresh?: boolean
  ): Promise<JimakuServiceResult<JimakuFileListResult>> {
    const session = sessionFor(sender, sessionId)
    if (!session) return fail({ code: 'invalidSession' })
    let entry = session.entries.get(entryId)
    if (!entry && session.rememberedEntryId !== entryId) return fail({ code: 'invalidEntry' })

    const signal = beginOperation(session)
    if (!entry) {
      const resolved = await deps.client.getEntry(entryId, signal)
      if (signal.aborted) return fail({ code: 'cancelled' })
      if (!resolved.ok) {
        clearFileResults(session)
        return { ok: false, error: resolved.error }
      }
      if (resolved.value.id !== entryId) {
        clearFileResults(session)
        return fail({ code: 'invalidResponse' })
      }
      entry = resolved.value
      session.entries.set(entry.id, entry)
    }

    const result = await deps.client.listFiles(entry.id, signal)
    if (signal.aborted) return fail({ code: 'cancelled' })
    clearFileResults(session)
    if (!result.ok) return result
    return ok(materializeFiles(session.identity, session.candidates, entry, result.value))
  }

  async function prepareFile(
    sender: unknown,
    sessionId: string,
    candidateId: string
  ): Promise<JimakuServiceResult<JimakuPrepareResult>> {
    const session = sessionFor(sender, sessionId)
    if (!session) return fail({ code: 'invalidSession' })
    const candidate = session.candidates.get(candidateId)
    if (!candidate) return fail({ code: 'invalidCandidate' })
    const entry = session.entries.get(candidate.entryId)
    if (!entry) return fail({ code: 'invalidEntry' })
    if (candidate.format === 'unsupported') return fail({ code: 'invalidSubtitle' })

    const signal = beginOperation(session)

    if (candidate.format === 'zip') {
      const inspected = await deps.archive.inspect(
        entry.id,
        candidate.file,
        session.identity,
        entry.flags.movie,
        signal
      )
      if (signal.aborted) {
        if (inspected.ok) deps.archive.releasePackage(inspected.value.packageHandle)
        return fail({ code: 'cancelled' })
      }
      releasePackage(session)
      releasePrepared(session)
      if (!inspected.ok) return inspected
      session.archive = inspected.value
      return ok(toArchiveMembersResult(inspected.value))
    }

    const prepared = await deps.downloads.prepareDirect(entry.id, candidate.file, signal)
    if (!signal.aborted) releasePackage(session)
    return finishPreparation(session, signal, prepared)
  }

  async function prepareArchiveMember(
    sender: unknown,
    sessionId: string,
    packageId: string,
    memberId: string
  ): Promise<JimakuServiceResult<JimakuPreparedSubtitleResult>> {
    const session = sessionFor(sender, sessionId)
    if (!session) return fail({ code: 'invalidSession' })
    if (session.archive?.packageHandle !== packageId) return fail({ code: 'invalidPackage' })
    if (!session.archive.members.some((member) => member.memberId === memberId))
      return fail({ code: 'invalidMember' })

    const signal = beginOperation(session)
    const prepared = await deps.archive.prepareMember(packageId, memberId, signal)
    return finishPreparation(session, signal, prepared)
  }

  function cancelPending(sender: unknown, sessionId: string): JimakuServiceResult<void> {
    const session = sessionFor(sender, sessionId)
    if (!session) return fail({ code: 'invalidSession' })
    session.pending?.abort()
    return ok(undefined)
  }

  function endSession(sender: unknown, sessionId: string): JimakuServiceResult<void> {
    const session = sessionFor(sender, sessionId)
    if (!session) return fail({ code: 'invalidSession' })
    releaseSession(session)
    return ok(undefined)
  }

  async function openSourcePage(
    sender: unknown,
    sessionId: string,
    entryId: number
  ): Promise<JimakuServiceResult<void>> {
    const session = sessionFor(sender, sessionId)
    if (!session) return fail({ code: 'invalidSession' })
    const entry = session.entries.get(entryId)
    if (!entry) return fail({ code: 'invalidEntry' })
    const url = sourcePage(entry.id).url
    try {
      await deps.openExternal(url)
    } catch {
      return fail({ code: 'openExternalFailed' })
    }
    return ok(undefined)
  }

  function commitPreparedSubtitle(
    sender: unknown,
    sessionId: string,
    handle: string
  ): JimakuServiceResult<Extract<StoredSubtitleSelection, { mode: 'external' }>> {
    const session = sessionFor(sender, sessionId)
    if (!session) return fail({ code: 'invalidSession' })
    const record = session.prepared.get(handle)
    if (!record) return fail({ code: 'expired' })
    if (!deps.mediaHistory) return fail({ code: 'storage' })
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
      if (!selection || selection.mode !== 'external') return fail({ code: 'storage' })
      record.committed = true
      cleanupDownloads(session)
      return ok(selection)
    } catch {
      return fail({ code: 'storage' })
    }
  }

  function disposeSender(sender: unknown): void {
    const session = activeBySender.get(sender)
    if (session) releaseSession(session)
    lastGenerationBySender.delete(sender)
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    removeConfigListener()
    for (const session of activeBySender.values()) releaseSession(session)
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
    exportActiveSubtitle: (_sender: unknown, request: JimakuSubtitleExportRequest) =>
      exportActiveSubtitle(deps, request),
    disposeSender,
    dispose
  }

  function rememberedEntryId(mediaPath: string, identity: JimakuVideoIdentity): number | undefined {
    try {
      return deps.settings.getFolderHint(mediaPath, identity.season)?.entryId
    } catch {
      return undefined
    }
  }

  function finishPreparation(
    session: SessionState,
    signal: AbortSignal,
    prepared: JimakuServiceResult<JimakuPreparedSubtitle>
  ): JimakuServiceResult<JimakuPreparedSubtitleResult> {
    if (signal.aborted) {
      if (prepared.ok) deps.downloads.releasePrepared(prepared.value.handle)
      return fail({ code: 'cancelled' })
    }
    releasePrepared(session)
    if (!prepared.ok) return prepared
    session.prepared.set(prepared.value.handle, { prepared: prepared.value, committed: false })
    return ok(toPreparedResult(prepared.value))
  }
}
