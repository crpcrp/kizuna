// @vitest-environment happy-dom
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import { usePlayerEvents, type UsePlayerEventsInput } from '@src/renderer/src/state/usePlayerEvents'
import { INACTIVE_MINI_PLAYER } from '@src/renderer/src/state/miniPlayer'
import type { KizunaApi } from '@src/shared/preloadApi'
import type { RecentFilesController } from '@src/renderer/src/state/recentFilesController'
import type {
  PlaylistController,
  PlaylistLoadDeps
} from '@src/renderer/src/state/playlistController'
import type { PlayerApi } from '@src/renderer/src/components/BottomBar'

/** A minimal `onX(cb) => unsub` registry: tracks active listeners per event
 * name so tests can assert registration/unsubscription counts and emit events
 * only to whichever listener is currently active. */
function createRegistry() {
  const active: Record<string, { cb: (...args: unknown[]) => void; unsub: Mock }[]> = {}
  function on(name: string): Mock {
    return vi.fn((cb: (...args: unknown[]) => void) => {
      const unsub: Mock = vi.fn(() => {
        active[name] = (active[name] ?? []).filter((entry) => entry.unsub !== unsub)
      })
      ;(active[name] ??= []).push({ cb, unsub })
      return unsub
    })
  }
  function emit(name: string, ...args: unknown[]): void {
    ;(active[name] ?? []).forEach((entry) => entry.cb(...args))
  }
  return { on, emit }
}

