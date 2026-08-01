// @vitest-environment happy-dom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '@src/renderer/src/App'
import { initialPlayerState } from '@src/renderer/src/state/playerState'
import { installFakeKizunaApi, type FakeKizunaApi } from '../harness/fakeKizunaApi'
import { appTeardown } from '../harness/appIntegration'

const CURRENT = 'C:\\Media\\current.mkv'
const ENTRY = 'C:\\Media\\episode02.mkv'

function installBridge(overrides: Partial<FakeKizunaApi['media']> = {}): FakeKizunaApi {
  const api = installFakeKizunaApi({ media: overrides })
  render(<App initialState={{ ...initialPlayerState, filePath: CURRENT }} />)
  return api
}

async function openMediaMenu(): Promise<void> {
  await waitFor(() => expect(screen.getByRole('button', { name: 'Media' })).toBeTruthy())
  fireEvent.click(screen.getByRole('button', { name: 'Media' }))
}

function alertText(): string {
  return screen.getByRole('alert').textContent ?? ''
}

afterEach(appTeardown)

describe('App playlist interactions', () => {
  it('reports a rejected add-files picker without changing the queue', async () => {
    const api = installBridge({
      openFiles: vi.fn(async () => {
        throw new Error('picker failed')
      })
    })

    await openMediaMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add files to playlist' }))

    await waitFor(() => expect(alertText()).toContain('Could not add files to the playlist.'))
    expect(api.media.openFiles).toHaveBeenCalledTimes(1)

    fireEvent.click(screen.getByRole('button', { name: 'Toggle playlist sidebar' }))
    expect(screen.getByText(/Queue is empty/)).toBeTruthy()
  })

  it('reports a rejected folder picker without changing the queue', async () => {
    const api = installBridge({
      openFolder: vi.fn(async () => {
        throw new Error('folder failed')
      })
    })

    await openMediaMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add folder to playlist' }))

    await waitFor(() => expect(alertText()).toContain('Could not add the folder to the playlist.'))
    expect(api.media.openFolder).toHaveBeenCalledTimes(1)
  })

  it('reports a selected unreadable playlist separately from picker failures', async () => {
    const api = installBridge({
      openFiles: vi.fn(async () => ['C:\\Media\\queue.m3u']),
      readPlaylist: vi.fn(async () => {
        throw new Error('read failed')
      })
    })

    await openMediaMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add files to playlist' }))

    await waitFor(() => expect(alertText()).toContain('Could not read the playlist.'))
    expect(api.media.readPlaylist).toHaveBeenCalledWith('C:\\Media\\queue.m3u')
  })

  it('reports a valid selected empty playlist without mutating the queue', async () => {
    const api = installBridge({
      openFiles: vi.fn(async () => ['C:\\Media\\empty.m3u']),
      readPlaylist: vi.fn(async () => [])
    })

    await openMediaMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add files to playlist' }))

    await waitFor(() => expect(alertText()).toContain('Playlist is empty.'))
    expect(api.media.readPlaylist).toHaveBeenCalledWith('C:\\Media\\empty.m3u')
  })

  it('reports a rejected playlist save and preserves the queue', async () => {
    const api = installBridge({
      openFiles: vi.fn(async () => [ENTRY]),
      savePlaylist: vi.fn(async () => {
        throw new Error('write failed')
      })
    })

    await openMediaMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add files to playlist' }))
    await waitFor(() => expect(api.media.openFiles).toHaveBeenCalledTimes(1))

    await openMediaMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Save playlist as M3U' }))

    await waitFor(() => expect(alertText()).toContain('Could not save the playlist.'))
    expect(api.media.savePlaylist).toHaveBeenCalledWith([ENTRY])
  })

  it('keeps picker and save cancellation silent', async () => {
    const api = installBridge({
      openFiles: vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([ENTRY]),
      openFolder: vi.fn(async () => []),
      savePlaylist: vi.fn(async () => undefined)
    })

    await openMediaMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add files to playlist' }))
    await waitFor(() => expect(api.media.openFiles).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('alert')).toBeNull()

    await openMediaMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add files to playlist' }))
    await waitFor(() => expect(api.media.openFiles).toHaveBeenCalledTimes(2))

    await openMediaMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add folder to playlist' }))
    await waitFor(() => expect(api.media.openFolder).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('alert')).toBeNull()

    await openMediaMenu()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Save playlist as M3U' }))
    await waitFor(() => expect(api.media.savePlaylist).toHaveBeenCalledWith([ENTRY]))
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
