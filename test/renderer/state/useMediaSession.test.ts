// @vitest-environment happy-dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { useReducer } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Cue } from '@src/shared/cue'
import type { Track } from '@src/shared/track'
import { initialPlayerState, playerReducer } from '@src/renderer/src/state/playerState'
import { useLatestRef } from '@src/renderer/src/state/useLatestRef'
import { useMediaSession } from '@src/renderer/src/state/useMediaSession'
import { deferred } from '@test/harness/deferred'
import { createFakeKizunaApi, type FakeKizunaApi } from '@test/harness/fakeKizunaApi'

const SUB: Track = { id: 2, kind: 'subtitle', codec: 'ass', language: 'jpn' }
const cuesFor = (text: string): Cue[] => [{ start: 0, end: 1, text }]

function setup(bridge: FakeKizunaApi = createFakeKizunaApi()) {
  bridge.media.enumerateTracks.mockResolvedValue([SUB])
  const hook = renderHook(() => {
    const [state, dispatch] = useReducer(playerReducer, initialPlayerState)
    const stateRef = useLatestRef(state)
    const session = useMediaSession({
      bridge,
      dispatch,
      player: { setPause: (paused) => bridge.player.setPause(paused) },
      state,
      stateRef
    })
    return { state, session }
  })
  return { bridge, hook }
}

function dropFiles(files: File[]): void {
  const event = new Event('drop', { cancelable: true })
  Object.defineProperty(event, 'dataTransfer', { value: { files } })
  window.dispatchEvent(event)
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('useMediaSession', () => {
  it('opens a file, enumerates its tracks, and loads the default subtitle', async () => {
    const { bridge, hook } = setup()
    bridge.media.loadSubtitle.mockResolvedValue(cuesFor('a'))

    let result: Awaited<ReturnType<typeof hook.result.current.session.events.openPath>>
    await act(async () => {
      result = await hook.result.current.session.events.openPath('/v/a.mkv')
    })

    expect(result!).toEqual({ status: 'opened', filePath: '/v/a.mkv', warnings: [] })
    expect(bridge.player.load).toHaveBeenCalledWith('/v/a.mkv')
    expect(bridge.media.loadSubtitle).toHaveBeenCalledWith('/v/a.mkv', SUB.id)
    await waitFor(() => expect(hook.result.current.state.cues).toEqual(cuesFor('a')))
    expect(hook.result.current.state.filePath).toBe('/v/a.mkv')
    expect(hook.result.current.session.subtitleRestoring).toBe(false)
    expect(bridge.mediaHistory.getRecentFiles).toHaveBeenCalledTimes(2)
  })

  it('refuses an open that overlaps one still in flight without touching the bridge', async () => {
    const { bridge, hook } = setup()
    const load = deferred<undefined>()
    bridge.player.load.mockReturnValueOnce(load.promise)

    let first!: Promise<unknown>
    act(() => {
      first = hook.result.current.session.events.openPath('/v/a.mkv')
    })
    await waitFor(() => expect(bridge.player.load).toHaveBeenCalledTimes(1))
    expect(hook.result.current.session.mediaMenu.mediaOpening).toBe(true)
    expect(hook.result.current.session.events.isMediaOpening()).toBe(true)

    await expect(hook.result.current.session.events.openPath('/v/b.mkv')).resolves.toEqual({
      status: 'busy'
    })
    expect(bridge.media.enumerateTracks).toHaveBeenCalledTimes(1)

    await act(async () => {
      load.resolve(undefined)
      await first
    })
    expect(hook.result.current.state.filePath).toBe('/v/a.mkv')
    expect(hook.result.current.session.mediaMenu.mediaOpening).toBe(false)
  })

  it("drops a superseded file's late subtitle load after a second open", async () => {
    const { bridge, hook } = setup()
    const slowA = deferred<Cue[]>()
    bridge.media.loadSubtitle.mockImplementation(async (path) =>
      path === '/v/a.mkv' ? slowA.promise : cuesFor('b')
    )

    await act(async () => {
      await hook.result.current.session.events.openPath('/v/a.mkv')
    })
    expect(hook.result.current.session.subtitleRestoring).toBe(true)
    await act(async () => {
      await hook.result.current.session.events.openPath('/v/b.mkv')
    })
    await waitFor(() => expect(hook.result.current.state.cues).toEqual(cuesFor('b')))

    await act(async () => {
      slowA.resolve(cuesFor('a'))
      await slowA.promise
    })
    expect(hook.result.current.state.filePath).toBe('/v/b.mkv')
    expect(hook.result.current.state.cues).toEqual(cuesFor('b'))
    expect(hook.result.current.session.subtitleRestoring).toBe(false)
  })

  it('starts an added playlist and advances to the next entry on EOF', async () => {
    const { bridge, hook } = setup()
    bridge.media.openFiles.mockResolvedValue(['/v/1.mkv', '/v/2.mkv'])

    await act(async () => {
      hook.result.current.session.mediaMenu.onAddFiles?.()
    })
    await waitFor(() => expect(hook.result.current.state.filePath).toBe('/v/1.mkv'))
    expect(bridge.player.setPause).toHaveBeenLastCalledWith(false)
    expect(hook.result.current.session.playlist.state.playlist.entries).toEqual([
      '/v/1.mkv',
      '/v/2.mkv'
    ])
    expect(hook.result.current.session.events.isPlaylistPlaybackCurrent('/v/1.mkv')).toBe(true)

    let advanced = false
    await act(async () => {
      advanced = await hook.result.current.session.events.handlePlaylistEof()
    })
    expect(advanced).toBe(true)
    expect(bridge.player.load).toHaveBeenLastCalledWith('/v/2.mkv')
    expect(hook.result.current.state.filePath).toBe('/v/2.mkv')
  })

  it('opens dropped files while mounted and stops listening after unmount', async () => {
    const { bridge, hook } = setup()
    bridge.files.pathForFile.mockImplementation((file) => `/drop/${file.name}`)

    await act(async () => {
      dropFiles([new File(['x'], 'a.mkv')])
    })
    await waitFor(() => expect(hook.result.current.state.filePath).toBe('/drop/a.mkv'))

    hook.unmount()
    dropFiles([new File(['x'], 'b.mkv')])
    await Promise.resolve()
    expect(bridge.files.pathForFile).toHaveBeenCalledTimes(1)
    expect(bridge.player.load).toHaveBeenCalledTimes(1)
  })
})
