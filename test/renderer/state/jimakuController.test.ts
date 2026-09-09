import { describe, expect, it, vi } from 'vitest'
import { deferred } from '@test/harness/deferred'
import {
  createJimakuController,
  type JimakuControllerDeps,
  type JimakuSelectionApplyResult,
  type JimakuSubtitleActions
} from '@src/renderer/src/state/jimakuController'
import type {
  JimakuEntry,
  JimakuFileCandidate,
  JimakuPreparedSubtitleResult,
  JimakuServiceResult
} from '@src/shared/jimaku'
import type { KizunaApi } from '@src/shared/preloadApi'
import type { StoredSubtitleSelection } from '@src/shared/mediaHistory'
import type { SubtitleSelectionSnapshot } from '@src/renderer/src/state/trackSelection'

type FakeJimaku = Pick<
  KizunaApi['jimaku'],
  | 'getStatus'
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

type SearchResult = Awaited<ReturnType<FakeJimaku['searchTitles']>>
type PrepareResult = Awaited<ReturnType<FakeJimaku['prepareFile']>>

const mediaPath = '/media/Show - 01.mkv'

function ok<T>(value: T): JimakuServiceResult<T> {
  return { ok: true, value }
}

function failure(
  code: 'cancelled' | 'network' | 'notConfigured' | 'notFound' | 'storage'
): JimakuServiceResult<never> {
  return { ok: false, error: { code } }
}

function entry(id: number, name = 'Show'): JimakuEntry {
  return {
    id,
    name,
    flags: { anime: true, movie: false, external: false, unverified: false, adult: false }
  }
}

function file(
  candidateId: string,
  name: string,
  status: JimakuFileCandidate['status'] = 'eligible'
): JimakuFileCandidate {
  return {
    candidateId,
    entryId: 1,
    sourcePage: { entryId: 1, url: 'https://jimaku.cc/entry/1' },
    name,
    size: 100,
    lastModified: '2026-09-09T00:00:00.000Z',
    format: name.endsWith('.zip') ? 'zip' : 'srt',
    status,
    reasons: status === 'excluded' ? ['Different episode'] : []
  }
}

function prepared(
  contentVersion: string,
  fileName = 'Show - 02.srt',
  entryId = 1
): JimakuPreparedSubtitleResult {
  const provenance = { provider: 'jimaku' as const, entryId, fileName, contentVersion }
  return {
    kind: 'preparedSubtitle',
    handle: `handle-${contentVersion}`,
    contentVersion,
    originalName: fileName,
    format: 'srt',
    provenance,
    selection: {
      mode: 'external',
      path: `/cache/${contentVersion}.srt`,
      encoding: 'auto',
      provenance
    }
  }
}

