// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import App from '@src/renderer/src/App'
import type { RecentMediaFile } from '@src/shared/mediaHistory'
import type { FileAvailability } from '@src/shared/preloadApi'
import { installFakeKizunaApi, type FakeKizunaApi } from '../harness/fakeKizunaApi'
import { EPISODE, installAppTeardown, recent } from '../harness/appIntegration'

// Rendered interaction coverage for the Media menu's recent-files section.
// Everything below the renderer — dialogs, media, history — is the fake
// preload bridge; no production code is exercised outside src/.

const EPISODE_4 = 'C:\\Media\\episode04.mkv'
const PICKED = 'E:\\video\\picked.mkv'

interface BridgeOptions {
  /** Resolved by every `getRecentFiles` call — mutate it to model a refresh. */
  recentFiles?: RecentMediaFile[]
  getRecentFiles?: () => Promise<RecentMediaFile[]>
  clearRecentFiles?: () => Promise<void>
  availability?: FileAvailability
  /** Paths the picker returns, one per "Open file…" (defaults to PICKED). */
  pickedPaths?: string[]
  /** Entries `media.readPlaylist` expands a picked .m3u into. */
  playlistEntries?: string[]
}

interface Bridge {
  getRecentFiles: FakeKizunaApi['mediaHistory']['getRecentFiles']
  removeRecentFile: FakeKizunaApi['mediaHistory']['removeRecentFile']
  clearRecentFiles: FakeKizunaApi['mediaHistory']['clearRecentFiles']
  checkFileAvailability: FakeKizunaApi['mediaHistory']['checkFileAvailability']
  openFile: FakeKizunaApi['media']['openFile']
  load: FakeKizunaApi['player']['load']
  /** Newest-first list the fake's `getRecentFiles` returns; mutable per test. */
  files: RecentMediaFile[]
}

function installBridge(options: BridgeOptions = {}): Bridge {
  const files = [...(options.recentFiles ?? [])]

  const bridge: Bridge = {
    files,
    getRecentFiles: vi.fn(options.getRecentFiles ?? (async () => [...bridge.files])),
    removeRecentFile: vi.fn(async (path: string) => {
      bridge.files = bridge.files.filter((file) => file.path !== path)
      return [...bridge.files]
    }),
    clearRecentFiles: vi.fn(
      options.clearRecentFiles ??
        (async () => {
          bridge.files = []
        })
    ),
    checkFileAvailability: vi.fn(
      async () => options.availability ?? { status: 'available' as const }
    ),
    openFile: vi.fn(async () => {
      const picked = options.pickedPaths?.[bridge.openFile.mock.calls.length - 1] ?? PICKED
      bridge.files = recent(picked, ...bridge.files.map((file) => file.path))
      return picked
    }),
    load: vi.fn(async () => undefined)
  }

  installFakeKizunaApi({
    player: {
      load: bridge.load
    },
    media: {
      openFile: bridge.openFile,
      readPlaylist: vi.fn(async () => [...(options.playlistEntries ?? [])])
    },
    mediaHistory: {
      getRecentFiles: bridge.getRecentFiles,
      removeRecentFile: bridge.removeRecentFile,
      clearRecentFiles: bridge.clearRecentFiles,
      checkFileAvailability: bridge.checkFileAvailability
    }
  })

  return bridge
}

/** Opens the Media dropdown and waits for the recent list to have hydrated. */
async function openMediaMenu(bridge: Bridge): Promise<void> {
  await waitFor(() => expect(bridge.getRecentFiles).toHaveBeenCalled())
  fireEvent.click(screen.getByRole('button', { name: 'Media' }))
}

function mediaMenuOpen(): boolean {
  return screen.getByRole('button', { name: 'Media' }).getAttribute('aria-expanded') === 'true'
}

function alertText(): string {
  return screen.getByRole('alert').textContent ?? ''
}

installAppTeardown()