function setup() {
  const registry = createRegistry()
  const dispatch = vi.fn()
  const bridge = {
    player: {
      onTimePos: registry.on('timePos'),
      onDuration: registry.on('duration'),
      onPause: registry.on('pause'),
      onEofReached: registry.on('eof'),
      onMediaKey: registry.on('mediaKey')
    },
    windowControls: {
      onFullscreenChange: registry.on('fullscreen'),
      setAlwaysOnTop: vi.fn()
    },
    launch: {
      onOpenPath: registry.on('openPath'),
      onError: registry.on('launchError'),
      rendererReady: vi.fn()
    }
  } as unknown as KizunaApi
  const recentFiles = {
    getState: vi.fn(() => ({ mediaOpening: false })),
    openPath: vi.fn().mockResolvedValue({ status: 'opened' }),
    reportError: vi.fn()
  } as unknown as RecentFilesController
  const playlistController = {
    isPlaybackCurrent: vi.fn(() => false),
    handleEof: vi.fn().mockResolvedValue(true),
    next: vi.fn().mockResolvedValue(undefined),
    prev: vi.fn().mockResolvedValue(undefined)
  } as unknown as PlaylistController
  const playerAdapter: PlayerApi = {
    setPause: vi.fn().mockResolvedValue(undefined),
    seek: vi.fn().mockResolvedValue(undefined),
    setVolume: vi.fn().mockResolvedValue(undefined),
    setSpeed: vi.fn().mockResolvedValue(undefined),
    setMuted: vi.fn().mockResolvedValue(undefined)
  }
  const loadDeps: PlaylistLoadDeps = { load: vi.fn(), play: vi.fn() }
  const openPath = vi.fn().mockResolvedValue({ status: 'opened' })
  const input: UsePlayerEventsInput = {
    dispatch,
    bridge,
    playerAdapter,
    handleOpenNeighbor: vi.fn().mockResolvedValue(undefined),
    stateRef: { current: { autoPlayNext: false, filePath: '/a.mkv', paused: false } },
    recentFiles,
    playlistController,
    playlistLoadDeps: vi.fn(() => loadDeps),
    miniPlayerRef: { current: INACTIVE_MINI_PLAYER },
    setMiniPlayer: vi.fn(),
    setAlwaysOnTop: vi.fn(),
    applyMiniPlayerEffect: vi.fn().mockResolvedValue(undefined),
    openPath
  }
  const hook = renderHook(({ value }) => usePlayerEvents(value), { initialProps: { value: input } })
  return { registry, bridge, recentFiles, playlistController, playerAdapter, loadDeps, input, hook }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('usePlayerEvents', () => {
  it('registers each player/window/launch listener exactly once and notifies launch-ready', () => {
    const { bridge } = setup()
    expect(bridge.player.onTimePos).toHaveBeenCalledTimes(1)
    expect(bridge.player.onDuration).toHaveBeenCalledTimes(1)
    expect(bridge.player.onPause).toHaveBeenCalledTimes(1)
    expect(bridge.player.onEofReached).toHaveBeenCalledTimes(1)
    expect(bridge.player.onMediaKey).toHaveBeenCalledTimes(1)
    expect(bridge.windowControls.onFullscreenChange).toHaveBeenCalledTimes(1)
    expect(bridge.launch.onOpenPath).toHaveBeenCalledTimes(1)
    expect(bridge.launch.onError).toHaveBeenCalledTimes(1)
    expect(bridge.launch.rendererReady).toHaveBeenCalledTimes(1)
  })

  it('routes timePos/duration/pause pushes to the exact dispatch action', () => {
    const { registry, input } = setup()
    registry.emit('timePos', 12.5)
    registry.emit('duration', 90)
    registry.emit('pause', true)
    expect(input.dispatch).toHaveBeenCalledWith({ type: 'timePos', value: 12.5 })
    expect(input.dispatch).toHaveBeenCalledWith({ type: 'duration', value: 90 })
    expect(input.dispatch).toHaveBeenCalledWith({ type: 'setPaused', value: true })
  })

  it('routes an EOF rising edge to folder auto-advance when autoPlayNext is on and the queue is idle', () => {
    const { registry, input } = setup()
    input.stateRef.current.autoPlayNext = true
    registry.emit('eof', true)
    expect(input.handleOpenNeighbor).toHaveBeenCalledWith('next')
  })

  it('routes an EOF rising edge to the play queue when it owns playback, regardless of autoPlayNext', () => {
    const { registry, input, playlistController, loadDeps } = setup()
    ;(playlistController.isPlaybackCurrent as Mock).mockReturnValue(true)
    registry.emit('eof', true)
    expect(playlistController.handleEof).toHaveBeenCalledWith(loadDeps)
    expect(input.handleOpenNeighbor).not.toHaveBeenCalled()
  })

  it('routes the stop media key through the player adapter', () => {
    const { registry, playerAdapter } = setup()
    registry.emit('mediaKey', 'stop')
    expect(playerAdapter.setPause).toHaveBeenCalledWith(true)
    expect(playerAdapter.seek).toHaveBeenCalledWith(0, true)
  })

  it('routes the next media key to the play queue when it is active, else the folder neighbor', () => {
    const { registry, input, playlistController, loadDeps } = setup()
    registry.emit('mediaKey', 'next')
    expect(input.handleOpenNeighbor).toHaveBeenCalledWith('next')
    ;(playlistController.isPlaybackCurrent as Mock).mockReturnValue(true)
    registry.emit('mediaKey', 'next')
    expect(playlistController.next).toHaveBeenCalledWith(loadDeps)
  })

  it('delivers a launch-open path through the shared openPath closure', () => {
    const { registry, input } = setup()
    registry.emit('openPath', '/opened/from/launch.mkv')
    expect(input.openPath).toHaveBeenCalledWith('/opened/from/launch.mkv')
  })

  it('reports a launch error through recentFiles.reportError', () => {
    const { registry, recentFiles } = setup()
    registry.emit('launchError', 'could not open the launch file')
    expect(recentFiles.reportError).toHaveBeenCalledWith('could not open the launch file')
  })

  it('does not duplicate subscriptions on a rerender with stable dependencies', () => {
    const { bridge, hook, input } = setup()
    hook.rerender({ value: { ...input } })
    expect(bridge.player.onTimePos).toHaveBeenCalledTimes(1)
  })

  it('unsubscribes the old listeners before installing new ones when a dependency changes', () => {
    const { bridge, hook, input } = setup()
    const firstUnsub = (bridge.player.onTimePos as unknown as Mock).mock.results[0]?.value as Mock
    const nextPlayerAdapter: PlayerApi = { ...input.playerAdapter }
    hook.rerender({ value: { ...input, playerAdapter: nextPlayerAdapter } })
    expect(firstUnsub).toHaveBeenCalledTimes(1)
    expect(bridge.player.onTimePos).toHaveBeenCalledTimes(2)
  })

  it('invokes every unsubscribe exactly once on unmount, after which events have no effect', () => {
    const { bridge, registry, hook, input } = setup()
    const unsubs = [
      bridge.player.onTimePos,
      bridge.player.onDuration,
      bridge.player.onPause,
      bridge.player.onEofReached,
      bridge.player.onMediaKey,
      bridge.windowControls.onFullscreenChange
    ].map((spy) => (spy as unknown as Mock).mock.results[0].value as Mock)
    const launchUnsubs = [bridge.launch.onOpenPath, bridge.launch.onError].map(
      (spy) => (spy as unknown as Mock).mock.results[0].value as Mock
    )
    hook.unmount()
    for (const unsub of [...unsubs, ...launchUnsubs]) {
      expect(unsub).toHaveBeenCalledTimes(1)
    }

    // The unsub calls above detach each callback from the registry (the same
    // fake the hook subscribed through), so re-emitting on it — not a fresh
    // registry — proves the app actually stopped listening rather than that a
    // still-live closure merely wasn't re-invoked.
    ;(input.dispatch as unknown as Mock).mockClear()
    registry.emit('timePos', 999)
    registry.emit('eof', true)
    expect(input.dispatch).not.toHaveBeenCalled()
  })
})
