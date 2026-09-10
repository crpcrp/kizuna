// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '@src/renderer/src/App'
import type {
  JimakuArchiveMembersResult,
  JimakuEntry,
  JimakuFileCandidate,
  JimakuPreparedSubtitleResult,
  JimakuSettingsStatus
} from '@src/shared/jimaku'
import type { MediaPlaybackHistory } from '@src/shared/mediaHistory'
import type { Track } from '@src/shared/track'
import { installFakeKizunaApi } from '../harness/fakeKizunaApi'
import { EPISODE, appTeardown, openRecent } from '../harness/appIntegration'
import { deferred } from '../harness/deferred'

const SUB_EN: Track = { id: 4, kind: 'subtitle', codec: 'srt', title: 'Signs', language: 'eng' }

const configured: JimakuSettingsStatus = {
  configured: true,
  secretStorageAvailable: true,
  testOutcome: { status: 'notTested' }
}

const OTHER_EPISODE = 'C:\\Media\\Episode06.mkv'

function version(letter: string): string {
  return letter.repeat(64)
}

function openSubtitleMenu(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Subtitle' }))
}

function openFindCommand(): void {
  openSubtitleMenu()
  fireEvent.click(screen.getByRole('menuitem', { name: 'Find Japanese subtitles' }))
}

async function openConfiguredSearch(
  api: ReturnType<typeof installFakeKizunaApi>,
  path = EPISODE
): Promise<void> {
  await openRecent(api.player.load, path)
  openFindCommand()
  await waitFor(() =>
    expect(api.jimaku.beginSession).toHaveBeenCalledWith(path, expect.any(Number))
  )
}

function preparedSubtitle(letter = 'a'): JimakuPreparedSubtitleResult {
  const contentVersion = version(letter)
  return {
    kind: 'preparedSubtitle',
    handle: 'prepared-1',
    contentVersion,
    originalName: 'Episode05.srt',
    format: 'srt',
    provenance: {
      entryId: 7,
      provider: 'jimaku',
      fileName: 'Episode05.srt',
      contentVersion
    },
    selection: {
      mode: 'external',
      path: `/cache/${contentVersion}.srt`,
      encoding: 'auto',
      provenance: {
        provider: 'jimaku',
        entryId: 7,
        fileName: 'Episode05.srt',
        contentVersion
      }
    }
  }
}

function file(
  entryId: number,
  candidateId: string,
  name: string,
  format: JimakuFileCandidate['format'] = 'srt',
  status: JimakuFileCandidate['status'] = 'eligible'
): JimakuFileCandidate {
  return {
    candidateId,
    entryId,
    sourcePage: { entryId, url: `https://jimaku.cc/entry/${entryId}` },
    name,
    size: 10,
    lastModified: 'revision-1',
    format,
    status,
    reasons: status === 'excluded' ? ['Different episode'] : []
  }
}

function archiveMembers(entryId: number): JimakuArchiveMembersResult {
  return {
    kind: 'archiveMembers',
    packageId: 'package-1',
    entryId,
    sourcePage: { entryId, url: `https://jimaku.cc/entry/${entryId}` },
    sourceFileName: 'Episode-pack.zip',
    members: [
      {
        memberId: 'member-1',
        displayName: 'Episode05.srt',
        format: 'srt',
        size: 10,
        inferredEpisode: 5,
        status: 'eligible',
        reasons: []
      },
      {
        memberId: 'member-2',
        displayName: 'Episode-special.srt',
        format: 'srt',
        size: 10,
        status: 'eligible',
        reasons: []
      }
    ]
  }
}

afterEach(appTeardown)

