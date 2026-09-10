import { useEffect, useState, useSyncExternalStore } from 'react'
import type { KizunaApi } from '../../../shared/preloadApi'
import type {
  JimakuArchiveMember,
  JimakuArchiveMembersResult,
  JimakuEntry,
  JimakuFileCandidate,
  JimakuFolderHint,
  JimakuFolderHintInput,
  JimakuPreparedSubtitleResult,
  JimakuSearchCategory,
  JimakuServiceErrorCode,
  JimakuTitleSearchRequest
} from '../../../shared/jimaku'
import {
  normalizeJimakuNameForMatch,
  parseJimakuVideoIdentityFromPath,
  rankJimakuFiles,
  type JimakuEpisodeRange,
  type JimakuVideoIdentity
} from '../../../shared/jimakuMatching'
import type { StoredSubtitleSelection } from '../../../shared/mediaHistory'
import type { SubtitleSelectionSnapshot } from './trackSelection'
import { useLatestCallback, useLatestRef } from './useLatestRef'

type JimakuApi = Pick<
  KizunaApi['jimaku'],
  | 'getStatus'
  | 'getFolderHint'
  | 'setFolderHint'
  | 'clearFolderHint'
  | 'beginSession'
  | 'searchTitles'
  | 'listFiles'
  | 'prepareFile'
  | 'prepareArchiveMember'
  | 'cancelPending'
  | 'endSession'
  | 'openSourcePage'
  | 'commitPreparedSubtitle'
>

export interface JimakuMediaContext {
  filePath?: string
  loadGeneration: number
}

export type JimakuSelectionApplyResult =
  | { status: 'applied'; warning?: 'persistence' }
  | { status: 'stale' }
  | { status: 'error'; code: JimakuControllerErrorCode }

/** Existing subtitle actions supplied by the media-session owner. */
export interface JimakuSubtitleActions {
  capture(): SubtitleSelectionSnapshot
  applyExternal(
    selection: Extract<StoredSubtitleSelection, { mode: 'external' }>,
    offsetMs: number,
    isCurrent: () => boolean
  ): Promise<JimakuSelectionApplyResult>
  restore(
    snapshot: SubtitleSelectionSnapshot,
    isCurrent: () => boolean
  ): Promise<JimakuSelectionApplyResult>
}

export interface JimakuControllerDeps {
  jimaku: JimakuApi
  getMedia(): JimakuMediaContext
  subtitles: JimakuSubtitleActions
  getSubtitleOffset?(contentVersion: string): number
}

export type JimakuControllerErrorCode = JimakuServiceErrorCode | 'noMedia' | 'selection'
export type JimakuRecoveryTarget = 'titles' | 'files' | 'revert' | null

export type JimakuControllerPhase =
  | { kind: 'idle' }
  | { kind: 'identifying' }
  | { kind: 'setupRequired' }
  | { kind: 'searchingTitles' }
  | { kind: 'choosingTitle' }
  | { kind: 'loadingFiles' }
  | { kind: 'choosingFile' }
  | { kind: 'downloading'; progress: { kind: 'indeterminate' } }
  | { kind: 'choosingArchiveMember' }
  | { kind: 'applying'; contentVersion?: string }
  | { kind: 'error'; code: JimakuControllerErrorCode; recovery: JimakuRecoveryTarget }

export type JimakuControllerNotice = 'applied' | 'sameContent' | 'loadedButNotSaved'

export interface JimakuIdentityPatch {
  query?: string
  titleQuery?: string
  category?: JimakuSearchCategory
  episode?: JimakuEpisodeEdit
}

export type JimakuEpisodeEdit = number | string | JimakuEpisodeRange | null

export interface JimakuControllerState {
  phase: JimakuControllerPhase
  mediaPath?: string
  mediaGeneration?: number
  identity?: JimakuVideoIdentity
  category: JimakuSearchCategory
  /** Complete title results returned by the last title search. */
  entries: JimakuEntry[]
  shownEntries: JimakuEntry[]
  selectedEntry?: JimakuEntry
  rememberedTitle?: JimakuFolderHint
  /** Complete file results for the selected entry. */
  files: JimakuFileCandidate[]
  shownFiles: JimakuFileCandidate[]
  showingMoreFiles: boolean
  showingAllFiles: boolean
  selectedFile?: JimakuFileCandidate
  archive?: JimakuArchiveMembersResult
  selectedMember?: JimakuArchiveMember
  currentVersionId?: string
  triedVersionIds: string[]
  /** Successful downloaded versions keyed by candidate/member identity. */
  appliedVersionByItem: Record<string, string>
  notice?: JimakuControllerNotice
  canRevert: boolean
  partial: boolean
  failedCategories: Array<'anime' | 'liveAction'>
}

export interface JimakuController {
  getState(): JimakuControllerState
  subscribe(listener: () => void): () => void
  open(): Promise<void>
  rememberTitle(remember: boolean): Promise<void>
  clearRememberedTitle(): Promise<void>
  changeTitle(): void
  editIdentity(patch: JimakuIdentityPatch): void
  editEpisode(value: JimakuEpisodeEdit): void
  search(): Promise<void>
  chooseTitle(entry: number | JimakuEntry): Promise<void>
  showMoreFiles(): void
  showAllFiles(): void
  chooseFile(candidateId: string): Promise<void>
  chooseMember(memberId: string): Promise<void>
  cancelOperation(): void
  close(): void
  tryAnother(): void
  revert(): Promise<void>
  refresh(): Promise<void>
  openSourcePage(entryId?: number): Promise<void>
  /** Closes an active session when the injected media identity changes. */
  syncMedia(): void
}

