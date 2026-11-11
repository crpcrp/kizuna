// Title search, file listing, and archive inspection phases.
import type {
  JimakuArchiveMember,
  JimakuArchiveMembersResult,
  JimakuEntry,
  JimakuFileCandidate,
  JimakuFolderHint,
  JimakuTitleSearchRequest
} from '../../../../shared/jimaku'
import {
  normalizeJimakuNameForMatch,
  parseJimakuVideoIdentityFromPath,
  rankJimakuFiles,
  type JimakuEpisodeRange,
  type JimakuVideoIdentity
} from '../../../../shared/jimakuMatching'
import { INITIAL_STATE, versionOf, type JimakuCore, type Operation } from './core'
import { copyFolderHint, entryFromFolderHint, identityFromFolderHint } from './remembered'
import type { JimakuApi, JimakuController, JimakuEpisodeEdit, JimakuIdentityPatch } from './types'

export type JimakuSearchActions = Pick<
  JimakuController,
  | 'open'
  | 'changeTitle'
  | 'editIdentity'
  | 'editEpisode'
  | 'search'
  | 'chooseTitle'
  | 'showMoreFiles'
  | 'showAllFiles'
  | 'tryAnother'
  | 'refresh'
  | 'openSourcePage'
>

const copyEntries = (entries: readonly JimakuEntry[]): JimakuEntry[] =>
  entries.map((entry) => ({ ...entry, flags: { ...entry.flags } }))

const copyFiles = (files: readonly JimakuFileCandidate[]): JimakuFileCandidate[] =>
  files.map((file) => ({ ...file, reasons: [...file.reasons] }))