describe('Jimaku player composition', () => {
  it('always exposes a disabled search command without a video', () => {
    const api = installFakeKizunaApi()
    render(<App />)

    openSubtitleMenu()

    const command = screen.getByRole('menuitem', { name: 'Find Japanese subtitles' })
    expect((command as HTMLButtonElement).disabled).toBe(true)
    expect(command.getAttribute('title')).toBe('Open a video first.')
    expect(api.jimaku.getStatus).not.toHaveBeenCalled()
  })

  it('shows the no-Japanese prompt once after subtitle restoration settles', async () => {
    const api = installFakeKizunaApi({
      media: {
        enumerateTracks: vi.fn(async () => [SUB_EN]),
        loadSubtitle: vi.fn(async () => [{ start: 0, end: 1, text: 'Hello' }])
      },
      mediaHistory: {
        getRecentFiles: vi.fn(async () => [{ path: EPISODE, openedAt: 1 }])
      }
    })
    render(<App />)

    await openRecent(api.player.load)
    await waitFor(() => expect(screen.getByText('No Japanese subtitles detected')).toBeTruthy())
    expect(api.jimaku.getStatus).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss Japanese subtitle prompt' }))
    expect(screen.queryByText('No Japanese subtitles detected')).toBeNull()

    await openRecent(api.player.load)
    await waitFor(() => expect(screen.getByText('No Japanese subtitles detected')).toBeTruthy())
  })

  it('opens setup from Find and returns to the Subtitles options section', async () => {
    const api = installFakeKizunaApi({
      media: {
        enumerateTracks: vi.fn(async () => [SUB_EN]),
        loadSubtitle: vi.fn(async () => [{ start: 0, end: 1, text: 'Hello' }])
      },
      mediaHistory: {
        getRecentFiles: vi.fn(async () => [{ path: EPISODE, openedAt: 1 }])
      }
    })
    render(<App />)
    await openRecent(api.player.load)
    await waitFor(() => expect(screen.getByText('No Japanese subtitles detected')).toBeTruthy())

    fireEvent.click(screen.getByRole('button', { name: 'Find Japanese subtitles…' }))
    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: 'Find Japanese subtitles' })).toBeTruthy()
    )
    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Find Japanese subtitles' })).getByRole('button', {
        name: 'Settings'
      })
    )

    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Options' })).toBeTruthy())
    expect(screen.getByRole('tab', { name: 'Subtitles' }).getAttribute('aria-selected')).toBe(
      'true'
    )
  })

  it('saves and tests the key before the first explicit search', async () => {
    const entry: JimakuEntry = {
      id: 7,
      name: 'Episode',
      flags: { anime: true, movie: false, external: false, unverified: false, adult: false }
    }
    let hasKey = false
    let testOutcome: JimakuSettingsStatus['testOutcome'] = { status: 'notTested' }
    const api = installFakeKizunaApi({
      media: {
        enumerateTracks: vi.fn(async () => [SUB_EN]),
        loadSubtitle: vi.fn(async () => [{ start: 0, end: 1, text: 'Hello' }])
      },
      mediaHistory: {
        getRecentFiles: vi.fn(async () => [{ path: EPISODE, openedAt: 1 }])
      },
      jimaku: {
        getStatus: vi.fn(async () => ({ ...configured, configured: hasKey, testOutcome })),
        setApiKey: vi.fn(async () => {
          hasKey = true
          testOutcome = { status: 'notTested' }
          return { ...configured, testOutcome }
        }),
        testConnection: vi.fn(async () => {
          testOutcome = { status: 'connected' }
          return { ...configured, testOutcome }
        }),
        beginSession: vi.fn(async (_path, mediaGeneration) => ({
          ok: true as const,
          value: { sessionId: 'session-1', mediaGeneration }
        })),
        searchTitles: vi.fn(async () => ({
          ok: true as const,
          value: { entries: [entry], partial: false }
        }))
      }
    })
    render(<App />)

    await openRecent(api.player.load)
    openFindCommand()
    await waitFor(() =>
      expect(screen.getByText('Jimaku setup is required before searching subtitles.'))
    )
    expect(api.jimaku.beginSession).not.toHaveBeenCalled()

    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Find Japanese subtitles' })).getByRole('button', {
        name: 'Settings'
      })
    )
    const options = await screen.findByRole('dialog', { name: 'Options' })
    fireEvent.change(within(options).getByLabelText('Paste API key'), {
      target: { value: 'test-key' }
    })
    fireEvent.click(within(options).getByRole('button', { name: 'Save key' }))
    await waitFor(() => expect(api.jimaku.setApiKey).toHaveBeenCalledWith('test-key'))

    fireEvent.click(within(options).getByRole('button', { name: 'Test connection' }))
    await waitFor(() => expect(api.jimaku.testConnection).toHaveBeenCalledOnce())
    expect(within(options).getByRole('status').textContent).toContain(
      'read-only API check succeeded'
    )

    fireEvent.click(within(options).getByRole('button', { name: 'Close options' }))
    openFindCommand()
    await waitFor(() => expect(api.jimaku.beginSession).toHaveBeenCalledWith(EPISODE, 1))
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    await waitFor(() => expect(api.jimaku.searchTitles).toHaveBeenCalled())
  })

  it('supports corrected title and episode searches with partial results and Show all', async () => {
    const entry: JimakuEntry = {
      id: 7,
      name: 'Live title',
      flags: { anime: false, movie: false, external: false, unverified: false, adult: false }
    }
    const recommended = file(7, 'recommended', 'Live title - 07.srt')
    const excluded = file(7, 'excluded', 'Live title - 99.srt', 'srt', 'excluded')
    const api = installFakeKizunaApi({
      media: {
        enumerateTracks: vi.fn(async () => [SUB_EN]),
        loadSubtitle: vi.fn(async () => [{ start: 0, end: 1, text: 'Hello' }])
      },
      mediaHistory: {
        getRecentFiles: vi.fn(async () => [{ path: EPISODE, openedAt: 1 }])
      },
      jimaku: {
        getStatus: vi.fn(async () => configured),
        beginSession: vi.fn(async (_path, mediaGeneration) => ({
          ok: true as const,
          value: { sessionId: 'session-1', mediaGeneration }
        })),
        searchTitles: vi.fn(async () => ({
          ok: true as const,
          value: { entries: [entry], partial: true, failedCategories: ['anime'] as const }
        })),
        listFiles: vi.fn(async () => ({
          ok: true as const,
          value: {
            entryId: entry.id,
            sourcePage: recommended.sourcePage,
            files: [recommended, excluded]
          }
        }))
      }
    })
    render(<App />)
    await openConfiguredSearch(api)

    fireEvent.change(screen.getByLabelText('Title query'), {
      target: { value: 'Corrected title' }
    })
    fireEvent.change(screen.getByLabelText('Episode'), { target: { value: '7' } })
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    await waitFor(() =>
      expect(api.jimaku.searchTitles).toHaveBeenCalledWith('session-1', {
        query: 'Corrected title',
        category: 'all'
      })
    )
    expect(screen.getByText('Anime could not be searched. Available titles are still shown.'))
    fireEvent.click(screen.getByRole('button', { name: /Live title/ }))
    await waitFor(() => expect(api.jimaku.listFiles).toHaveBeenCalledWith('session-1', 7, false))
    expect(screen.getByText(recommended.name)).toBeTruthy()
    expect(screen.queryByText(excluded.name)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Show all files' }))
    expect(screen.getByText(excluded.name)).toBeTruthy()
  })

  it('requires an explicit ZIP member choice before applying subtitles', async () => {
    const entry: JimakuEntry = {
      id: 7,
      name: 'Episode',
      flags: { anime: true, movie: false, external: false, unverified: false, adult: false }
    }
    const zip = file(7, 'zip', 'Episode-pack.zip', 'zip')
    const prepared = preparedSubtitle('b')
    const api = installFakeKizunaApi({
      media: {
        enumerateTracks: vi.fn(async () => [SUB_EN]),
        loadSubtitle: vi.fn(async () => [{ start: 0, end: 1, text: 'Hello' }]),
        loadExternalSubtitle: vi.fn(async () => [{ start: 0, end: 1, text: 'こんにちは' }])
      },
      mediaHistory: {
        getRecentFiles: vi.fn(async () => [{ path: EPISODE, openedAt: 1 }])
      },
      jimaku: {
        getStatus: vi.fn(async () => configured),
        beginSession: vi.fn(async (_path, mediaGeneration) => ({
          ok: true as const,
          value: { sessionId: 'session-1', mediaGeneration }
        })),
        searchTitles: vi.fn(async () => ({
          ok: true as const,
          value: { entries: [entry], partial: false }
        })),
        listFiles: vi.fn(async () => ({
          ok: true as const,
          value: { entryId: entry.id, sourcePage: zip.sourcePage, files: [zip] }
        })),
        prepareFile: vi.fn(async () => ({ ok: true as const, value: archiveMembers(entry.id) })),
        prepareArchiveMember: vi.fn(async () => ({ ok: true as const, value: prepared })),
        commitPreparedSubtitle: vi.fn(async () => ({
          ok: true as const,
          value: prepared.selection
        }))
      }
    })
    render(<App />)
    await openConfiguredSearch(api)
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    await waitFor(() => expect(api.jimaku.searchTitles).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /Episode/ }))
    await waitFor(() => expect(api.jimaku.listFiles).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Choose file…' }))
    await waitFor(() => expect(screen.getByText(/will not guess between ambiguous members/)))
    expect(screen.getByText('Timing unknown')).toBeTruthy()
    expect(api.media.loadExternalSubtitle).not.toHaveBeenCalled()

    fireEvent.click(screen.getAllByRole('button', { name: 'Download and use' })[0])
    await waitFor(() =>
      expect(api.jimaku.prepareArchiveMember).toHaveBeenCalledWith(
        'session-1',
        'package-1',
        'member-1'
      )
    )
    await waitFor(() => expect(api.media.loadExternalSubtitle).toHaveBeenCalled())
    expect(screen.getByText('Subtitle loaded.')).toBeTruthy()
  })

  it('loads a remembered folder title only when Find is opened', async () => {
    const entry: JimakuEntry = {
      id: 7,
      name: 'Remembered title',
      flags: { anime: true, movie: false, external: false, unverified: false, adult: false }
    }
    const remembered = {
      entryId: 7,
      name: entry.name,
      category: 'anime' as const,
      updatedAt: 1
    }
    const api = installFakeKizunaApi({
      media: {
        enumerateTracks: vi.fn(async () => [SUB_EN]),
        loadSubtitle: vi.fn(async () => [{ start: 0, end: 1, text: 'Hello' }])
      },
      mediaHistory: {
        getRecentFiles: vi.fn(async () => [{ path: EPISODE, openedAt: 1 }])
      },
      jimaku: {
        getStatus: vi.fn(async () => configured),
        getFolderHint: vi.fn(async () => remembered),
        beginSession: vi.fn(async (_path, mediaGeneration) => ({
          ok: true as const,
          value: { sessionId: 'session-1', mediaGeneration }
        })),
        listFiles: vi.fn(async () => ({
          ok: true as const,
          value: {
            entryId: entry.id,
            sourcePage: file(entry.id, 'candidate-1', 'Remembered title 05.srt').sourcePage,
            files: [file(entry.id, 'candidate-1', 'Remembered title 05.srt')]
          }
        }))
      }
    })
    render(<App />)
    await openRecent(api.player.load)
    expect(api.jimaku.getStatus).not.toHaveBeenCalled()
    expect(api.jimaku.getFolderHint).not.toHaveBeenCalled()

    openFindCommand()
    await waitFor(() => expect(api.jimaku.getFolderHint).toHaveBeenCalledWith(EPISODE, undefined))
    expect(screen.getByText('Using remembered title')).toBeTruthy()
    expect((screen.getByLabelText('Title query') as HTMLInputElement).value).toBe(entry.name)
    expect(api.jimaku.searchTitles).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: /Remembered title/ }))
    await waitFor(() => expect(api.jimaku.listFiles).toHaveBeenCalled())
  })

  it('restores a cached Jimaku subtitle and its versioned offset offline', async () => {
    const prepared = preparedSubtitle('c')
    const history: MediaPlaybackHistory = {
      positionSeconds: 0,
      updatedAt: 1,
      subtitle: prepared.selection,
      subtitleOffsetsByVersion: { [prepared.contentVersion]: 1500 }
    }
    const api = installFakeKizunaApi({
      media: {
        enumerateTracks: vi.fn(async () => [SUB_EN]),
        loadSubtitle: vi.fn(async () => [{ start: 0, end: 1, text: 'Hello' }]),
        loadExternalSubtitle: vi.fn(async () => [{ start: -2, end: 1, text: 'こんにちは' }])
      },
      mediaHistory: {
        getRecentFiles: vi.fn(async () => [{ path: EPISODE, openedAt: 1 }]),
        getPlaybackHistory: vi.fn(async () => history)
      }
    })
    render(<App />)

    await openRecent(api.player.load)
    await waitFor(() =>
      expect(api.media.loadExternalSubtitle).toHaveBeenCalledWith(prepared.selection.path, 'auto')
    )
    await waitFor(() => expect(screen.getByText('こんにちは')).toBeTruthy())
    expect(api.jimaku.getStatus).not.toHaveBeenCalled()
    expect(api.jimaku.beginSession).not.toHaveBeenCalled()
    expect(api.jimaku.searchTitles).not.toHaveBeenCalled()

    openSubtitleMenu()
    expect(
      (screen.getByLabelText('Subtitle offset in milliseconds') as HTMLInputElement).value
    ).toBe('1500')
  })

  it('drops a stale download when the video changes', async () => {
    const entry: JimakuEntry = {
      id: 7,
      name: 'Episode',
      flags: { anime: true, movie: false, external: false, unverified: false, adult: false }
    }
    const candidate = file(7, 'candidate-1', 'Episode05.srt')
    const pending = deferred<{ ok: true; value: JimakuPreparedSubtitleResult }>()
    const api = installFakeKizunaApi({
      media: {
        enumerateTracks: vi.fn(async () => [SUB_EN]),
        loadSubtitle: vi.fn(async () => [{ start: 0, end: 1, text: 'Hello' }]),
        loadExternalSubtitle: vi.fn(async () => [{ start: 0, end: 1, text: 'こんにちは' }])
      },
      mediaHistory: {
        getRecentFiles: vi.fn(async () => [
          { path: EPISODE, openedAt: 2 },
          { path: OTHER_EPISODE, openedAt: 1 }
        ])
      },
      jimaku: {
        getStatus: vi.fn(async () => configured),
        beginSession: vi.fn(async (path, mediaGeneration) => ({
          ok: true as const,
          value: { sessionId: path === EPISODE ? 'session-a' : 'session-b', mediaGeneration }
        })),
        searchTitles: vi.fn(async () => ({
          ok: true as const,
          value: { entries: [entry], partial: false }
        })),
        listFiles: vi.fn(async () => ({
          ok: true as const,
          value: { entryId: entry.id, sourcePage: candidate.sourcePage, files: [candidate] }
        })),
        prepareFile: vi.fn(async () => pending.promise)
      }
    })
    render(<App />)
    await openConfiguredSearch(api)
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    await waitFor(() => expect(api.jimaku.searchTitles).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /Episode/ }))
    await waitFor(() => expect(api.jimaku.listFiles).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Download and use' }))
    await waitFor(() => expect(api.jimaku.prepareFile).toHaveBeenCalled())

    await openRecent(api.player.load, OTHER_EPISODE)
    pending.resolve({ ok: true, value: preparedSubtitle('d') })
    await waitFor(() => expect(api.player.load).toHaveBeenCalledWith(OTHER_EPISODE))
    expect(api.media.loadExternalSubtitle).not.toHaveBeenCalled()
    expect(screen.queryByText('こんにちは')).toBeNull()
  })

  it('keeps the current subtitle when a downloaded subtitle cannot be parsed', async () => {
    const entry: JimakuEntry = {
      id: 7,
      name: 'Episode',
      flags: { anime: true, movie: false, external: false, unverified: false, adult: false }
    }
    const candidate = file(7, 'candidate-1', 'Episode05.srt')
    const prepared = preparedSubtitle('e')
    const api = installFakeKizunaApi({
      media: {
        enumerateTracks: vi.fn(async () => [SUB_EN]),
        loadSubtitle: vi.fn(async () => [{ start: 0, end: 1, text: 'Hello' }]),
        loadExternalSubtitle: vi.fn(async () => {
          throw new Error('invalid subtitle')
        })
      },
      mediaHistory: {
        getRecentFiles: vi.fn(async () => [{ path: EPISODE, openedAt: 1 }])
      },
      jimaku: {
        getStatus: vi.fn(async () => configured),
        beginSession: vi.fn(async (_path, mediaGeneration) => ({
          ok: true as const,
          value: { sessionId: 'session-1', mediaGeneration }
        })),
        searchTitles: vi.fn(async () => ({
          ok: true as const,
          value: { entries: [entry], partial: false }
        })),
        listFiles: vi.fn(async () => ({
          ok: true as const,
          value: { entryId: entry.id, sourcePage: candidate.sourcePage, files: [candidate] }
        })),
        prepareFile: vi.fn(async () => ({ ok: true as const, value: prepared }))
      }
    })
    render(<App />)
    await openConfiguredSearch(api)
    await waitFor(() => expect(screen.getByText('Hello')).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    await waitFor(() => expect(api.jimaku.searchTitles).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /Episode/ }))
    await waitFor(() => expect(api.jimaku.listFiles).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Download and use' }))

    await waitFor(() =>
      expect(screen.getByText('Kizuna could not load this subtitle. Choose another file.'))
    )
    expect(screen.getByText('Hello')).toBeTruthy()
    expect(api.mediaHistory.setSubtitleTrack).not.toHaveBeenCalledWith(
      EPISODE,
      expect.objectContaining({ mode: 'external' })
    )
  })

  it('downloads, applies, and persists a subtitle without seeking or pausing', async () => {
    const entry: JimakuEntry = {
      id: 7,
      name: 'Episode',
      flags: { anime: true, movie: false, external: false, unverified: false, adult: false }
    }
    const file: JimakuFileCandidate = {
      candidateId: 'candidate-1',
      entryId: entry.id,
      sourcePage: { entryId: entry.id, url: 'https://jimaku.cc/entry/7' },
      name: 'Episode05.srt',
      size: 10,
      lastModified: 'revision-1',
      format: 'srt',
      status: 'eligible',
      reasons: []
    }
    const prepared = preparedSubtitle()
    const api = installFakeKizunaApi({
      player: {
        setPause: vi.fn(async () => undefined),
        seek: vi.fn(async () => undefined)
      },
      media: {
        enumerateTracks: vi.fn(async () => [SUB_EN]),
        loadSubtitle: vi.fn(async () => [{ start: 0, end: 1, text: 'Hello' }]),
        loadExternalSubtitle: vi.fn(async () => [{ start: 0, end: 1, text: 'こんにちは' }])
      },
      mediaHistory: {
        getRecentFiles: vi.fn(async () => [{ path: EPISODE, openedAt: 1 }])
      },
      jimaku: {
        getStatus: vi.fn(async () => configured),
        beginSession: vi.fn(async (_path, mediaGeneration) => ({
          ok: true as const,
          value: { sessionId: 'session-1', mediaGeneration }
        })),
        searchTitles: vi.fn(async () => ({
          ok: true as const,
          value: { entries: [entry], partial: false }
        })),
        listFiles: vi.fn(async () => ({
          ok: true as const,
          value: { entryId: entry.id, sourcePage: file.sourcePage, files: [file] }
        })),
        prepareFile: vi.fn(async () => ({ ok: true as const, value: prepared })),
        commitPreparedSubtitle: vi.fn(async () => ({
          ok: true as const,
          value: prepared.selection
        })),
        exportActiveSubtitle: vi.fn(async () => ({
          status: 'exported' as const,
          path: 'C:\\Exports\\Episode05.srt'
        }))
      }
    })
    render(<App />)
    await openRecent(api.player.load)

    fireEvent.click(screen.getByRole('button', { name: 'Subtitle' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Find Japanese subtitles' }))
    await waitFor(() => expect(api.jimaku.beginSession).toHaveBeenCalledWith(EPISODE, 1))

    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    await waitFor(() => expect(api.jimaku.searchTitles).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /Episode/ }))
    await waitFor(() => expect(api.jimaku.listFiles).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Download and use' }))

    await waitFor(() => expect(api.media.loadExternalSubtitle).toHaveBeenCalled())
    await waitFor(() => expect(api.jimaku.commitPreparedSubtitle).toHaveBeenCalled())
    expect(api.mediaHistory.setSubtitleTrack).toHaveBeenCalledWith(
      EPISODE,
      expect.objectContaining({ mode: 'external', path: prepared.selection.path })
    )
    expect(api.player.seek).not.toHaveBeenCalled()
    expect(api.player.setPause).not.toHaveBeenCalled()
    expect(screen.getByText('Subtitle loaded.')).toBeTruthy()

    fireEvent.click(
      within(screen.getByRole('dialog', { name: 'Find Japanese subtitles' })).getByRole('button', {
        name: 'Close find japanese subtitles'
      })
    )
    openSubtitleMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Save subtitle as' }))
    await waitFor(() =>
      expect(api.jimaku.exportActiveSubtitle).toHaveBeenCalledWith({
        mediaPath: EPISODE,
        mediaGeneration: 1,
        provenance: prepared.selection.provenance
      })
    )
  })

  it('tracks A/B/A versions, deduplicates the active version, and reverts once', async () => {
    const entry: JimakuEntry = {
      id: 7,
      name: 'Episode',
      flags: { anime: true, movie: false, external: false, unverified: false, adult: false }
    }
    const candidate = file(7, 'candidate-1', 'Episode05.srt')
    const versions = [
      preparedSubtitle('a'),
      preparedSubtitle('b'),
      preparedSubtitle('a'),
      preparedSubtitle('a')
    ]
    let prepareCount = 0
    const api = installFakeKizunaApi({
      media: {
        enumerateTracks: vi.fn(async () => [SUB_EN]),
        loadSubtitle: vi.fn(async () => [{ start: 0, end: 1, text: 'Hello' }]),
        loadExternalSubtitle: vi.fn(async () => [{ start: 0, end: 1, text: 'こんにちは' }])
      },
      mediaHistory: {
        getRecentFiles: vi.fn(async () => [{ path: EPISODE, openedAt: 1 }])
      },
      jimaku: {
        getStatus: vi.fn(async () => configured),
        beginSession: vi.fn(async (_path, mediaGeneration) => ({
          ok: true as const,
          value: { sessionId: 'session-1', mediaGeneration }
        })),
        searchTitles: vi.fn(async () => ({
          ok: true as const,
          value: { entries: [entry], partial: false }
        })),
        listFiles: vi.fn(async () => ({
          ok: true as const,
          value: { entryId: entry.id, sourcePage: candidate.sourcePage, files: [candidate] }
        })),
        prepareFile: vi.fn(async () => ({
          ok: true as const,
          value: versions[Math.min(prepareCount++, versions.length - 1)]
        })),
        commitPreparedSubtitle: vi.fn(async () => ({
          ok: true as const,
          value: versions[0].selection
        }))
      }
    })
    render(<App />)
    await openConfiguredSearch(api)
    fireEvent.click(screen.getByRole('button', { name: 'Search' }))
    await waitFor(() => expect(api.jimaku.searchTitles).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: /Episode/ }))
    await waitFor(() => expect(api.jimaku.listFiles).toHaveBeenCalled())

    const choose = (): void => {
      fireEvent.click(screen.getByRole('button', { name: 'Download and use' }))
    }
    choose()
    await waitFor(() => expect(api.media.loadExternalSubtitle).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: 'Try another' }))
    choose()
    await waitFor(() => expect(api.media.loadExternalSubtitle).toHaveBeenCalledTimes(2))
    fireEvent.click(screen.getByRole('button', { name: 'Try another' }))
    choose()
    await waitFor(() => expect(api.media.loadExternalSubtitle).toHaveBeenCalledTimes(3))

    fireEvent.click(screen.getByRole('button', { name: 'Try another' }))
    choose()
    await waitFor(() => expect(screen.getByText('This subtitle is already in use.')))
    expect(api.media.loadExternalSubtitle).toHaveBeenCalledTimes(3)

    fireEvent.click(screen.getByRole('button', { name: 'Revert to previous subtitles' }))
    await waitFor(() => expect(api.media.loadExternalSubtitle).toHaveBeenCalledTimes(4))
    expect(api.mediaHistory.setSubtitleTrack).toHaveBeenCalledWith(
      EPISODE,
      expect.objectContaining({ mode: 'external', path: versions[1].selection.path })
    )
  })
})