function archiveResult(): PrepareResult {
  return ok({
    kind: 'archiveMembers',
    packageId: 'package-1',
    entryId: 1,
    sourcePage: { entryId: 1, url: 'https://jimaku.cc/entry/1' },
    sourceFileName: 'Show-pack.zip',
    members: [
      {
        memberId: 'member-1',
        displayName: 'Show - 02.srt',
        format: 'srt',
        size: 100,
        inferredEpisode: 2,
        status: 'eligible',
        reasons: ['Episode 2']
      }
    ]
  })
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

interface Harness {
  api: FakeJimaku
  controller: ReturnType<typeof createJimakuController>
  subtitles: JimakuSubtitleActions
  getCurrent(): SubtitleSelectionSnapshot
  setMedia(path: string | undefined, loadGeneration: number): void
}

function harness(
  initialSelection: StoredSubtitleSelection = { mode: 'track', track: { id: 7 } }
): Harness {
  let currentMedia = { filePath: mediaPath as string | undefined, loadGeneration: 1 }
  let current = { selection: initialSelection, offsetMs: 125 }

  const api: FakeJimaku = {
    getStatus: vi.fn().mockResolvedValue({
      configured: true,
      secretStorageAvailable: true,
      testOutcome: { status: 'connected' }
    }),
    beginSession: vi
      .fn()
      .mockImplementation(async (_path: string, mediaGeneration: number) =>
        ok({ sessionId: 'session-1', mediaGeneration })
      ),
    searchTitles: vi.fn().mockResolvedValue(ok({ entries: [entry(1)], partial: false })),
    listFiles: vi.fn().mockResolvedValue(
      ok({
        entryId: 1,
        sourcePage: { entryId: 1, url: 'https://jimaku.cc/entry/1' },
        files: [file('file-1', 'Show - 01.srt')]
      })
    ),
    prepareFile: vi.fn().mockResolvedValue(failure('network')),
    prepareArchiveMember: vi.fn().mockResolvedValue(failure('network')),
    cancelPending: vi.fn().mockResolvedValue(ok(undefined)),
    endSession: vi.fn().mockResolvedValue(ok(undefined)),
    openSourcePage: vi.fn().mockResolvedValue(ok(undefined)),
    commitPreparedSubtitle: vi
      .fn()
      .mockResolvedValue(ok({ mode: 'external', path: '/cache/saved.srt', encoding: 'auto' }))
  }

  const subtitles: JimakuSubtitleActions = {
    capture: vi.fn(() => cloneSnapshot(current)),
    applyExternal: vi.fn(
      async (selection, offsetMs, isCurrent): Promise<JimakuSelectionApplyResult> => {
        if (!isCurrent()) return { status: 'stale' }
        current = { selection, offsetMs }
        return { status: 'applied' }
      }
    ),
    restore: vi.fn(async (snapshot, isCurrent): Promise<JimakuSelectionApplyResult> => {
      if (!isCurrent()) return { status: 'stale' }
      current = cloneSnapshot(snapshot)
      return { status: 'applied' }
    })
  }

  const deps: JimakuControllerDeps = {
    jimaku: api,
    getMedia: () => currentMedia,
    subtitles,
    getSubtitleOffset: () => 900
  }
  const controller = createJimakuController(deps)

  return {
    api,
    controller,
    subtitles,
    getCurrent: () => cloneSnapshot(current),
    setMedia(path, loadGeneration) {
      currentMedia = { filePath: path, loadGeneration }
      controller.syncMedia()
    }
  }
}

async function settle(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

async function openAndLoadFiles(h: Harness): Promise<void> {
  await h.controller.open()
  await h.controller.search()
  await h.controller.chooseTitle(1)
}

describe('createJimakuController', () => {
  it('opens with parsed hints but does not search or download automatically', async () => {
    const h = harness()

    await h.controller.open()

    expect(h.controller.getState()).toMatchObject({
      phase: { kind: 'choosingTitle' },
      identity: { titleQuery: 'Show', episode: 1 },
      category: 'all'
    })
    expect(h.api.searchTitles).not.toHaveBeenCalled()
    expect(h.api.prepareFile).not.toHaveBeenCalled()
  })

  it('waits for setup and permits reopening after the key is configured', async () => {
    const h = harness()
    vi.mocked(h.api.getStatus).mockResolvedValueOnce({
      configured: false,
      secretStorageAvailable: true,
      testOutcome: { status: 'notTested' }
    })

    await h.controller.open()
    expect(h.controller.getState().phase).toEqual({ kind: 'setupRequired' })
    expect(h.api.beginSession).not.toHaveBeenCalled()

    await h.controller.open()
    expect(h.controller.getState().phase).toEqual({ kind: 'choosingTitle' })
    expect(h.api.beginSession).toHaveBeenCalledOnce()
  })

  it('keeps fuzzy title results unselected while allowing one exact alias', async () => {
    const h = harness()
    vi.mocked(h.api.searchTitles).mockResolvedValue({
      ok: true,
      value: {
        entries: [entry(1, 'Corrected Title'), entry(2, 'Corrected Title Extended')],
        partial: false
      }
    })

    await h.controller.open()
    h.controller.editIdentity({ titleQuery: 'Corrected Title' })
    await h.controller.search()
    expect(h.controller.getState().selectedEntry?.id).toBe(1)
    expect(h.api.prepareFile).not.toHaveBeenCalled()

    vi.mocked(h.api.searchTitles).mockResolvedValue({
      ok: true,
      value: { entries: [entry(3, 'A Different Show')], partial: false }
    })
    h.controller.editIdentity({ titleQuery: 'Different' })
    await h.controller.search()
    expect(h.controller.getState().selectedEntry).toBeUndefined()
  })

  it('reranks complete file results after an episode correction and exposes excluded files explicitly', async () => {
    const h = harness()
    const files = [
      file('file-1', 'Show - 01.srt'),
      file('file-2', 'Show - 02.srt'),
      file('file-3', 'Show - 03.srt'),
      file('file-4', 'Show - 04.srt'),
      file('file-5', 'Show - 05.srt'),
      file('file-6', 'Show - 06.srt'),
      file('file-en', 'Show - 02.en.srt')
    ]
    vi.mocked(h.api.listFiles).mockResolvedValue(
      ok({
        entryId: 1,
        sourcePage: { entryId: 1, url: 'https://jimaku.cc/entry/1' },
        files
      })
    )

    await openAndLoadFiles(h)
    h.controller.editEpisode(2)
    expect(h.controller.getState().shownFiles[0]?.name).toBe('Show - 02.srt')
    expect(h.controller.getState().shownFiles).not.toContainEqual(
      expect.objectContaining({ name: 'Show - 02.en.srt' })
    )

    h.controller.showAllFiles()
    expect(h.controller.getState().shownFiles).toHaveLength(files.length)
    expect(h.controller.getState().shownFiles).toContainEqual(
      expect.objectContaining({ name: 'Show - 02.en.srt', status: 'excluded' })
    )
  })

  it('cancels a pending search and ignores its late result', async () => {
    const h = harness()
    await h.controller.open()
    const pending = deferred<SearchResult>()
    vi.mocked(h.api.searchTitles).mockReturnValueOnce(pending.promise)

    const search = h.controller.search()
    expect(h.controller.getState().phase).toEqual({ kind: 'searchingTitles' })
    h.controller.cancelOperation()
    pending.resolve(ok({ entries: [entry(9, 'Late Result')], partial: false }))
    await search

    expect(h.controller.getState()).toMatchObject({ phase: { kind: 'choosingTitle' }, entries: [] })
  })

  it('closes during a download, cancels it, and ignores the late preparation', async () => {
    const h = harness()
    await openAndLoadFiles(h)
    const pending = deferred<PrepareResult>()
    vi.mocked(h.api.prepareFile).mockReturnValueOnce(pending.promise)

    const work = h.controller.chooseFile('file-1')
    h.controller.close()
    pending.resolve(ok(prepared('late-version')))
    await work

    expect(h.controller.getState().phase).toEqual({ kind: 'idle' })
    expect(h.api.cancelPending).toHaveBeenCalledWith('session-1')
    expect(h.api.endSession).toHaveBeenCalledWith('session-1')
    expect(h.subtitles.applyExternal).not.toHaveBeenCalled()
    expect(h.api.commitPreparedSubtitle).not.toHaveBeenCalled()
  })

  it('ignores an old generation even when media returns to the same path', async () => {
    const h = harness()
    await h.controller.open()
    const pending = deferred<SearchResult>()
    vi.mocked(h.api.searchTitles).mockReturnValueOnce(pending.promise)
    const search = h.controller.search()

    h.setMedia('/media/Other - 01.mkv', 2)
    h.setMedia(mediaPath, 3)
    await h.controller.open()
    pending.resolve(ok({ entries: [entry(9, 'Old Result')], partial: false }))
    await search
    await settle()

    expect(h.controller.getState()).toMatchObject({
      phase: { kind: 'choosingTitle' },
      mediaPath,
      mediaGeneration: 3,
      entries: []
    })
  })

  it('uses only the winning preparation when preparations resolve in reverse order', async () => {
    const h = harness()
    vi.mocked(h.api.listFiles).mockResolvedValue(
      ok({
        entryId: 1,
        sourcePage: { entryId: 1, url: 'https://jimaku.cc/entry/1' },
        files: [file('file-1', 'Show - 01.srt'), file('file-2', 'Show - 01-alt.srt')]
      })
    )
    await openAndLoadFiles(h)
    const first = deferred<PrepareResult>()
    const second = deferred<PrepareResult>()
    vi.mocked(h.api.prepareFile)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise)

    const firstWork = h.controller.chooseFile('file-1')
    const secondWork = h.controller.chooseFile('file-2')
    second.resolve(ok(prepared('version-b', 'Show - 02.srt')))
    first.resolve(ok(prepared('version-a', 'Show - 01.srt')))
    await Promise.all([firstWork, secondWork])

    expect(h.controller.getState()).toMatchObject({
      currentVersionId: 'version-b',
      notice: 'applied'
    })
    expect(vi.mocked(h.subtitles.applyExternal)).toHaveBeenCalledOnce()
    expect(vi.mocked(h.subtitles.applyExternal).mock.calls[0]?.[0].provenance?.contentVersion).toBe(
      'version-b'
    )
  })

  it('does not record or commit a failed replacement', async () => {
    const h = harness()
    await openAndLoadFiles(h)
    vi.mocked(h.api.prepareFile).mockResolvedValueOnce(ok(prepared('version-b')))
    vi.mocked(h.subtitles.applyExternal).mockResolvedValueOnce({
      status: 'error',
      code: 'selection'
    })

    await h.controller.chooseFile('file-1')

    expect(h.controller.getState()).toMatchObject({
      phase: { kind: 'error', code: 'selection' },
      currentVersionId: undefined,
      triedVersionIds: [],
      canRevert: false
    })
    expect(h.api.commitPreparedSubtitle).not.toHaveBeenCalled()
    expect(h.getCurrent().selection.mode).toBe('track')
  })

  it('reports persistence failure separately after the subtitle has loaded', async () => {
    const h = harness()
    await openAndLoadFiles(h)
    vi.mocked(h.api.prepareFile).mockResolvedValueOnce(ok(prepared('version-b')))
    vi.mocked(h.api.commitPreparedSubtitle).mockResolvedValueOnce(failure('storage'))

    await h.controller.chooseFile('file-1')

    expect(h.controller.getState()).toMatchObject({
      phase: { kind: 'choosingFile' },
      currentVersionId: 'version-b',
      notice: 'loadedButNotSaved',
      canRevert: true
    })
    expect(vi.mocked(h.subtitles.applyExternal).mock.calls[0]?.[1]).toBe(900)
  })

  it('recognizes a duplicate checksum without reloading or creating a revert', async () => {
    const h = harness({
      mode: 'external',
      path: '/cache/version-b.srt',
      encoding: 'shift_jis',
      provenance: {
        provider: 'jimaku',
        entryId: 1,
        fileName: 'old.srt',
        contentVersion: 'version-b'
      }
    })
    await openAndLoadFiles(h)
    vi.mocked(h.api.prepareFile).mockResolvedValueOnce(ok(prepared('version-b')))

    await h.controller.chooseFile('file-1')

    expect(h.controller.getState()).toMatchObject({
      phase: { kind: 'choosingFile' },
      notice: 'sameContent'
    })
    expect(h.controller.getState().canRevert).toBe(false)
    expect(h.subtitles.applyExternal).not.toHaveBeenCalled()
    expect(h.api.commitPreparedSubtitle).not.toHaveBeenCalled()
    expect(h.getCurrent().selection).toMatchObject({ mode: 'external', encoding: 'shift_jis' })
  })

  it('offers archive members before applying the selected member', async () => {
    const h = harness()
    await openAndLoadFiles(h)
    vi.mocked(h.api.listFiles).mockResolvedValue(
      ok({
        entryId: 1,
        sourcePage: { entryId: 1, url: 'https://jimaku.cc/entry/1' },
        files: [file('zip-1', 'Show-pack.zip')]
      })
    )
    await h.controller.refresh()
    vi.mocked(h.api.prepareFile).mockResolvedValueOnce(archiveResult())
    vi.mocked(h.api.prepareArchiveMember).mockResolvedValueOnce(
      ok(prepared('version-member', 'Show - 02.srt'))
    )

    await h.controller.chooseFile('zip-1')
    expect(h.controller.getState()).toMatchObject({
      phase: { kind: 'choosingArchiveMember' },
      archive: { packageId: 'package-1' }
    })
    await h.controller.chooseMember('member-1')

    expect(h.api.prepareArchiveMember).toHaveBeenCalledWith('session-1', 'package-1', 'member-1')
    expect(h.controller.getState()).toMatchObject({
      currentVersionId: 'version-member',
      notice: 'applied'
    })
  })

  it.each([
    { name: 'off', selection: { mode: 'off' } as StoredSubtitleSelection },
    {
      name: 'embedded track',
      selection: { mode: 'track', track: { id: 3, language: 'jpn' } } as StoredSubtitleSelection
    },
    {
      name: 'local external file',
      selection: {
        mode: 'external',
        path: '/subs/local.srt',
        encoding: 'shift_jis'
      } as StoredSubtitleSelection
    },
    {
      name: 'Jimaku external file',
      selection: {
        mode: 'external',
        path: '/cache/old.srt',
        encoding: 'auto',
        provenance: { provider: 'jimaku', entryId: 1, fileName: 'old.srt', contentVersion: 'old' }
      } as StoredSubtitleSelection
    }
  ])('reverts one successful switch back to the previous %s selection', async ({ selection }) => {
    const h = harness(selection)
    await openAndLoadFiles(h)
    vi.mocked(h.api.prepareFile).mockResolvedValueOnce(ok(prepared('new-version')))
    await h.controller.chooseFile('file-1')
    await h.controller.revert()

    expect(h.subtitles.restore).toHaveBeenCalledOnce()
    expect(vi.mocked(h.subtitles.restore).mock.calls[0]?.[0].selection).toEqual(selection)
    expect(h.getCurrent().selection).toEqual(selection)
    expect(h.controller.getState().canRevert).toBe(false)
  })

  it('leaves the active replacement in place when the previous file is missing', async () => {
    const h = harness()
    await openAndLoadFiles(h)
    vi.mocked(h.api.prepareFile).mockResolvedValueOnce(ok(prepared('new-version')))
    vi.mocked(h.subtitles.restore).mockResolvedValueOnce({ status: 'error', code: 'notFound' })
    await h.controller.chooseFile('file-1')
    await h.controller.revert()

    expect(h.controller.getState()).toMatchObject({
      phase: { kind: 'error', code: 'notFound', recovery: 'revert' },
      canRevert: false
    })
    expect(h.getCurrent().selection).toMatchObject({ mode: 'external' })
  })

  it('reopens retained results with tryAnother without HTTP', async () => {
    const h = harness()
    await openAndLoadFiles(h)
    vi.mocked(h.api.prepareFile).mockResolvedValueOnce(ok(prepared('new-version')))
    await h.controller.chooseFile('file-1')
    const calls = {
      search: vi.mocked(h.api.searchTitles).mock.calls.length,
      list: vi.mocked(h.api.listFiles).mock.calls.length
    }

    h.controller.tryAnother()

    expect(h.controller.getState().phase).toEqual({ kind: 'choosingFile' })
    expect(vi.mocked(h.api.searchTitles).mock.calls.length).toBe(calls.search)
    expect(vi.mocked(h.api.listFiles).mock.calls.length).toBe(calls.list)
    expect(h.controller.getState().currentVersionId).toBe('new-version')
  })
})