export interface UseJimakuControllerResult extends JimakuControllerState {
  controller: JimakuController
  open(): Promise<void>
  rememberTitle(remember: boolean): Promise<void>
  clearRememberedTitle(): Promise<void>
  changeTitle(): void
  editIdentity(patch: JimakuIdentityPatch): void
  editEpisode(value: JimakuEpisodeEdit): void
  search(): Promise<void>
  chooseTitle(entry: number | JimakuEntry): Promise<void>
  showMoreFiles(): void
  showAllFiles(): void
  chooseFile(candidateId: string): Promise<void>
  chooseMember(memberId: string): Promise<void>
  cancelOperation(): void
  close(): void
  tryAnother(): void
  revert(): Promise<void>
  refresh(): Promise<void>
  openSourcePage(entryId?: number): Promise<void>
}

const INITIAL_STATE: JimakuControllerState = {
  phase: { kind: 'idle' },
  category: 'all',
  entries: [],
  shownEntries: [],
  rememberedTitle: undefined,
  files: [],
  shownFiles: [],
  showingMoreFiles: false,
  showingAllFiles: false,
  triedVersionIds: [],
  appliedVersionByItem: {},
  canRevert: false,
  partial: false,
  failedCategories: []
}

type Operation = {
  id: number
  filePath: string
  loadGeneration: number
  sessionId?: string
}

type ControllerDepsSource = JimakuControllerDeps | (() => JimakuControllerDeps)

