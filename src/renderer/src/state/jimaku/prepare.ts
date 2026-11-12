// Prepare, commit, replace, and revert the active subtitle.
import type { JimakuPreparedSubtitleResult } from '../../../../shared/jimaku'
import type { SubtitleSelectionSnapshot } from '../trackSelection'
import { versionOf, type JimakuCore, type Operation } from './core'
import { copyArchive } from './search'
import type { JimakuController, JimakuSelectionApplyResult } from './types'

export type JimakuPrepareActions = Pick<JimakuController, 'chooseFile' | 'chooseMember' | 'revert'>

export function createJimakuPrepare(core: JimakuCore): JimakuPrepareActions {
  const {
    getDeps,
    set,
    media,
    operationMatches,
    startOperation,
    request,
    restoreCancelState,
    fail,
    triedVersions
  } = core

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
    if (activeVersionId) core.knownVersionIds.add(activeVersionId)
    let offset = 0
    try {
      offset = getDeps().getSubtitleOffset?.(prepared.contentVersion) ?? 0
    } catch {
      offset = 0
    }

    if (activeVersionId === prepared.contentVersion) {
      set({
        ...core.state,
        phase: { kind: 'choosingFile' },
        currentVersionId: prepared.contentVersion,
        triedVersionIds: triedVersions(prepared.contentVersion),
        appliedVersionByItem: {
          ...core.state.appliedVersionByItem,
          [itemKey]: prepared.contentVersion
        },
        notice: 'sameContent'
      })
      return
    }

    set({
      ...core.state,
      phase: { kind: 'applying', contentVersion: prepared.contentVersion },
      currentVersionId: activeVersionId,
      triedVersionIds: triedVersions(activeVersionId),
      notice: undefined
    })
    core.cancelState = {
      ...core.state,
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
      restoreCancelState()
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

    core.knownVersionIds.add(prepared.contentVersion)
    core.previousSelection = cloneSnapshot(snapshot)
    const appliedVersionByItem = {
      ...core.state.appliedVersionByItem,
      [itemKey]: prepared.contentVersion
    }
    const currentVersionId = prepared.contentVersion
    core.cancelState = undefined
    set({
      ...core.state,
      phase: { kind: 'choosingFile' },
      currentVersionId,
      triedVersionIds: triedVersions(currentVersionId),
      appliedVersionByItem,
      canRevert: true,
      notice: committed ? 'applied' : 'loadedButNotSaved'
    })
  }

  const prepareFile = async (candidateId: string): Promise<void> => {
    if (
      (core.state.phase.kind !== 'choosingFile' && core.state.phase.kind !== 'downloading') ||
      !core.sessionId
    )
      return
    const candidate = core.state.files.find((file) => file.candidateId === candidateId)
    if (!candidate || candidate.format === 'unsupported') return
    if (candidate.status === 'excluded' && !core.state.showingAllFiles) return
    const restore = { ...core.state, phase: { kind: 'choosingFile' } as const, notice: undefined }
    const operation = startOperation(
      { kind: 'downloading', progress: { kind: 'indeterminate' } },
      restore
    )
    if (!operation) return
    set({ ...core.state, selectedFile: candidate, archive: undefined, selectedMember: undefined })
    const value = await request(operation, 'files', (sessionId) =>
      getDeps().jimaku.prepareFile(sessionId, candidate.candidateId)
    )
    if (!value) return
    if (value.kind === 'archiveMembers') {
      set({
        ...core.state,
        phase: { kind: 'choosingArchiveMember' },
        archive: copyArchive(value),
        selectedFile: candidate,
        selectedMember: undefined,
        notice: undefined
      })
      return
    }
    await applyPrepared(operation, value, candidate.candidateId)
  }

  const prepareMember = async (memberId: string): Promise<void> => {
    if (
      (core.state.phase.kind !== 'choosingArchiveMember' &&
        core.state.phase.kind !== 'downloading') ||
      !core.sessionId ||
      !core.state.archive
    )
      return
    const member = core.state.archive.members.find((candidate) => candidate.memberId === memberId)
    if (!member || (member.status === 'excluded' && !core.state.showingAllFiles)) return
    const restore = {
      ...core.state,
      phase: { kind: 'choosingArchiveMember' } as const,
      notice: undefined
    }
    const operation = startOperation(
      { kind: 'downloading', progress: { kind: 'indeterminate' } },
      restore
    )
    if (!operation) return
    set({ ...core.state, selectedMember: member, notice: undefined })
    const { packageId } = core.state.archive
    const value = await request(operation, 'files', (sessionId) =>
      getDeps().jimaku.prepareArchiveMember(sessionId, packageId, member.memberId)
    )
    if (!value) return
    const candidateId = core.state.selectedFile?.candidateId ?? 'archive'
    await applyPrepared(operation, value, `${candidateId}:${member.memberId}`)
  }

  return {
    chooseFile: prepareFile,
    chooseMember: prepareMember,
    async revert(): Promise<void> {
      if (
        !core.previousSelection ||
        !core.state.canRevert ||
        (core.state.phase.kind !== 'choosingFile' &&
          core.state.phase.kind !== 'choosingArchiveMember' &&
          !(core.state.phase.kind === 'error' && core.state.phase.recovery === 'files'))
      )
        return
      const current = media()
      if (
        !current.filePath ||
        current.filePath !== core.state.mediaPath ||
        current.loadGeneration !== core.state.mediaGeneration
      )
        return
      const target = cloneSnapshot(core.previousSelection)
      const restore = { ...core.state, phase: { kind: 'choosingFile' } as const, notice: undefined }
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
        restoreCancelState()
        return
      }
      if (applied.status === 'error') {
        if (applied.code === 'notFound') {
          core.previousSelection = undefined
          set({
            ...core.state,
            phase: { kind: 'error', code: applied.code, recovery: 'revert' },
            canRevert: false
          })
        } else fail(applied.code, 'revert')
        return
      }
      const currentVersionId = versionOf(target.selection)
      if (currentVersionId) core.knownVersionIds.add(currentVersionId)
      core.previousSelection = undefined
      core.cancelState = undefined
      set({
        ...core.state,
        phase: { kind: 'choosingFile' },
        currentVersionId,
        triedVersionIds: triedVersions(currentVersionId),
        canRevert: false,
        notice: applied.warning === 'persistence' ? 'loadedButNotSaved' : 'applied'
      })
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