export const copyArchive = (archive: JimakuArchiveMembersResult): JimakuArchiveMembersResult => ({
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

export function createJimakuSearch(core: JimakuCore): JimakuSearchActions {
  const {
    getDeps,
    set,
    media,
    contextMatches,
    operationMatches,
    clearSession,
    cancelPending,
    startOperation,
    finishOperation,
    fail,
    serviceError,
    triedVersions,
    resetTitleChoice
  } = core

  const editTitleAndCategory = (patch: JimakuIdentityPatch): void => {
    if (!core.state.identity || core.state.phase.kind === 'idle') return
    const nextQuery = patch.titleQuery ?? patch.query
    let identity = core.state.identity
    let queryChanged = false
    if (nextQuery !== undefined && nextQuery !== identity.titleQuery) {
      const unknowns = identity.unknowns.filter((unknown) => unknown.field !== 'title')
      const titleQuery = nextQuery
      if (titleQuery.trim() === '') unknowns.push({ field: 'title', reason: 'missing' })
      identity = { ...identity, titleQuery, unknowns }
      queryChanged = true
    }

    const categoryChanged = patch.category !== undefined && patch.category !== core.state.category
    const identityChanged = queryChanged || categoryChanged || patch.episode !== undefined
    if (identityChanged) {
      cancelPending()
      ++core.operationId
      core.cancelState = undefined
    }

    if (patch.episode !== undefined) identity = withEpisode(identity, patch.episode)
    const episodeChanged = patch.episode !== undefined
    if (!queryChanged && !categoryChanged && !episodeChanged) return

    if (queryChanged || categoryChanged) {
      set({
        ...core.state,
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

    if (
      episodeChanged &&
      core.state.selectedEntry &&
      (core.state.files.length > 0 || core.state.archive)
    ) {
      const files = rerankFiles(core.state.selectedEntry, identity, core.state.files)
      const archive = core.state.archive
        ? rerankArchive(core.state.archive, core.state.selectedEntry, identity)
        : undefined
      set({
        ...core.state,
        phase: archive ? { kind: 'choosingArchiveMember' } : { kind: 'choosingFile' },
        identity,
        files,
        shownFiles: fileRows(files, core.state.showingMoreFiles, core.state.showingAllFiles),
        selectedFile: core.state.selectedFile,
        archive,
        selectedMember: undefined,
        notice: undefined
      })
      return
    }
    set({
      ...core.state,
      phase:
        core.state.phase.kind === 'setupRequired' ? core.state.phase : { kind: 'choosingTitle' },
      identity,
      notice: undefined
    })
  }

  const changeTitle = (): void => {
    if (!core.sessionId || core.state.phase.kind === 'idle' || !core.state.identity) return
    resetTitleChoice()
  }

  const searchTitles = async (refresh: boolean): Promise<void> => {
    if (
      !core.state.identity ||
      (core.state.phase.kind !== 'choosingTitle' &&
        !(core.state.phase.kind === 'error' && core.state.phase.recovery === 'titles'))
    )
      return
    const query = core.state.identity.titleQuery.trim()
    if (query === '') {
      fail('invalidRequest', 'titles')
      return
    }
    const current = media()
    if (!core.sessionId || !current.filePath || core.state.mediaPath !== current.filePath) return
    const restore = { ...core.state, phase: { kind: 'choosingTitle' } as const, notice: undefined }
    const operation = startOperation({ kind: 'searchingTitles' }, restore)
    if (!operation) return
    set({ ...core.state, rememberedTitle: undefined })
    let result: Awaited<ReturnType<JimakuApi['searchTitles']>>
    try {
      const request: JimakuTitleSearchRequest = {
        query,
        category: core.state.category,
        ...(refresh ? { refresh: true } : {})
      }
      result = await getDeps().jimaku.searchTitles(operation.sessionId!, request)
    } catch {
      result = { ok: false, error: { code: 'network' } }
    }
    if (!operationMatches(operation)) return
    const cancelledRestore = core.cancelState
    finishOperation(operation)
    if (!result.ok) {
      if (result.error.code === 'cancelled') {
        core.cancelState = undefined
        if (cancelledRestore) set({ ...cancelledRestore, notice: undefined })
        return
      }
      if (result.error.code === 'notConfigured') {
        clearSession()
        set({ ...core.state, phase: { kind: 'setupRequired' }, notice: undefined })
        return
      }
      fail(serviceError(result.error.code), 'titles')
      return
    }
    const entries = copyEntries(result.value.entries)
    const selectedEntry = exactTitle(query, entries)
    if (entries.length === 0) {
      set({
        ...core.state,
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
      ...core.state,
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
    const entry = core.state.selectedEntry
    if (
      !entry ||
      (core.state.phase.kind !== 'choosingTitle' &&
        core.state.phase.kind !== 'loadingFiles' &&
        core.state.phase.kind !== 'choosingFile' &&
        !(core.state.phase.kind === 'error' && core.state.phase.recovery === 'files'))
    )
      return
    if (!core.sessionId) return
    const restore = {
      ...core.state,
      phase:
        core.state.files.length > 0
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
    const cancelledRestore = core.cancelState
    finishOperation(operation)
    if (!result.ok) {
      if (result.error.code === 'cancelled') {
        core.cancelState = undefined
        if (cancelledRestore) set({ ...cancelledRestore, notice: undefined })
        return
      }
      fail(serviceError(result.error.code), 'files')
      return
    }
    const files = rerankFiles(entry, core.state.identity, copyFiles(result.value.files))
    if (files.length === 0) {
      set({
        ...core.state,
        files: [],
        shownFiles: [],
        phase: { kind: 'error', code: 'notFound', recovery: 'files' },
        notice: undefined
      })
      return
    }
    set({
      ...core.state,
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

  return {
    async open(): Promise<void> {
      if (core.state.phase.kind !== 'idle' && core.state.phase.kind !== 'setupRequired') return
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
        id: ++core.operationId,
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
        set({ ...core.state, phase: { kind: 'setupRequired' } })
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
          set({ ...core.state, phase: { kind: 'setupRequired' } })
        } else {
          fail(serviceError(started.error.code), 'titles')
        }
        return
      }
      if (started.value.mediaGeneration !== current.loadGeneration) {
        fail('staleMedia', 'titles')
        return
      }
      core.sessionId = started.value.sessionId
      let activeVersionId: string | undefined
      try {
        activeVersionId = versionOf(getDeps().subtitles.capture().selection)
      } catch {
        activeVersionId = undefined
      }
      core.knownVersionIds = new Set(activeVersionId ? [activeVersionId] : [])
      core.previousSelection = undefined
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
        ...core.state,
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
      if (core.state.phase.kind !== 'choosingTitle') return Promise.resolve()
      const entryId = typeof entryValue === 'number' ? entryValue : entryValue.id
      const entry = core.state.entries.find((candidate) => candidate.id === entryId)
      if (!entry) return Promise.resolve()
      set({
        ...core.state,
        phase: { kind: 'loadingFiles' },
        selectedEntry: entry,
        rememberedTitle:
          core.state.rememberedTitle?.entryId === entry.id ? core.state.rememberedTitle : undefined,
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
      if (core.state.phase.kind !== 'choosingFile') return
      set({
        ...core.state,
        showingMoreFiles: true,
        shownFiles: fileRows(core.state.files, true, core.state.showingAllFiles)
      })
    },
    showAllFiles(): void {
      if (core.state.phase.kind !== 'choosingFile') return
      set({
        ...core.state,
        showingMoreFiles: true,
        showingAllFiles: true,
        shownFiles: [...core.state.files]
      })
    },
    tryAnother(): void {
      if (
        core.state.phase.kind === 'idle' ||
        !contextMatches(core.state.mediaPath ?? '', core.state.mediaGeneration ?? -1)
      )
        return
      if (
        core.state.phase.kind === 'searchingTitles' ||
        core.state.phase.kind === 'loadingFiles' ||
        core.state.phase.kind === 'downloading'
      ) {
        cancelPending()
        ++core.operationId
        core.cancelState = undefined
      }
      if (core.state.phase.kind === 'applying') return
      if (core.state.files.length > 0 && core.state.selectedEntry) {
        set({
          ...core.state,
          phase: { kind: 'choosingFile' },
          archive: undefined,
          selectedMember: undefined,
          notice: undefined
        })
      } else if (core.state.entries.length > 0) {
        set({ ...core.state, phase: { kind: 'choosingTitle' }, notice: undefined })
      }
    },
    refresh(): Promise<void> {
      if (
        core.state.phase.kind === 'choosingTitle' ||
        (core.state.phase.kind === 'error' && core.state.phase.recovery === 'titles')
      )
        return searchTitles(true)
      if (
        core.state.phase.kind === 'choosingFile' ||
        (core.state.phase.kind === 'error' && core.state.phase.recovery === 'files')
      )
        return loadFiles(true)
      return Promise.resolve()
    },
    async openSourcePage(entryId = core.state.selectedEntry?.id): Promise<void> {
      if (
        !core.sessionId ||
        entryId === undefined ||
        !core.state.entries.some((entry) => entry.id === entryId)
      )
        return
      const current = media()
      if (!current.filePath || !contextMatches(current.filePath, current.loadGeneration)) return
      const sourceOperationId = core.operationId
      const sourceSessionId = core.sessionId
      try {
        const result = await getDeps().jimaku.openSourcePage(sourceSessionId, entryId)
        if (
          core.operationId !== sourceOperationId ||
          core.sessionId !== sourceSessionId ||
          core.state.phase.kind === 'idle' ||
          !contextMatches(current.filePath, current.loadGeneration)
        )
          return
        if (!result.ok)
          fail(serviceError(result.error.code), core.state.selectedEntry ? 'files' : 'titles')
      } catch {
        if (
          core.operationId === sourceOperationId &&
          core.sessionId === sourceSessionId &&
          core.state.phase.kind !== 'idle' &&
          contextMatches(current.filePath, current.loadGeneration)
        )
          fail('openExternalFailed', core.state.selectedEntry ? 'files' : 'titles')
      }
    }
  }
}
