// Title search, file listing, archive inspection, and remembered-title phases.
import type {
  JimakuArchiveMembersResult,
  JimakuEntry,
  JimakuFileCandidate,
  JimakuFolderHint,
  JimakuFolderHintInput,
  JimakuTitleSearchRequest
} from '../../../../shared/jimaku'
import {
  normalizeJimakuNameForMatch,
  parseJimakuVideoIdentityFromPath,
  rankJimakuFiles,
  type JimakuEpisodeRange,
  type JimakuVideoIdentity
} from '../../../../shared/jimakuMatching'
import {
  INITIAL_STATE,
  TITLE_CHOICE_RESET,
  isBusy,
  versionOf,
  type JimakuCore,
  type Operation
} from './core'
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
  | 'rememberTitle'
  | 'clearRememberedTitle'
>

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

type RankedFile = ReturnType<typeof rankJimakuFiles>[number]

/** Re-ranks `items` for `identity`; undefined when names cannot be matched back one-to-one. */
const rerank = <T>(
  entry: JimakuEntry,
  identity: JimakuVideoIdentity,
  items: readonly T[],
  nameOf: (item: T) => string,
  merge: (item: T, ranked: RankedFile) => T
): T[] | undefined => {
  const ranked = rankJimakuFiles(
    { flags: { movie: entry.flags.movie } },
    identity,
    items.map(nameOf),
    {
      showAllFiles: true
    }
  )
  const remaining = new Map<string, T[]>()
  for (const item of items)
    remaining.set(nameOf(item), [...(remaining.get(nameOf(item)) ?? []), item])
  const result = ranked.flatMap((rankedItem) => {
    const original = remaining.get(rankedItem.name)?.shift()
    return original ? [merge(original, rankedItem)] : []
  })
  return result.length === items.length ? result : undefined
}

const rerankFiles = (
  entry: JimakuEntry,
  identity: JimakuVideoIdentity | undefined,
  files: readonly JimakuFileCandidate[]
): JimakuFileCandidate[] =>
  (identity &&
    rerank(
      entry,
      identity,
      files,
      (file) => file.name,
      (file, ranked) => ({
        ...file,
        format: ranked.format,
        status: ranked.status,
        reasons: [...ranked.reasons]
      })
    )) ??
  copyFiles(files)

const rerankArchive = (
  archive: JimakuArchiveMembersResult,
  entry: JimakuEntry,
  identity: JimakuVideoIdentity | undefined
): JimakuArchiveMembersResult => {
  const members =
    identity &&
    rerank(
      entry,
      identity,
      archive.members,
      (member) => member.displayName,
      (member, ranked) => {
        const sizeReasons = member.reasons.filter((reason) => /size|limit/iu.test(reason))
        return {
          ...member,
          status: sizeReasons.length > 0 ? 'excluded' : ranked.status,
          reasons: [...ranked.reasons, ...sizeReasons]
        }
      }
    )
  return members ? { ...copyArchive(archive), members } : copyArchive(archive)
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
    abortOperation,
    startOperation,
    request,
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
    if (identityChanged) abortOperation()

    if (patch.episode !== undefined) identity = withEpisode(identity, patch.episode)
    const episodeChanged = patch.episode !== undefined
    if (!queryChanged && !categoryChanged && !episodeChanged) return

    if (queryChanged || categoryChanged) {
      set({
        ...core.state,
        ...TITLE_CHOICE_RESET,
        identity,
        ...(patch.category === undefined ? {} : { category: patch.category })
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

  const rememberTitle = async (remember: boolean): Promise<void> => {
    const path = core.state.mediaPath
    const generation = core.state.mediaGeneration
    const entry = core.state.selectedEntry
    const identity = core.state.identity
    if (!path || generation === undefined || !entry || !identity) return

    if (!remember) {
      const existing = core.state.rememberedTitle
      if (!existing) return
      try {
        await getDeps().jimaku.clearFolderHint(path, existing.season)
      } catch {
        return
      }
      if (
        core.state.mediaPath === path &&
        core.state.mediaGeneration === generation &&
        core.state.selectedEntry?.id === entry.id
      )
        set({ ...core.state, rememberedTitle: undefined })
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
      core.state.phase.kind !== 'idle' &&
      core.state.mediaPath === path &&
      core.state.mediaGeneration === generation &&
      core.state.selectedEntry?.id === entry.id
    )
      set({ ...core.state, rememberedTitle: copyFolderHint(saved) })
  }

  const clearRememberedTitle = async (): Promise<void> => {
    const path = core.state.mediaPath
    const generation = core.state.mediaGeneration
    const existing = core.state.rememberedTitle
    if (!path || generation === undefined || !existing) return
    try {
      await getDeps().jimaku.clearFolderHint(path, existing.season)
    } catch {
      return
    }
    if (
      core.state.phase.kind === 'idle' ||
      core.state.mediaPath !== path ||
      core.state.mediaGeneration !== generation ||
      core.state.rememberedTitle?.entryId !== existing.entryId
    )
      return
    resetTitleChoice()
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
    const searchRequest: JimakuTitleSearchRequest = {
      query,
      category: core.state.category,
      ...(refresh ? { refresh: true } : {})
    }
    const value = await request(
      operation,
      'titles',
      (sessionId) => getDeps().jimaku.searchTitles(sessionId, searchRequest),
      (code) => {
        if (code !== 'notConfigured') return false
        clearSession()
        set({ ...core.state, phase: { kind: 'setupRequired' }, notice: undefined })
        return true
      }
    )
    if (!value) return
    const entries = copyEntries(value.entries)
    const selectedEntry = exactTitle(query, entries)
    if (entries.length === 0) {
      set({
        ...core.state,
        entries: [],
        shownEntries: [],
        selectedEntry: undefined,
        phase: { kind: 'error', code: 'notFound', recovery: 'titles' },
        partial: value.partial,
        failedCategories: [...(value.failedCategories ?? [])],
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
      partial: value.partial,
      failedCategories: [...(value.failedCategories ?? [])],
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
    const value = await request(operation, 'files', (sessionId) =>
      getDeps().jimaku.listFiles(sessionId, entry.id, refresh)
    )
    if (!value) return
    const files = rerankFiles(entry, core.state.identity, copyFiles(value.files))
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
    rememberTitle,
    clearRememberedTitle,
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
      if (core.state.phase.kind === 'applying') return
      if (isBusy(core.state.phase)) abortOperation()
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
      const stillCurrent = (): boolean =>
        core.operationId === sourceOperationId &&
        core.sessionId === sourceSessionId &&
        core.state.phase.kind !== 'idle' &&
        contextMatches(current.filePath!, current.loadGeneration)
      const recovery = (): 'files' | 'titles' => (core.state.selectedEntry ? 'files' : 'titles')
      try {
        const result = await getDeps().jimaku.openSourcePage(sourceSessionId, entryId)
        if (stillCurrent() && !result.ok) fail(serviceError(result.error.code), recovery())
      } catch {
        if (stillCurrent()) fail('openExternalFailed', recovery())
      }
    }
  }
}