export function createJimakuController(deps: JimakuControllerDeps): JimakuController
export function createJimakuController(deps: () => JimakuControllerDeps): JimakuController
export function createJimakuController(source: ControllerDepsSource): JimakuController {
  const getDeps = typeof source === 'function' ? source : () => source
  let state = INITIAL_STATE
  let operationId = 0
  let sessionId: string | undefined
  let previousSelection: SubtitleSelectionSnapshot | undefined
  let knownVersionIds = new Set<string>()
  let cancelState: JimakuControllerState | undefined
  const listeners = new Set<() => void>()

  const set = (next: JimakuControllerState): void => {
    state = next
    listeners.forEach((listener) => listener())
  }

  const media = (): JimakuMediaContext => getDeps().getMedia()

  const contextMatches = (path: string, generation: number): boolean => {
    const current = media()
    return current.filePath === path && current.loadGeneration === generation
  }

  const operationMatches = (operation: Operation): boolean =>
    operationId === operation.id &&
    state.phase.kind !== 'idle' &&
    state.mediaPath === operation.filePath &&
    state.mediaGeneration === operation.loadGeneration &&
    contextMatches(operation.filePath, operation.loadGeneration) &&
    (operation.sessionId === undefined || sessionId === operation.sessionId)

  const clearSession = (): void => {
    const oldSession = sessionId
    sessionId = undefined
    if (oldSession) {
      try {
        void Promise.resolve(getDeps().jimaku.endSession(oldSession)).catch(() => undefined)
      } catch {
        // A teardown request must never prevent the renderer state reset.
      }
    }
  }

  const cancelPending = (): void => {
    if (!sessionId) return
    try {
      void Promise.resolve(getDeps().jimaku.cancelPending(sessionId)).catch(() => undefined)
    } catch {
      // Cancellation is best effort; the operation id still invalidates local work.
    }
  }

  const startOperation = (
    nextPhase: JimakuControllerPhase,
    restore: JimakuControllerState
  ): Operation | undefined => {
    const current = media()
    if (
      !current.filePath ||
      state.mediaPath !== current.filePath ||
      state.mediaGeneration !== current.loadGeneration
    )
      return undefined
    if (
      state.phase.kind === 'searchingTitles' ||
      state.phase.kind === 'loadingFiles' ||
      state.phase.kind === 'downloading' ||
      state.phase.kind === 'applying'
    )
      cancelPending()
    const operation: Operation = {
      id: ++operationId,
      filePath: current.filePath,
      loadGeneration: current.loadGeneration,
      sessionId
    }
    cancelState = restore
    set({ ...state, phase: nextPhase, notice: undefined })
    return operation
  }

  const finishOperation = (operation: Operation): void => {
    if (operationMatches(operation)) cancelState = undefined
  }

  const fail = (
    code: JimakuControllerErrorCode,
    recovery: JimakuRecoveryTarget,
    base: JimakuControllerState = state
  ): void => {
    cancelState = undefined
    set({ ...base, phase: { kind: 'error', code, recovery }, notice: undefined })
  }

  const serviceError = (value: unknown): JimakuControllerErrorCode => {
    if (
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
    ) {
      return value as JimakuControllerErrorCode
    }
    return 'network'
  }

  const copyEntries = (entries: readonly JimakuEntry[]): JimakuEntry[] =>
    entries.map((entry) => ({ ...entry, flags: { ...entry.flags } }))

  const copyFolderHint = (hint: JimakuFolderHint): JimakuFolderHint => ({ ...hint })

  const entryFromFolderHint = (hint: JimakuFolderHint): JimakuEntry => ({
    id: hint.entryId,
    name: hint.name,
    ...(hint.englishName ? { englishName: hint.englishName } : {}),
    ...(hint.japaneseName ? { japaneseName: hint.japaneseName } : {}),
    flags: {
      anime: hint.category === 'anime',
      movie: false,
      external: false,
      unverified: false,
      adult: false
    }
  })

  const identityFromFolderHint = (
    identity: JimakuVideoIdentity,
    hint: JimakuFolderHint
  ): JimakuVideoIdentity => ({
    ...identity,
    titleQuery: hint.name,
    unknowns: identity.unknowns.filter((unknown) => unknown.field !== 'title')
  })

  const copyFiles = (files: readonly JimakuFileCandidate[]): JimakuFileCandidate[] =>
    files.map((file) => ({ ...file, reasons: [...file.reasons] }))

  const copyArchive = (archive: JimakuArchiveMembersResult): JimakuArchiveMembersResult => ({
    ...archive,
    sourcePage: { ...archive.sourcePage },
    members: archive.members.map((member) => ({
      ...member,
      ...(member.inferredEpisodeRange
        ? { inferredEpisodeRange: { ...member.inferredEpisodeRange } }
        : {}),
      reasons: [...member.reasons]
    }))
  })

  const versionOf = (selection: StoredSubtitleSelection): string | undefined =>
    selection.mode === 'external' ? selection.provenance?.contentVersion : undefined

  const triedVersions = (currentVersionId: string | undefined): string[] =>
    [...knownVersionIds].filter((version) => version !== currentVersionId)

  const fileRows = (
    files: readonly JimakuFileCandidate[],
    showMore: boolean,
    showAll: boolean
  ): JimakuFileCandidate[] => {
    const candidates = showAll ? files : files.filter((file) => file.status !== 'excluded')
    return showMore || showAll ? [...candidates] : candidates.slice(0, 5)
  }

  const rerankFiles = (
    entry: JimakuEntry,
    identity: JimakuVideoIdentity | undefined,
    files: readonly JimakuFileCandidate[]
  ): JimakuFileCandidate[] => {
    if (!identity) return copyFiles(files)
    const ranked = rankJimakuFiles(
      { flags: { movie: entry.flags.movie } },
      identity,
      files.map((file) => file.name),
      { showAllFiles: true }
    )
    const remaining = new Map<string, JimakuFileCandidate[]>()
    for (const file of files) {
      const group = remaining.get(file.name) ?? []
      group.push(file)
      remaining.set(file.name, group)
    }
    const result: JimakuFileCandidate[] = []
    for (const rankedFile of ranked) {
      const group = remaining.get(rankedFile.name)
      const original = group?.shift()
      if (!original) continue
      result.push({
        ...original,
        format: rankedFile.format,
        status: rankedFile.status,
        reasons: [...rankedFile.reasons]
      })
    }
    return result.length === files.length ? result : copyFiles(files)
  }

  const rerankArchive = (
    archive: JimakuArchiveMembersResult,
    entry: JimakuEntry,
    identity: JimakuVideoIdentity | undefined
  ): JimakuArchiveMembersResult => {
    if (!identity) return copyArchive(archive)
    const ranked = rankJimakuFiles(
      { flags: { movie: entry.flags.movie } },
      identity,
      archive.members.map((member) => member.displayName),
      { showAllFiles: true }
    )
    const remaining = new Map<string, JimakuArchiveMember[]>()
    for (const member of archive.members) {
      const group = remaining.get(member.displayName) ?? []
      group.push(member)
      remaining.set(member.displayName, group)
    }
    const result: JimakuArchiveMember[] = []
    for (const rankedMember of ranked) {
      const group = remaining.get(rankedMember.name)
      const original = group?.shift()
      if (!original) continue
      const sizeReasons = original.reasons.filter((reason) => /size|limit/iu.test(reason))
      result.push({
        ...original,
        status: sizeReasons.length > 0 ? 'excluded' : rankedMember.status,
        reasons: [...rankedMember.reasons, ...sizeReasons]
      })
    }
    return result.length === archive.members.length
      ? { ...copyArchive(archive), members: result }
      : copyArchive(archive)
  }

  const exactTitle = (query: string, entries: readonly JimakuEntry[]): JimakuEntry | undefined => {
    const normalizedQuery = normalizeJimakuNameForMatch(query)
    if (!normalizedQuery) return undefined
    const matches = entries.filter((entry) =>
      [entry.name, entry.englishName, entry.japaneseName].some(
        (alias) => alias !== undefined && normalizeJimakuNameForMatch(alias) === normalizedQuery
      )
    )
    return matches.length === 1 ? matches[0] : undefined
  }

  const episodeValue = (
    value: JimakuEpisodeEdit
  ): { episode?: number; episodeRange?: JimakuEpisodeRange; invalid: boolean } => {
    if (value === null || value === '') return { invalid: false }
    if (typeof value === 'number') {
      return Number.isSafeInteger(value) && value >= 0
        ? { episode: value, invalid: false }
        : { invalid: true }
    }
    if (typeof value === 'object') {
      return Number.isSafeInteger(value.start) &&
        Number.isSafeInteger(value.end) &&
        value.start >= 0 &&
        value.end >= 0
        ? {
            episodeRange:
              value.start <= value.end
                ? { start: value.start, end: value.end }
                : { start: value.end, end: value.start },
            invalid: false
          }
        : { invalid: true }
    }
    const normalized = value.trim()
    if (normalized === '') return { invalid: false }
    const range = normalized.match(/^(\d{1,4})\s*-\s*(\d{1,4})$/u)
    if (range) {
      const start = Number(range[1])
      const end = Number(range[2])
      return {
        episodeRange: { start: Math.min(start, end), end: Math.max(start, end) },
        invalid: false
      }
    }
    if (/^\d{1,4}$/u.test(normalized)) return { episode: Number(normalized), invalid: false }
    return { invalid: true }
  }

  const withEpisode = (
    identity: JimakuVideoIdentity,
    value: JimakuEpisodeEdit
  ): JimakuVideoIdentity => {
    const parsed = episodeValue(value)
    const unknowns = identity.unknowns.filter((unknown) => unknown.field !== 'episode')
    if (parsed.invalid) unknowns.push({ field: 'episode', reason: 'ambiguous' })
    else if (parsed.episode === undefined && parsed.episodeRange === undefined)
      unknowns.push({ field: 'episode', reason: 'missing' })
    const next: JimakuVideoIdentity = { ...identity, unknowns }
    delete next.episode
    delete next.episodeRange
    if (parsed.episode !== undefined) next.episode = parsed.episode
    if (parsed.episodeRange !== undefined) next.episodeRange = parsed.episodeRange
    return next
  }

  const editTitleAndCategory = (patch: JimakuIdentityPatch): void => {
    if (!state.identity || state.phase.kind === 'idle') return
    const nextQuery = patch.titleQuery ?? patch.query
    let identity = state.identity
    let queryChanged = false
    if (nextQuery !== undefined && nextQuery !== identity.titleQuery) {
      const unknowns = identity.unknowns.filter((unknown) => unknown.field !== 'title')
      const titleQuery = nextQuery
      if (titleQuery.trim() === '') unknowns.push({ field: 'title', reason: 'missing' })
      identity = { ...identity, titleQuery, unknowns }
      queryChanged = true
    }

    const categoryChanged = patch.category !== undefined && patch.category !== state.category
    const identityChanged = queryChanged || categoryChanged || patch.episode !== undefined
    if (identityChanged) {
      cancelPending()
      ++operationId
      cancelState = undefined
    }

    if (patch.episode !== undefined) identity = withEpisode(identity, patch.episode)
    const episodeChanged = patch.episode !== undefined
    if (!queryChanged && !categoryChanged && !episodeChanged) return

    if (queryChanged || categoryChanged) {
      set({
        ...state,
        phase: { kind: 'choosingTitle' },
        identity,
        ...(patch.category === undefined ? {} : { category: patch.category }),
        entries: [],
        shownEntries: [],
        selectedEntry: undefined,
        rememberedTitle: undefined,
        files: [],
        shownFiles: [],
        selectedFile: undefined,
        archive: undefined,
        selectedMember: undefined,
        showingMoreFiles: false,
        showingAllFiles: false,
        partial: false,
        failedCategories: [],
        notice: undefined
      })
      return
    }

    if (episodeChanged && state.selectedEntry && (state.files.length > 0 || state.archive)) {
      const files = rerankFiles(state.selectedEntry, identity, state.files)
      const archive = state.archive
        ? rerankArchive(state.archive, state.selectedEntry, identity)
        : undefined
      set({
        ...state,
        phase: archive ? { kind: 'choosingArchiveMember' } : { kind: 'choosingFile' },
        identity,
        files,
        shownFiles: fileRows(files, state.showingMoreFiles, state.showingAllFiles),
        selectedFile: state.selectedFile,
        archive,
        selectedMember: undefined,
        notice: undefined
      })
      return
    }
    set({
      ...state,
      phase: state.phase.kind === 'setupRequired' ? state.phase : { kind: 'choosingTitle' },
      identity,
      notice: undefined
    })
  }

  const resetTitleChoice = (): void => {
    cancelPending()
    ++operationId
    cancelState = undefined
    set({
      ...state,
      phase: { kind: 'choosingTitle' },
      entries: [],
      shownEntries: [],
      selectedEntry: undefined,
      rememberedTitle: undefined,
      files: [],
      shownFiles: [],
      selectedFile: undefined,
      archive: undefined,
      selectedMember: undefined,
      showingMoreFiles: false,
      showingAllFiles: false,
      partial: false,
      failedCategories: [],
      notice: undefined
    })
  }

  const rememberTitle = async (remember: boolean): Promise<void> => {
    const path = state.mediaPath
    const generation = state.mediaGeneration
    const entry = state.selectedEntry
    const identity = state.identity
    if (!path || generation === undefined || !entry || !identity) return

    if (!remember) {
      const existing = state.rememberedTitle
      if (!existing) return
      try {
        await getDeps().jimaku.clearFolderHint(path, existing.season)
      } catch {
        return
      }
      if (
        state.mediaPath === path &&
        state.mediaGeneration === generation &&
        state.selectedEntry?.id === entry.id
      )
        set({ ...state, rememberedTitle: undefined })
      return
    }

    const input: JimakuFolderHintInput = {
      entryId: entry.id,
      name: entry.name,
      ...(entry.englishName ? { englishName: entry.englishName } : {}),
      ...(entry.japaneseName ? { japaneseName: entry.japaneseName } : {}),
      category: entry.flags.anime ? 'anime' : 'liveAction',
      ...(identity.season === undefined ? {} : { season: identity.season })
    }
    let saved: JimakuFolderHint
    try {
      saved = await getDeps().jimaku.setFolderHint(path, input)
    } catch {
      return
    }
    if (
      state.phase.kind !== 'idle' &&
      state.mediaPath === path &&
      state.mediaGeneration === generation &&
      state.selectedEntry?.id === entry.id
    )
      set({ ...state, rememberedTitle: copyFolderHint(saved) })
  }

  const clearRememberedTitle = async (): Promise<void> => {
    const path = state.mediaPath
    const generation = state.mediaGeneration
    const existing = state.rememberedTitle
    if (!path || generation === undefined || !existing) return
    try {
      await getDeps().jimaku.clearFolderHint(path, existing.season)
    } catch {
      return
    }
    if (
      state.phase.kind === 'idle' ||
      state.mediaPath !== path ||
      state.mediaGeneration !== generation ||
      state.rememberedTitle?.entryId !== existing.entryId
    )
      return
    resetTitleChoice()
  }

  const changeTitle = (): void => {
    if (!sessionId || state.phase.kind === 'idle' || !state.identity) return
    resetTitleChoice()
  }

  const searchTitles = async (refresh: boolean): Promise<void> => {
    if (
      !state.identity ||
      (state.phase.kind !== 'choosingTitle' &&
        !(state.phase.kind === 'error' && state.phase.recovery === 'titles'))
    )
      return
    const query = state.identity.titleQuery.trim()
    if (query === '') {
      fail('invalidRequest', 'titles')
      return
    }
    const current = media()
    if (!sessionId || !current.filePath || state.mediaPath !== current.filePath) return
    const restore = { ...state, phase: { kind: 'choosingTitle' } as const, notice: undefined }
    const operation = startOperation({ kind: 'searchingTitles' }, restore)
    if (!operation) return
    set({ ...state, rememberedTitle: undefined })
    let result: Awaited<ReturnType<JimakuApi['searchTitles']>>
    try {
      const request: JimakuTitleSearchRequest = {
        query,
        category: state.category,
        ...(refresh ? { refresh: true } : {})
      }
      result = await getDeps().jimaku.searchTitles(operation.sessionId!, request)
    } catch {
      result = { ok: false, error: { code: 'network' } }
    }
    if (!operationMatches(operation)) return
    const cancelledRestore = cancelState
    finishOperation(operation)
    if (!result.ok) {
      if (result.error.code === 'cancelled') {
        cancelState = undefined
        if (cancelledRestore) set({ ...cancelledRestore, notice: undefined })
        return
      }
      if (result.error.code === 'notConfigured') {
        clearSession()
        set({ ...state, phase: { kind: 'setupRequired' }, notice: undefined })
        return
      }
      fail(serviceError(result.error.code), 'titles')
      return
    }
    const entries = copyEntries(result.value.entries)
    const selectedEntry = exactTitle(query, entries)
    if (entries.length === 0) {
      set({
        ...state,
        entries: [],
        shownEntries: [],
        selectedEntry: undefined,
        phase: { kind: 'error', code: 'notFound', recovery: 'titles' },
        partial: result.value.partial,
        failedCategories: [...(result.value.failedCategories ?? [])],
        notice: undefined
      })
      return
    }
    set({
      ...state,
      phase: { kind: 'choosingTitle' },
      entries,
      shownEntries: [...entries],
      selectedEntry,
      files: [],
      shownFiles: [],
      selectedFile: undefined,
      archive: undefined,
      selectedMember: undefined,
      showingMoreFiles: false,
      showingAllFiles: false,
      partial: result.value.partial,
      failedCategories: [...(result.value.failedCategories ?? [])],
      notice: undefined
    })
  }

  const loadFiles = async (refresh: boolean): Promise<void> => {
    const entry = state.selectedEntry
    if (
      !entry ||
      (state.phase.kind !== 'choosingTitle' &&
        state.phase.kind !== 'loadingFiles' &&
        state.phase.kind !== 'choosingFile' &&
        !(state.phase.kind === 'error' && state.phase.recovery === 'files'))
    )
      return
    if (!sessionId) return
    const restore = {
      ...state,
      phase:
        state.files.length > 0
          ? ({ kind: 'choosingFile' } as const)
          : ({ kind: 'choosingTitle' } as const),
      notice: undefined
    }
    const operation = startOperation({ kind: 'loadingFiles' }, restore)
    if (!operation) return
    let result: Awaited<ReturnType<JimakuApi['listFiles']>>
    try {
      result = await getDeps().jimaku.listFiles(operation.sessionId!, entry.id, refresh)
    } catch {
      result = { ok: false, error: { code: 'network' } }
    }
    if (!operationMatches(operation)) return
    const cancelledRestore = cancelState
    finishOperation(operation)
    if (!result.ok) {
      if (result.error.code === 'cancelled') {
        cancelState = undefined
        if (cancelledRestore) set({ ...cancelledRestore, notice: undefined })
        return
      }
      fail(serviceError(result.error.code), 'files')
      return
    }
    const files = rerankFiles(entry, state.identity, copyFiles(result.value.files))
    if (files.length === 0) {
      set({
        ...state,
        files: [],
        shownFiles: [],
        phase: { kind: 'error', code: 'notFound', recovery: 'files' },
        notice: undefined
      })
      return
    }
    set({
      ...state,
      phase: { kind: 'choosingFile' },
      files,
      shownFiles: fileRows(files, false, false),
      showingMoreFiles: false,
      showingAllFiles: false,
      selectedFile: undefined,
      archive: undefined,
      selectedMember: undefined,
      notice: undefined
    })
  }

  const applyPrepared = async (
    operation: Operation,
    prepared: JimakuPreparedSubtitleResult,
    itemKey: string
  ): Promise<void> => {
    if (!operationMatches(operation)) return
    let snapshot: SubtitleSelectionSnapshot
    try {
      snapshot = getDeps().subtitles.capture()
    } catch {
      fail('selection', 'files')
      return
    }
    const activeVersionId = versionOf(snapshot.selection)
    if (activeVersionId) knownVersionIds.add(activeVersionId)
    let offset = 0
    try {
      offset = getDeps().getSubtitleOffset?.(prepared.contentVersion) ?? 0
    } catch {
      offset = 0
    }

    if (activeVersionId === prepared.contentVersion) {
      set({
        ...state,
        phase: { kind: 'choosingFile' },
        currentVersionId: prepared.contentVersion,
        triedVersionIds: triedVersions(prepared.contentVersion),
        appliedVersionByItem: {
          ...state.appliedVersionByItem,
          [itemKey]: prepared.contentVersion
        },
        notice: 'sameContent'
      })
      return
    }

    set({
      ...state,
      phase: { kind: 'applying', contentVersion: prepared.contentVersion },
      currentVersionId: activeVersionId,
      triedVersionIds: triedVersions(activeVersionId),
      notice: undefined
    })
    cancelState = {
      ...state,
      phase: { kind: 'choosingFile' },
      notice: undefined
    }

    let applied: JimakuSelectionApplyResult
    try {
      applied = await getDeps().subtitles.applyExternal(
        prepared.selection,
        Number.isFinite(offset) ? offset : 0,
        () => operationMatches(operation)
      )
    } catch {
      applied = { status: 'error', code: 'selection' }
    }
    if (!operationMatches(operation)) return
    if (applied.status === 'stale') {
      const restore = cancelState
      cancelState = undefined
      if (restore) set({ ...restore, notice: undefined })
      return
    }
    if (applied.status === 'error') {
      fail(applied.code, 'files')
      return
    }

    let committed = true
    try {
      const result = await getDeps().jimaku.commitPreparedSubtitle(
        operation.sessionId!,
        prepared.handle
      )
      committed = result.ok
    } catch {
      committed = false
    }
    if (!operationMatches(operation)) return

    knownVersionIds.add(prepared.contentVersion)
    previousSelection = cloneSnapshot(snapshot)
    const appliedVersionByItem = {
      ...state.appliedVersionByItem,
      [itemKey]: prepared.contentVersion
    }
    const currentVersionId = prepared.contentVersion
    cancelState = undefined
    set({
      ...state,
      phase: { kind: 'choosingFile' },
      currentVersionId,
      triedVersionIds: triedVersions(currentVersionId),
      appliedVersionByItem,
      canRevert: true,
      notice: committed ? 'applied' : 'loadedButNotSaved'
    })
  }

  const prepareFile = async (candidateId: string): Promise<void> => {
    if ((state.phase.kind !== 'choosingFile' && state.phase.kind !== 'downloading') || !sessionId)
      return
    const candidate = state.files.find((file) => file.candidateId === candidateId)
    if (!candidate || candidate.format === 'unsupported') return
    if (candidate.status === 'excluded' && !state.showingAllFiles) return
    const restore = { ...state, phase: { kind: 'choosingFile' } as const, notice: undefined }
    const operation = startOperation(
      { kind: 'downloading', progress: { kind: 'indeterminate' } },
      restore
    )
    if (!operation) return
    set({ ...state, selectedFile: candidate, archive: undefined, selectedMember: undefined })
    let result: Awaited<ReturnType<JimakuApi['prepareFile']>>
    try {
      result = await getDeps().jimaku.prepareFile(operation.sessionId!, candidate.candidateId)
    } catch {
      result = { ok: false, error: { code: 'network' } }
    }
    if (!operationMatches(operation)) return
    const cancelledRestore = cancelState
    finishOperation(operation)
    if (!result.ok) {
      if (result.error.code === 'cancelled') {
        cancelState = undefined
        if (cancelledRestore) set({ ...cancelledRestore, notice: undefined })
        return
      }
      fail(serviceError(result.error.code), 'files')
      return
    }
    if (result.value.kind === 'archiveMembers') {
      set({
        ...state,
        phase: { kind: 'choosingArchiveMember' },
        archive: copyArchive(result.value),
        selectedFile: candidate,
        selectedMember: undefined,
        notice: undefined
      })
      return
    }
    await applyPrepared(operation, result.value, candidate.candidateId)
  }

  const prepareMember = async (memberId: string): Promise<void> => {
    if (
      (state.phase.kind !== 'choosingArchiveMember' && state.phase.kind !== 'downloading') ||
      !sessionId ||
      !state.archive
    )
      return
    const member = state.archive.members.find((candidate) => candidate.memberId === memberId)
    if (!member || (member.status === 'excluded' && !state.showingAllFiles)) return
    const restore = {
      ...state,
      phase: { kind: 'choosingArchiveMember' } as const,
      notice: undefined
    }
    const operation = startOperation(
      { kind: 'downloading', progress: { kind: 'indeterminate' } },
      restore
    )
    if (!operation) return
    set({ ...state, selectedMember: member, notice: undefined })
    let result: Awaited<ReturnType<JimakuApi['prepareArchiveMember']>>
    try {
      result = await getDeps().jimaku.prepareArchiveMember(
        operation.sessionId!,
        state.archive.packageId,
        member.memberId
      )
    } catch {
      result = { ok: false, error: { code: 'network' } }
    }
    if (!operationMatches(operation)) return
    const cancelledRestore = cancelState
    finishOperation(operation)
    if (!result.ok) {
      if (result.error.code === 'cancelled') {
        cancelState = undefined
        if (cancelledRestore) set({ ...cancelledRestore, notice: undefined })
        return
      }
      fail(serviceError(result.error.code), 'files')
      return
    }
    const candidateId = state.selectedFile?.candidateId ?? 'archive'
    await applyPrepared(operation, result.value, `${candidateId}:${member.memberId}`)
  }

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async open(): Promise<void> {
      if (state.phase.kind !== 'idle' && state.phase.kind !== 'setupRequired') return
      const current = media()
      const path = current.filePath
      if (!path) {
        set({ ...INITIAL_STATE, phase: { kind: 'error', code: 'noMedia', recovery: null } })
        return
      }
      const identity = parseJimakuVideoIdentityFromPath(path)
      if (!identity) {
        set({
          ...INITIAL_STATE,
          mediaPath: path,
          mediaGeneration: current.loadGeneration,
          phase: { kind: 'error', code: 'invalidRequest', recovery: null }
        })
        return
      }
      const operation: Operation = {
        id: ++operationId,
        filePath: path,
        loadGeneration: current.loadGeneration
      }
      set({
        ...INITIAL_STATE,
        phase: { kind: 'identifying' },
        mediaPath: path,
        mediaGeneration: current.loadGeneration,
        identity
      })
      let status: Awaited<ReturnType<JimakuApi['getStatus']>>
      try {
        status = await getDeps().jimaku.getStatus()
      } catch {
        if (operationMatches(operation)) fail('network', 'titles')
        return
      }
      if (!operationMatches(operation)) return
      if (!status.configured) {
        set({ ...state, phase: { kind: 'setupRequired' } })
        return
      }
      let started: Awaited<ReturnType<JimakuApi['beginSession']>>
      try {
        started = await getDeps().jimaku.beginSession(path, current.loadGeneration)
      } catch {
        started = { ok: false, error: { code: 'network' } }
      }
      if (!operationMatches(operation)) return
      if (!started.ok) {
        if (started.error.code === 'notConfigured') {
          clearSession()
          set({ ...state, phase: { kind: 'setupRequired' } })
        } else {
          fail(serviceError(started.error.code), 'titles')
        }
        return
      }
      if (started.value.mediaGeneration !== current.loadGeneration) {
        fail('staleMedia', 'titles')
        return
      }
      sessionId = started.value.sessionId
      let activeVersionId: string | undefined
      try {
        activeVersionId = versionOf(getDeps().subtitles.capture().selection)
      } catch {
        activeVersionId = undefined
      }
      knownVersionIds = new Set(activeVersionId ? [activeVersionId] : [])
      previousSelection = undefined
      let rememberedTitle: JimakuFolderHint | undefined
      try {
        rememberedTitle = await getDeps().jimaku.getFolderHint(path, identity.season)
      } catch {
        rememberedTitle = undefined
      }
      if (!operationMatches(operation)) return
      const rememberedEntry = rememberedTitle ? entryFromFolderHint(rememberedTitle) : undefined
      const activeIdentity = rememberedTitle
        ? identityFromFolderHint(identity, rememberedTitle)
        : identity
      set({
        ...state,
        phase: { kind: 'choosingTitle' },
        identity: activeIdentity,
        category: rememberedTitle?.category ?? 'all',
        entries: rememberedEntry ? [rememberedEntry] : [],
        shownEntries: rememberedEntry ? [rememberedEntry] : [],
        selectedEntry: rememberedEntry,
        rememberedTitle: rememberedTitle ? copyFolderHint(rememberedTitle) : undefined,
        currentVersionId: activeVersionId,
        triedVersionIds: triedVersions(activeVersionId)
      })
    },
    rememberTitle,
    clearRememberedTitle,
    changeTitle,
    editIdentity(patch): void {
      editTitleAndCategory(patch)
    },
    editEpisode(value): void {
      editTitleAndCategory({ episode: value })
    },
    search(): Promise<void> {
      return searchTitles(false)
    },
    chooseTitle(entryValue): Promise<void> {
      if (state.phase.kind !== 'choosingTitle') return Promise.resolve()
      const entryId = typeof entryValue === 'number' ? entryValue : entryValue.id
      const entry = state.entries.find((candidate) => candidate.id === entryId)
      if (!entry) return Promise.resolve()
      set({
        ...state,
        phase: { kind: 'loadingFiles' },
        selectedEntry: entry,
        rememberedTitle:
          state.rememberedTitle?.entryId === entry.id ? state.rememberedTitle : undefined,
        files: [],
        shownFiles: [],
        selectedFile: undefined,
        archive: undefined,
        selectedMember: undefined,
        notice: undefined
      })
      return loadFiles(false)
    },
    showMoreFiles(): void {
      if (state.phase.kind !== 'choosingFile') return
      set({
        ...state,
        showingMoreFiles: true,
        shownFiles: fileRows(state.files, true, state.showingAllFiles)
      })
    },
    showAllFiles(): void {
      if (state.phase.kind !== 'choosingFile') return
      set({
        ...state,
        showingMoreFiles: true,
        showingAllFiles: true,
        shownFiles: [...state.files]
      })
    },
    chooseFile: prepareFile,
    chooseMember: prepareMember,
    cancelOperation(): void {
      if (
        state.phase.kind !== 'searchingTitles' &&
        state.phase.kind !== 'loadingFiles' &&
        state.phase.kind !== 'downloading' &&
        state.phase.kind !== 'applying'
      )
        return
      cancelPending()
      ++operationId
      const restore = cancelState
      cancelState = undefined
      if (restore) set({ ...restore, notice: undefined })
    },
    close(): void {
      ++operationId
      cancelPending()
      clearSession()
      cancelState = undefined
      previousSelection = undefined
      knownVersionIds = new Set()
      set(INITIAL_STATE)
    },
    tryAnother(): void {
      if (
        state.phase.kind === 'idle' ||
        !contextMatches(state.mediaPath ?? '', state.mediaGeneration ?? -1)
      )
        return
      if (
        state.phase.kind === 'searchingTitles' ||
        state.phase.kind === 'loadingFiles' ||
        state.phase.kind === 'downloading'
      ) {
        cancelPending()
        ++operationId
        cancelState = undefined
      }
      if (state.phase.kind === 'applying') return
      if (state.files.length > 0 && state.selectedEntry) {
        set({
          ...state,
          phase: { kind: 'choosingFile' },
          archive: undefined,
          selectedMember: undefined,
          notice: undefined
        })
      } else if (state.entries.length > 0) {
        set({ ...state, phase: { kind: 'choosingTitle' }, notice: undefined })
      }
    },
    async revert(): Promise<void> {
      if (
        !previousSelection ||
        !state.canRevert ||
        (state.phase.kind !== 'choosingFile' &&
          state.phase.kind !== 'choosingArchiveMember' &&
          !(state.phase.kind === 'error' && state.phase.recovery === 'files'))
      )
        return
      const current = media()
      if (
        !current.filePath ||
        current.filePath !== state.mediaPath ||
        current.loadGeneration !== state.mediaGeneration
      )
        return
      const target = cloneSnapshot(previousSelection)
      const restore = { ...state, phase: { kind: 'choosingFile' } as const, notice: undefined }
      const operation = startOperation(
        { kind: 'applying', contentVersion: versionOf(target.selection) },
        restore
      )
      if (!operation) return
      let applied: JimakuSelectionApplyResult
      try {
        applied = await getDeps().subtitles.restore(target, () => operationMatches(operation))
      } catch {
        applied = { status: 'error', code: 'selection' }
      }
      if (!operationMatches(operation)) return
      if (applied.status === 'stale') {
        const staleRestore = cancelState
        cancelState = undefined
        if (staleRestore) set({ ...staleRestore, notice: undefined })
        return
      }
      if (applied.status === 'error') {
        if (applied.code === 'notFound') {
          previousSelection = undefined
          set({
            ...state,
            phase: { kind: 'error', code: applied.code, recovery: 'revert' },
            canRevert: false
          })
        } else fail(applied.code, 'revert')
        return
      }
      const currentVersionId = versionOf(target.selection)
      if (currentVersionId) knownVersionIds.add(currentVersionId)
      previousSelection = undefined
      cancelState = undefined
      set({
        ...state,
        phase: { kind: 'choosingFile' },
        currentVersionId,
        triedVersionIds: triedVersions(currentVersionId),
        canRevert: false,
        notice: applied.warning === 'persistence' ? 'loadedButNotSaved' : 'applied'
      })
    },
    refresh(): Promise<void> {
      if (
        state.phase.kind === 'choosingTitle' ||
        (state.phase.kind === 'error' && state.phase.recovery === 'titles')
      )
        return searchTitles(true)
      if (
        state.phase.kind === 'choosingFile' ||
        (state.phase.kind === 'error' && state.phase.recovery === 'files')
      )
        return loadFiles(true)
      return Promise.resolve()
    },
    async openSourcePage(entryId = state.selectedEntry?.id): Promise<void> {
      if (
        !sessionId ||
        entryId === undefined ||
        !state.entries.some((entry) => entry.id === entryId)
      )
        return
      const current = media()
      if (!current.filePath || !contextMatches(current.filePath, current.loadGeneration)) return
      const sourceOperationId = operationId
      const sourceSessionId = sessionId
      try {
        const result = await getDeps().jimaku.openSourcePage(sourceSessionId, entryId)
        if (
          operationId !== sourceOperationId ||
          sessionId !== sourceSessionId ||
          state.phase.kind === 'idle' ||
          !contextMatches(current.filePath, current.loadGeneration)
        )
          return
        if (!result.ok)
          fail(serviceError(result.error.code), state.selectedEntry ? 'files' : 'titles')
      } catch {
        if (
          operationId === sourceOperationId &&
          sessionId === sourceSessionId &&
          state.phase.kind !== 'idle' &&
          contextMatches(current.filePath, current.loadGeneration)
        )
          fail('openExternalFailed', state.selectedEntry ? 'files' : 'titles')
      }
    },
    syncMedia(): void {
      if (state.phase.kind === 'idle') return
      const current = media()
      if (
        current.filePath !== state.mediaPath ||
        current.loadGeneration !== state.mediaGeneration
      ) {
        ++operationId
        cancelPending()
        clearSession()
        cancelState = undefined
        previousSelection = undefined
        knownVersionIds = new Set()
        set(INITIAL_STATE)
      }
    }
  }
}

