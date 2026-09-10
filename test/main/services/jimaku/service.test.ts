import { describe, expect, it, vi } from 'vitest'
import type { JimakuArchiveService } from '@src/main/services/jimaku/archive'
import type { JimakuClient, JimakuFileRecord } from '@src/main/services/jimaku/client'
import { createJimakuService } from '@src/main/services/jimaku/service'
import type {
  JimakuDownloadStore,
  JimakuPreparedSubtitle
} from '@src/main/services/jimaku/downloadStore'
import type { JimakuEntry, JimakuResult, JimakuTitleSearchRequest } from '@src/shared/jimaku'
import type { ShowJimakuSaveDialog } from '@src/main/services/jimaku/export'
import type { MediaPlaybackHistory } from '@src/shared/mediaHistory'
import { deferred } from '@test/harness/deferred'

const ENTRY_ANIME: JimakuEntry = {
  id: 10,
  name: 'Anime title',
  flags: { anime: true, movie: false, external: false, unverified: false, adult: false }
}
const SHARED_ENTRY: JimakuEntry = {
  id: 30,
  name: 'Shared title',
  flags: { anime: true, movie: false, external: false, unverified: false, adult: false }
}

const SRT_FILE: JimakuFileRecord = {
  name: '[Group] Anime title - 01.srt',
  size: 100,
  lastModified: 'revision-1',
  url: 'https://jimaku.cc/entry/10/download/subtitle.srt'
}
const ZIP_FILE: JimakuFileRecord = {
  name: 'Anime title pack.zip',
  size: 200,
  lastModified: 'revision-2',
  url: 'https://jimaku.cc/entry/10/download/pack.zip'
}

function prepared(
  file: JimakuFileRecord,
  format: 'srt' | 'ass' | 'ssa' = 'srt'
): JimakuPreparedSubtitle {
  return {
    handle: `store-${file.name}`,
    contentVersion: 'a'.repeat(64),
    originalName: file.name,
    format,
    managedPath: `/cache/${file.name}`,
    size: file.size,
    provenance: {
      entryId: 10,
      remoteFilename: file.name,
      remoteRevision: file.lastModified
    }
  }
}

function makeHarness() {
  let configGeneration = 0
  const configListeners = new Set<(generation: number) => void>()
  const settings = {
    getConfigGeneration: vi.fn(() => configGeneration),
    getFolderHint: vi.fn(),
    onConfigChange: vi.fn((listener: (generation: number) => void) => {
      configListeners.add(listener)
      return () => configListeners.delete(listener)
    })
  }
  const client = {
    searchEntries: vi.fn(
      async (_request: {
        query: string
        anime: boolean
      }): Promise<JimakuResult<JimakuEntry[]>> => ({
        ok: true,
        value: []
      })
    ),
    getEntry: vi.fn(async (id: number) => ({
      ok: true as const,
      value: { ...ENTRY_ANIME, id }
    })),
    listFiles: vi.fn(async () => ({ ok: true as const, value: [] as JimakuFileRecord[] }))
  } satisfies Pick<JimakuClient, 'searchEntries' | 'getEntry' | 'listFiles'>
  const downloads = {
    prepareDirect: vi.fn(async (_entryId: number, file: JimakuFileRecord) => ({
      ok: true as const,
      value: prepared(file)
    })),
    releasePrepared: vi.fn()
  } satisfies Pick<JimakuDownloadStore, 'prepareDirect' | 'releasePrepared'>
  const archive = {
    inspect: vi.fn(async () => ({
      ok: true as const,
      value: {
        packageHandle: 'archive-store-package',
        entryId: ENTRY_ANIME.id,
        sourceFileName: ZIP_FILE.name,
        members: [
          {
            memberId: 'member-1',
            displayName: 'Anime title - 01.srt',
            format: 'srt' as const,
            size: 50,
            status: 'eligible' as const,
            reasons: ['Same episode']
          }
        ]
      }
    })),
    prepareMember: vi.fn(async () => ({
      ok: true as const,
      value: prepared({ ...SRT_FILE, name: 'Anime title - 01.srt' })
    })),
    releasePackage: vi.fn()
  } satisfies Pick<JimakuArchiveService, 'inspect' | 'prepareMember' | 'releasePackage'>
  const history = {
    applyPreparedSubtitle: vi.fn((_path: string, value: JimakuPreparedSubtitle) => ({
      mode: 'external' as const,
      path: value.managedPath,
      encoding: 'auto' as const,
      provenance: {
        provider: 'jimaku' as const,
        entryId: value.provenance.entryId,
        fileName: value.originalName,
        contentVersion: value.contentVersion
      }
    }))
  }
  const opened: string[] = []
  const service = createJimakuService({
    client,
    settings,
    downloads,
    archive,
    mediaHistory: history,
    openExternal: async (url) => {
      opened.push(url)
    },
    makeId: (kind, counter) => `${kind}-${counter}`
  })

  return {
    service,
    settings,
    client,
    downloads,
    archive,
    history,
    opened,
    changeConfig(generation: number) {
      configGeneration = generation
      for (const listener of configListeners) listener(generation)
    }
  }
}

