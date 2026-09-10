// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '@src/renderer/src/App'
import type {
  JimakuEntry,
  JimakuFileCandidate,
  JimakuPreparedSubtitleResult,
  JimakuSettingsStatus
} from '@src/shared/jimaku'
import type { Track } from '@src/shared/track'
import { installFakeKizunaApi } from '../harness/fakeKizunaApi'
import { EPISODE, appTeardown, openRecent } from '../harness/appIntegration'

const SUB_EN: Track = { id: 4, kind: 'subtitle', codec: 'srt', title: 'Signs', language: 'eng' }

const configured: JimakuSettingsStatus = {
  configured: true,
  secretStorageAvailable: true,
  testOutcome: { status: 'notTested' }
}

function openSubtitleMenu(): void {
  fireEvent.click(screen.getByRole('button', { name: 'Subtitle' }))
}

function preparedSubtitle(): JimakuPreparedSubtitleResult {
  const contentVersion = 'a'.repeat(64)
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
  })
})