describe('App recent-files interactions', () => {
  it('forwards the clicked entry’s exact path and closes the Media menu', async () => {
    const bridge = installBridge({ recentFiles: recent(EPISODE, EPISODE_4) })
    render(<App />)

    await openMediaMenu(bridge)
    expect(mediaMenuOpen()).toBe(true)
    fireEvent.click(await screen.findByRole('menuitem', { name: EPISODE_4 }))

    // The clicked row's own path — not the newest entry, not a normalized or
    // lower-cased variant — reaches the bridge, and the picker is never used.
    await waitFor(() => expect(bridge.load).toHaveBeenCalledWith(EPISODE_4))
    expect(bridge.checkFileAvailability).toHaveBeenCalledWith(EPISODE_4)
    expect(bridge.openFile).not.toHaveBeenCalled()
    expect(mediaMenuOpen()).toBe(false)
  })

  it('drops a missing recent entry, reports it, and never loads it', async () => {
    const bridge = installBridge({
      recentFiles: recent(EPISODE, EPISODE_4),
      availability: { status: 'missing' }
    })
    render(<App />)

    await openMediaMenu(bridge)
    fireEvent.click(await screen.findByRole('menuitem', { name: EPISODE }))

    await waitFor(() => expect(alertText()).toContain('This file could no longer be found.'))
    expect(bridge.removeRecentFile).toHaveBeenCalledWith(EPISODE)
    expect(bridge.load).not.toHaveBeenCalled()
    // The list is refreshed from the bridge, so the dead shortcut is gone
    // while the surviving one stays clickable.
    await waitFor(() => expect(screen.queryByRole('menuitem', { name: EPISODE })).toBeNull())
    expect(screen.getByRole('menuitem', { name: EPISODE_4 })).not.toBeNull()
  })

  it('empties the list when Clear recent files succeeds', async () => {
    const bridge = installBridge({ recentFiles: recent(EPISODE, EPISODE_4) })
    render(<App />)

    await openMediaMenu(bridge)
    const clear = await screen.findByRole('menuitem', { name: 'Clear recent files' })
    expect(clear.hasAttribute('disabled')).toBe(false)
    fireEvent.click(clear)

    await waitFor(() => expect(bridge.clearRecentFiles).toHaveBeenCalledTimes(1))
    await screen.findByText('No recent files')
    expect(screen.queryByRole('menuitem', { name: EPISODE })).toBeNull()
    expect(
      screen.getByRole('menuitem', { name: 'Clear recent files' }).hasAttribute('disabled')
    ).toBe(true)
    expect(mediaMenuOpen()).toBe(false)
  })

  it('keeps the entries and reports the failure when Clear recent files fails', async () => {
    const bridge = installBridge({
      recentFiles: recent(EPISODE, EPISODE_4),
      clearRecentFiles: async () => {
        throw new Error('Could not clear recent files.')
      }
    })
    render(<App />)

    await openMediaMenu(bridge)
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Clear recent files' }))

    await waitFor(() => expect(alertText()).toContain('Could not clear recent files.'))
    expect(screen.getByRole('menuitem', { name: EPISODE })).not.toBeNull()
    expect(screen.getByRole('menuitem', { name: EPISODE_4 })).not.toBeNull()
  })

  it('shows an empty list and an error when the initial recent-files read fails', async () => {
    const bridge = installBridge({
      recentFiles: recent(EPISODE),
      getRecentFiles: async () => {
        throw new Error('History unavailable.')
      }
    })
    render(<App />)

    await openMediaMenu(bridge)
    await waitFor(() => expect(alertText()).toContain('History unavailable.'))
    expect(await screen.findByText('No recent files')).not.toBeNull()
    expect(screen.queryByRole('menuitem', { name: EPISODE })).toBeNull()
    // Nothing to clear, so the row stays disabled after the failed read.
    expect(
      screen.getByRole('menuitem', { name: 'Clear recent files' }).hasAttribute('disabled')
    ).toBe(true)
  })

  it('empties the playlist sidebar when the picker opens a single file over a queue', async () => {
    const bridge = installBridge({
      recentFiles: recent(EPISODE),
      pickedPaths: ['C:\\Media\\queue.m3u', PICKED],
      playlistEntries: [EPISODE, EPISODE_4]
    })
    render(<App />)

    await waitFor(() => expect(bridge.getRecentFiles).toHaveBeenCalled())
    fireEvent.click(screen.getByRole('button', { name: 'Toggle playlist sidebar' }))

    // A picked .m3u replaces the queue with its entries, which the sidebar lists.
    await openMediaMenu(bridge)
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Open file' }))
    await waitFor(() => expect(bridge.load).toHaveBeenCalledWith(EPISODE))
    expect(screen.getAllByRole('button', { name: /^(Episode05|episode04)\.mkv$/ })).toHaveLength(2)

    // Opening a single file replaces that queue with just it — one entry is not
    // a playlist, so the sidebar goes back to its empty state.
    await openMediaMenu(bridge)
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Open file' }))

    await waitFor(() => expect(bridge.load).toHaveBeenCalledWith(PICKED))
    await waitFor(() => expect(screen.getByText(/Queue is empty/)).not.toBeNull())
    expect(screen.queryAllByRole('button', { name: /\.mkv$/ })).toHaveLength(0)
  })

  it('refreshes the recent list after the picker opens a file', async () => {
    const bridge = installBridge({ recentFiles: recent(EPISODE) })
    render(<App />)

    await openMediaMenu(bridge)
    expect(screen.queryByRole('menuitem', { name: PICKED })).toBeNull()
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Open file' }))

    await waitFor(() => expect(bridge.load).toHaveBeenCalledWith(PICKED))
    // The refresh re-reads the bridge rather than optimistically prepending,
    // so the just-opened file appears newest-first from the stored list.
    await waitFor(() => expect(screen.getByRole('menuitem', { name: PICKED })).not.toBeNull())
    expect(bridge.getRecentFiles.mock.calls.length).toBeGreaterThanOrEqual(2)
    expect(screen.getByRole('menuitem', { name: EPISODE })).not.toBeNull()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