function cloneSnapshot(snapshot: SubtitleSelectionSnapshot): SubtitleSelectionSnapshot {
  const selection = snapshot.selection
  return {
    offsetMs: snapshot.offsetMs,
    selection:
      selection.mode === 'track'
        ? { mode: 'track', track: { ...selection.track } }
        : selection.mode === 'external'
          ? {
              ...selection,
              ...(selection.provenance ? { provenance: { ...selection.provenance } } : {})
            }
          : { mode: 'off' }
  }
}

/** React adapter for the independent renderer controller. */
export function useJimakuController(input: JimakuControllerDeps): UseJimakuControllerResult {
  const inputRef = useLatestRef(input)
  // The getter is only evaluated by controller actions/effects after mount;
  // the initializer stores it without reading the ref during render.
  // eslint-disable-next-line react-hooks/refs -- see the comment above.
  const [controller] = useState(() => createJimakuController(() => inputRef.current))
  const state = useSyncExternalStore(
    controller.subscribe,
    () => controller.getState(),
    () => controller.getState()
  )
  const currentMedia = input.getMedia()

  useEffect(() => {
    controller.syncMedia()
  }, [controller, currentMedia.filePath, currentMedia.loadGeneration])
  useEffect(() => () => controller.close(), [controller])

  return {
    ...state,
    controller,
    open: useLatestCallback(() => controller.open()),
    rememberTitle: useLatestCallback((remember: boolean) => controller.rememberTitle(remember)),
    clearRememberedTitle: useLatestCallback(() => controller.clearRememberedTitle()),
    changeTitle: useLatestCallback(() => controller.changeTitle()),
    editIdentity: useLatestCallback((patch: JimakuIdentityPatch) => controller.editIdentity(patch)),
    editEpisode: useLatestCallback((value: JimakuEpisodeEdit) => controller.editEpisode(value)),
    search: useLatestCallback(() => controller.search()),
    chooseTitle: useLatestCallback((entry: number | JimakuEntry) => controller.chooseTitle(entry)),
    showMoreFiles: useLatestCallback(() => controller.showMoreFiles()),
    showAllFiles: useLatestCallback(() => controller.showAllFiles()),
    chooseFile: useLatestCallback((candidateId: string) => controller.chooseFile(candidateId)),
    chooseMember: useLatestCallback((memberId: string) => controller.chooseMember(memberId)),
    cancelOperation: useLatestCallback(() => controller.cancelOperation()),
    close: useLatestCallback(() => controller.close()),
    tryAnother: useLatestCallback(() => controller.tryAnother()),
    revert: useLatestCallback(() => controller.revert()),
    refresh: useLatestCallback(() => controller.refresh()),
    openSourcePage: useLatestCallback((entryId?: number) => controller.openSourcePage(entryId))
  }
}