function allEntriesRequest(): JimakuTitleSearchRequest {
  return { query: 'Anime title', category: 'all' }
}

describe('createJimakuService', () => {
  it('exports only the active cached provenance', async () => {
    const bytes = new Uint8Array([0, 255, 10])
    const provenance = {
      provider: 'jimaku' as const,
      entryId: 10,
      fileName: 'Anime title - 01.ass',
      contentVersion: 'a'.repeat(64)
    }
    const downloads = {
      prepareDirect: vi.fn(),
      releasePrepared: vi.fn(),
      readManagedSubtitle: vi.fn(async () => ({
        path: `/cache/${provenance.contentVersion}.ass`,
        bytes,
        format: 'ass' as const
      }))
    }
    const getPlaybackHistory = vi.fn((): MediaPlaybackHistory => ({
      positionSeconds: 0,
      updatedAt: 0,
      subtitle: {
        mode: 'external' as const,
        path: '/cache/file.ass',
        encoding: 'auto' as const,
        provenance
      }
    }))
    const history = {
      applyPreparedSubtitle: vi.fn(),
      getPlaybackHistory,
      isCurrentMedia: vi.fn(() => true)
    }
    const showSaveDialog: ShowJimakuSaveDialog = vi.fn(async (options) => ({
      canceled: false,
      filePath: options.defaultPath ?? ''
    }))
    const fs = {
      stat: vi.fn(async () => {
        throw Object.assign(new Error('missing'), { code: 'ENOENT' })
      }),
      writeFile: vi.fn(async () => undefined)
    }
    const service = createJimakuService({
      client: {
        searchEntries: vi.fn(),
        getEntry: vi.fn(),
        listFiles: vi.fn()
      },
      settings: {
        getConfigGeneration: vi.fn(() => 0),
        getFolderHint: vi.fn(),
        onConfigChange: vi.fn(() => () => undefined)
      },
      downloads,
      archive: {
        inspect: vi.fn(),
        prepareMember: vi.fn(),
        releasePackage: vi.fn()
      },
      mediaHistory: history,
      subtitleExport: { showSaveDialog, fs, platform: 'linux' },
      openExternal: vi.fn()
    })

    await expect(
      service.exportActiveSubtitle('window-a', {
        mediaPath: '/media/Anime title - 01.mkv',
        mediaGeneration: 1,
        provenance
      })
    ).resolves.toEqual({ status: 'exported', path: '/media/Anime title - 01.ja.ass' })
    expect(downloads.readManagedSubtitle).toHaveBeenCalledWith(provenance)
    expect(fs.writeFile).toHaveBeenCalledWith('/media/Anime title - 01.ja.ass', bytes, {
      flag: 'wx'
    })

    history.getPlaybackHistory.mockReturnValue({ positionSeconds: 0, updatedAt: 0 })
    await expect(
      service.exportActiveSubtitle('window-a', {
        mediaPath: '/media/Anime title - 01.mkv',
        mediaGeneration: 1,
        provenance
      })
    ).resolves.toEqual({ status: 'error', code: 'notAvailable' })
  })

  it('merges both title categories, marks partial results, and caches selected files', async () => {
    const harness = makeHarness()
    harness.client.searchEntries.mockImplementation(async ({ anime }) =>
      anime
        ? { ok: true as const, value: [ENTRY_ANIME, SHARED_ENTRY] }
        : { ok: false as const, error: { code: 'serviceUnavailable' as const } }
    )
    harness.client.listFiles.mockResolvedValue({ ok: true, value: [SRT_FILE, ZIP_FILE] })

    const started = harness.service.beginSession('window-a', '/media/Anime title - 01.mkv', 1)
    expect(started.ok).toBe(true)
    if (!started.ok) return

    const search = await harness.service.searchTitles(
      'window-a',
      started.value.sessionId,
      allEntriesRequest()
    )
    expect(search).toEqual({
      ok: true,
      value: {
        entries: [ENTRY_ANIME, SHARED_ENTRY],
        partial: true,
        failedCategories: ['liveAction']
      }
    })
    expect(harness.client.searchEntries).toHaveBeenCalledTimes(2)

    const entrySearch = await harness.service.searchTitles(
      'window-a',
      started.value.sessionId,
      allEntriesRequest()
    )
    expect(entrySearch.ok).toBe(true)
    expect(harness.client.searchEntries).toHaveBeenCalledTimes(2)

    const files = await harness.service.listFiles(
      'window-a',
      started.value.sessionId,
      ENTRY_ANIME.id
    )
    expect(files.ok).toBe(true)
    if (!files.ok) return
    expect(files.value.sourcePage).toEqual({
      entryId: ENTRY_ANIME.id,
      url: 'https://jimaku.cc/entry/10'
    })
    expect(files.value.files).toHaveLength(2)
    expect(files.value.files[0]?.candidateId).not.toContain(SRT_FILE.name)
    expect(harness.downloads.prepareDirect).not.toHaveBeenCalled()

    await harness.service.listFiles('window-a', started.value.sessionId, ENTRY_ANIME.id)
    expect(harness.client.listFiles).toHaveBeenCalledOnce()
    await harness.service.listFiles('window-a', started.value.sessionId, ENTRY_ANIME.id, true)
    expect(harness.client.listFiles).toHaveBeenCalledTimes(2)
  })

  it('resolves a remembered folder title before listing its files', async () => {
    const harness = makeHarness()
    harness.settings.getFolderHint.mockReturnValue({
      entryId: ENTRY_ANIME.id,
      name: ENTRY_ANIME.name,
      category: 'anime',
      updatedAt: 1
    })
    harness.client.getEntry.mockResolvedValue({ ok: true, value: ENTRY_ANIME })
    harness.client.listFiles.mockResolvedValue({ ok: true, value: [SRT_FILE] })

    const started = harness.service.beginSession('window-a', '/media/Anime title - 02.mkv', 1)
    expect(started.ok).toBe(true)
    if (!started.ok) throw new Error('Expected the Jimaku session to start.')

    const listed = await harness.service.listFiles(
      'window-a',
      started.value.sessionId,
      ENTRY_ANIME.id
    )

    expect(listed).toMatchObject({ ok: true, value: { entryId: ENTRY_ANIME.id } })
    expect(harness.client.getEntry).toHaveBeenCalledWith(ENTRY_ANIME.id, expect.any(AbortSignal))
    expect(harness.client.listFiles).toHaveBeenCalledWith(ENTRY_ANIME.id, expect.any(AbortSignal))
  })

  it('allows the dialog to reopen for the same media generation', () => {
    const harness = makeHarness()
    const first = harness.service.beginSession('window-a', '/media/a.mkv', 1)
    expect(first.ok).toBe(true)
    if (!first.ok) throw new Error('Expected the first Jimaku session to start.')
    expect(harness.service.endSession('window-a', first.value.sessionId)).toEqual({
      ok: true,
      value: undefined
    })

    expect(harness.service.beginSession('window-a', '/media/a.mkv', 1)).toMatchObject({
      ok: true,
      value: { mediaGeneration: 1 }
    })
  })

  it('prepares direct and archive files only from session-owned candidates', async () => {
    const harness = makeHarness()
    harness.client.searchEntries.mockResolvedValue({ ok: true, value: [ENTRY_ANIME] })
    harness.client.listFiles.mockResolvedValue({ ok: true, value: [SRT_FILE, ZIP_FILE] })
    const started = harness.service.beginSession('window-a', '/media/Anime title - 01.mkv', 1)
    if (!started.ok) return
    await harness.service.searchTitles('window-a', started.value.sessionId, {
      query: 'Anime title',
      category: 'anime'
    })
    const listed = await harness.service.listFiles(
      'window-a',
      started.value.sessionId,
      ENTRY_ANIME.id
    )
    if (!listed.ok) return
    const direct = listed.value.files.find((file) => file.format === 'srt')
    const archive = listed.value.files.find((file) => file.format === 'zip')
    expect(direct).toBeDefined()
    expect(archive).toBeDefined()
    if (!direct || !archive) return

    const preparedDirect = await harness.service.prepareFile(
      'window-a',
      started.value.sessionId,
      direct.candidateId
    )
    expect(preparedDirect).toMatchObject({
      ok: true,
      value: {
        kind: 'preparedSubtitle',
        originalName: SRT_FILE.name,
        selection: {
          mode: 'external',
          path: `/cache/${SRT_FILE.name}`
        }
      }
    })
    if (!preparedDirect.ok || preparedDirect.value.kind !== 'preparedSubtitle') return
    const committed = harness.service.commitPreparedSubtitle(
      'window-a',
      started.value.sessionId,
      preparedDirect.value.handle
    )
    expect(committed.ok).toBe(true)
    expect(harness.history.applyPreparedSubtitle).toHaveBeenCalledWith(
      '/media/Anime title - 01.mkv',
      expect.objectContaining({ contentVersion: 'a'.repeat(64) }),
      'auto'
    )

    const preparedArchive = await harness.service.prepareFile(
      'window-a',
      started.value.sessionId,
      archive.candidateId
    )
    expect(preparedArchive).toMatchObject({ ok: true, value: { kind: 'archiveMembers' } })
    if (!preparedArchive.ok || preparedArchive.value.kind !== 'archiveMembers') return
    const member = preparedArchive.value.members[0]
    expect(member).toBeDefined()
    if (!member) return
    const extracted = await harness.service.prepareArchiveMember(
      'window-a',
      started.value.sessionId,
      preparedArchive.value.packageId,
      member.memberId
    )
    expect(extracted).toMatchObject({ ok: true, value: { kind: 'preparedSubtitle' } })
    await expect(
      harness.service.prepareArchiveMember(
        'window-a',
        started.value.sessionId,
        preparedArchive.value.packageId,
        'foreign-member'
      )
    ).resolves.toEqual({ ok: false, error: { code: 'invalidMember' } })
    expect(harness.archive.prepareMember).toHaveBeenCalledOnce()
  })

  it('drops canceled and superseded completions and isolates senders and media generations', async () => {
    const harness = makeHarness()
    const pending = deferred<JimakuResult<JimakuEntry[]>>()
    harness.client.searchEntries.mockImplementation(() => pending.promise)
    const first = harness.service.beginSession('window-a', '/media/a.mkv', 1)
    if (!first.ok) return
    const inFlight = harness.service.searchTitles('window-a', first.value.sessionId, {
      query: 'A',
      category: 'anime'
    })
    expect(harness.service.cancelPending('window-a', first.value.sessionId)).toEqual({
      ok: true,
      value: undefined
    })
    pending.resolve({ ok: true, value: [ENTRY_ANIME] })
    await expect(inFlight).resolves.toEqual({ ok: false, error: { code: 'cancelled' } })

    const second = harness.service.beginSession('window-a', '/media/b.mkv', 2)
    expect(second.ok).toBe(true)
    if (!second.ok) return
    await expect(
      harness.service.searchTitles('window-a', first.value.sessionId, {
        query: 'old',
        category: 'anime'
      })
    ).resolves.toEqual({ ok: false, error: { code: 'invalidSession' } })
    expect(harness.service.beginSession('window-a', '/media/a.mkv', 1)).toEqual({
      ok: false,
      error: { code: 'staleMedia' }
    })
    await expect(
      harness.service.searchTitles('window-b', second.value.sessionId, {
        query: 'foreign',
        category: 'anime'
      })
    ).resolves.toEqual({ ok: false, error: { code: 'invalidSession' } })
  })

  it('keeps established results reusable when a pending request is canceled', async () => {
    const harness = makeHarness()
    harness.client.searchEntries.mockResolvedValue({ ok: true, value: [ENTRY_ANIME] })
    harness.client.listFiles.mockResolvedValue({ ok: true, value: [SRT_FILE] })
    const started = harness.service.beginSession('window-a', '/media/a.mkv', 1)
    if (!started.ok) return

    await harness.service.searchTitles('window-a', started.value.sessionId, {
      query: 'A',
      category: 'anime'
    })
    const listed = await harness.service.listFiles(
      'window-a',
      started.value.sessionId,
      ENTRY_ANIME.id
    )
    if (!listed.ok) return
    const candidate = listed.value.files[0]
    if (!candidate) return

    const pending = deferred<JimakuResult<JimakuEntry[]>>()
    harness.client.searchEntries.mockImplementationOnce(() => pending.promise)
    const inFlight = harness.service.searchTitles('window-a', started.value.sessionId, {
      query: 'new query',
      category: 'anime'
    })
    expect(harness.service.cancelPending('window-a', started.value.sessionId)).toEqual({
      ok: true,
      value: undefined
    })
    pending.resolve({ ok: true, value: [] })

    await expect(inFlight).resolves.toEqual({ ok: false, error: { code: 'cancelled' } })
    await expect(
      harness.service.prepareFile('window-a', started.value.sessionId, candidate.candidateId)
    ).resolves.toMatchObject({ ok: true, value: { kind: 'preparedSubtitle' } })
  })

  it('invalidates pending work and prior results when credentials change', async () => {
    const harness = makeHarness()
    const pending = deferred<JimakuResult<JimakuEntry[]>>()
    harness.client.searchEntries.mockImplementation(() => pending.promise)
    const started = harness.service.beginSession('window-a', '/media/a.mkv', 1)
    if (!started.ok) return
    const inFlight = harness.service.searchTitles('window-a', started.value.sessionId, {
      query: 'A',
      category: 'anime'
    })
    harness.changeConfig(1)
    pending.resolve({ ok: true, value: [ENTRY_ANIME] })
    await expect(inFlight).resolves.toEqual({ ok: false, error: { code: 'cancelled' } })
    await expect(
      harness.service.listFiles('window-a', started.value.sessionId, ENTRY_ANIME.id)
    ).resolves.toEqual({ ok: false, error: { code: 'invalidEntry' } })
  })

  it('opens only a validated source page and releases sender resources', async () => {
    const harness = makeHarness()
    harness.client.searchEntries.mockResolvedValue({ ok: true, value: [ENTRY_ANIME] })
    const started = harness.service.beginSession('window-a', '/media/a.mkv', 1)
    if (!started.ok) return
    await harness.service.searchTitles('window-a', started.value.sessionId, {
      query: 'A',
      category: 'anime'
    })
    await expect(
      harness.service.openSourcePage('window-a', started.value.sessionId, ENTRY_ANIME.id)
    ).resolves.toEqual({ ok: true, value: undefined })
    expect(harness.opened).toEqual(['https://jimaku.cc/entry/10'])
    await expect(
      harness.service.openSourcePage('window-a', started.value.sessionId, 999)
    ).resolves.toEqual({ ok: false, error: { code: 'invalidEntry' } })
    harness.service.disposeSender('window-a')
    expect(harness.service.endSession('window-a', started.value.sessionId)).toEqual({
      ok: false,
      error: { code: 'invalidSession' }
    })
  })
})
