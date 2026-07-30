import { describe, it, expect, vi } from 'vitest'
import {
  createPlaylistController,
  type PlaylistLoadDeps
} from '@src/renderer/src/state/playlistController'
import { type OpenMediaResult } from '@src/renderer/src/state/mediaSession'
/** A load seam that resolves 'opened' for every path unless overridden. */
function okLoad(): {
  deps: PlaylistLoadDeps
  load: ReturnType<typeof vi.fn>
  play: ReturnType<typeof vi.fn>
} {
  const load = vi.fn(async (filePath: string): Promise<OpenMediaResult> => ({
    status: 'opened',
    filePath,
    warnings: []
  }))
  const play = vi.fn(async () => undefined)
  return { deps: { load, play }, load, play }
}

/** A load seam that fails (missing) for the listed paths and opens the rest. */
function failingLoad(missingPaths: string[]): {
  deps: PlaylistLoadDeps
  load: ReturnType<typeof vi.fn>
} {
  const load = vi.fn(async (filePath: string): Promise<OpenMediaResult> =>
    missingPaths.includes(filePath)
      ? { status: 'missing', filePath, message: 'gone' }
      : { status: 'opened', filePath, warnings: [] }
  )
  return { deps: { load, play: vi.fn(async () => undefined) }, load }
}

const A = '/media/a.mkv'
const B = '/media/b.mkv'
const C = '/media/c.mkv'

describe('playlist controller — state', () => {
  it('starts empty', () => {
    const controller = createPlaylistController()
    expect(controller.getState().playlist.entries).toEqual([])
  })

  it('owns playback only when the playing file is the current entry', () => {
    const controller = createPlaylistController()
    // Empty / single entry: never owns playback.
    expect(controller.isPlaybackCurrent(A)).toBe(false)
    controller.addPaths([A])
    expect(controller.isPlaybackCurrent(A)).toBe(false)

    // Files queued behind an unrelated video: currentIndex is the pure model's
    // phantom 0, but the playing file is not entry 0 → queue does not own EOF.
    controller.addPaths([B, C])
    expect(controller.getState().playlist.currentIndex).toBe(0)
    expect(controller.isPlaybackCurrent('/other/movie.mkv')).toBe(false)
    // Even a file that merely appears later in the queue is not the current entry.
    expect(controller.isPlaybackCurrent(B)).toBe(false)
    // The actual current entry does count.
    expect(controller.isPlaybackCurrent(A)).toBe(true)
  })

  it('owns playback after a queue entry is actually played', async () => {
    const controller = createPlaylistController()
    controller.addPaths([A, B, C])
    const { deps } = okLoad()

    await controller.playAt(2, deps)
    expect(controller.isPlaybackCurrent(C)).toBe(true)
    expect(controller.isPlaybackCurrent(A)).toBe(false)
  })

  it('notifies subscribers on mutation', () => {
    const controller = createPlaylistController()
    const listener = vi.fn()
    controller.subscribe(listener)
    controller.addPaths([A])
    expect(listener).toHaveBeenCalled()
  })

  it('appends, removes, reorders, and clears entries', () => {
    const controller = createPlaylistController()
    controller.addPaths([A, B, C])
    controller.moveEntry(0, 2)
    expect(controller.getState().playlist.entries).toEqual([B, C, A])
    controller.removeAt(1)
    expect(controller.getState().playlist.entries).toEqual([B, A])
    controller.clear()
    expect(controller.getState().playlist.entries).toEqual([])
  })
})

describe('playlist controller — add-and-maybe-play', () => {
  it('auto-starts entry 0 (load then play once) when the empty queue is idle', async () => {
    const controller = createPlaylistController()
    const { deps, load, play } = okLoad()

    const started = await controller.addPathsAndMaybePlay([A, B, C], false, deps)

    expect(started).toBe(true)
    expect(load).toHaveBeenCalledTimes(1)
    expect(load).toHaveBeenCalledWith(A)
    expect(play).toHaveBeenCalledTimes(1)
    expect(controller.getState().playlist.currentIndex).toBe(0)
  })

  it('only appends (never loads) when the queue already holds entries', async () => {
    const controller = createPlaylistController()
    controller.addPaths([A, B])
    const { deps, load } = okLoad()

    const started = await controller.addPathsAndMaybePlay([C], false, deps)

    expect(started).toBe(false)
    expect(load).not.toHaveBeenCalled()
    expect(controller.getState().playlist.entries).toEqual([A, B, C])
  })

  it('only appends (never loads) when something is already playing', async () => {
    const controller = createPlaylistController()
    const { deps, load } = okLoad()

    const started = await controller.addPathsAndMaybePlay([A, B], true, deps)

    expect(started).toBe(false)
    expect(load).not.toHaveBeenCalled()
    expect(controller.getState().playlist.entries).toEqual([A, B])
  })

  it('honours shuffle: starts order[0], not entries[0]', async () => {
    // reverseRng => shuffled([0,1,2]) = [1,2,0], so order[0] is entry 1 (B).
    const controller = createPlaylistController(vi.fn(() => 0))
    controller.setShuffle(true)
    const { deps, load } = okLoad()

    const started = await controller.addPathsAndMaybePlay([A, B, C], false, deps)

    expect(started).toBe(true)
    expect(controller.getState().playlist.order[0]).toBe(1)
    expect(load).toHaveBeenCalledTimes(1)
    expect(load).toHaveBeenCalledWith(B)
    expect(controller.getState().playlist.currentIndex).toBe(1)
  })

  it('skips a broken first entry and starts the next playable one', async () => {
    const controller = createPlaylistController()
    const { deps, load } = failingLoad([A])

    const started = await controller.addPathsAndMaybePlay([A, B, C], false, deps)

    expect(started).toBe(true)
    expect(load.mock.calls.map((call) => call[0])).toEqual([A, B])
    expect(controller.getState().missing).toEqual([0])
    expect(controller.getState().playlist.currentIndex).toBe(1)
  })

  it('is a no-op returning false for an empty path list', async () => {
    const controller = createPlaylistController()
    const { deps, load } = okLoad()

    const started = await controller.addPathsAndMaybePlay([], false, deps)

    expect(started).toBe(false)
    expect(load).not.toHaveBeenCalled()
    expect(controller.getState().playlist.entries).toEqual([])
  })
})

describe('playlist controller — explicit navigation', () => {
  it('playAt loads the entry and marks it current', async () => {
    const controller = createPlaylistController()
    controller.addPaths([A, B, C])
    const { deps, load } = okLoad()

    await controller.playAt(1, deps)

    expect(load).toHaveBeenCalledWith(B)
    expect(controller.getState().playlist.currentIndex).toBe(1)
  })

  it('advances normally over an http(s) URL entry', async () => {
    const url = 'https://host/stream.m3u8'
    const controller = createPlaylistController()
    controller.addPaths([A, url, C])
    const { deps, load } = okLoad()

    await controller.playAt(1, deps)
    expect(load).toHaveBeenCalledWith(url)
    expect(controller.getState().playlist.currentIndex).toBe(1)

    await controller.next(deps)
    expect(controller.getState().playlist.currentIndex).toBe(2)
  })

  it('playAt ignores an out-of-range index without loading', async () => {
    const controller = createPlaylistController()
    controller.addPaths([A])
    const { deps, load } = okLoad()

    await controller.playAt(5, deps)

    expect(load).not.toHaveBeenCalled()
  })

  it('next/prev walk display order', async () => {
    const controller = createPlaylistController()
    controller.addPaths([A, B, C])
    const { deps, load, play } = okLoad()

    await controller.playAt(0, deps)
    await controller.next(deps)
    expect(controller.getState().playlist.currentIndex).toBe(1)
    await controller.prev(deps)
    expect(controller.getState().playlist.currentIndex).toBe(0)
    expect(load.mock.calls.map((call) => call[0])).toEqual([A, B, A])
    expect(play).not.toHaveBeenCalled()
  })

  it('explicit next always advances even under repeat-one', async () => {
    const controller = createPlaylistController()
    controller.addPaths([A, B])
    controller.setRepeat('one')
    const { deps } = okLoad()

    await controller.playAt(0, deps)
    await controller.next(deps)

    expect(controller.getState().playlist.currentIndex).toBe(1)
  })
})

describe('playlist controller — EOF handling', () => {
  it('falls back (returns false) when the queue is empty or has one entry', async () => {
    const controller = createPlaylistController()
    const { deps } = okLoad()
    await expect(controller.handleEof(deps)).resolves.toBe(false)

    controller.addPaths([A])
    await expect(controller.handleEof(deps)).resolves.toBe(false)
  })

  it('advances to the next entry with repeat off, stopping at the end', async () => {
    const controller = createPlaylistController()
    controller.addPaths([A, B])
    const { deps, load, play } = okLoad()

    await controller.playAt(0, deps)
    await expect(controller.handleEof(deps)).resolves.toBe(true)
    expect(controller.getState().playlist.currentIndex).toBe(1)
    expect(play).toHaveBeenCalledTimes(1)

    load.mockClear()
    // At the end with repeat off: handled (no folder-advance) but nothing loads.
    await expect(controller.handleEof(deps)).resolves.toBe(true)
    expect(load).not.toHaveBeenCalled()
  })

  it('replays the current entry under repeat-one', async () => {
    const controller = createPlaylistController()
    controller.addPaths([A, B])
    controller.setRepeat('one')
    const { deps, load, play } = okLoad()

    await controller.playAt(0, deps)
    load.mockClear()
    await controller.handleEof(deps)

    expect(load).toHaveBeenCalledWith(A)
    expect(play).toHaveBeenCalledTimes(1)
    expect(controller.getState().playlist.currentIndex).toBe(0)
  })

  it('wraps to the first entry under repeat-all', async () => {
    const controller = createPlaylistController()
    controller.addPaths([A, B])
    controller.setRepeat('all')
    const { deps, play } = okLoad()

    await controller.playAt(1, deps) // last entry
    await controller.handleEof(deps)

    expect(controller.getState().playlist.currentIndex).toBe(0)
    expect(play).toHaveBeenCalledTimes(1)
  })

  it('reshuffles on a repeat-all wrap so the next pass is a new order', async () => {
    // rng that forces Fisher–Yates to reverse a 3-item list.
    const reverseRng = vi.fn(() => 0)
    const controller = createPlaylistController(reverseRng)
    controller.addPaths([A, B, C])
    const { deps, play } = okLoad()
    controller.setShuffle(true)
    controller.setRepeat('all')

    const orderBefore = [...controller.getState().playlist.order]
    // Drive to the last position of the current shuffled order.
    await controller.playAt(orderBefore[orderBefore.length - 1], deps)
    await controller.handleEof(deps)

    // A fresh permutation was drawn (reshuffle called rng again); the current
    // index is the head of the new order.
    const stateAfter = controller.getState().playlist
    expect(stateAfter.currentIndex).toBe(stateAfter.order[0])
    expect(play).toHaveBeenCalledTimes(1)
  })
})

describe('playlist controller — missing-file skip', () => {
  it('skips forward over a missing entry and marks it missing', async () => {
    const controller = createPlaylistController()
    controller.addPaths([A, B, C])
    const { deps, load } = failingLoad([B])

    await controller.playAt(1, deps)

    // B failed → skipped to C, which opened.
    expect(load.mock.calls.map((call) => call[0])).toEqual([B, C])
    expect(controller.getState().playlist.currentIndex).toBe(2)
    expect(controller.getState().missing).toEqual([1])
  })

  it('stops after one full pass when every entry is unplayable', async () => {
    const controller = createPlaylistController()
    controller.addPaths([A, B])
    controller.setRepeat('all')
    const { deps, load } = failingLoad([A, B])

    await controller.playAt(0, deps)

    // Bounded to entries.length attempts — never spins forever under repeat-all.
    expect(load).toHaveBeenCalledTimes(2)
    expect(controller.getState().missing).toEqual([0, 1])
  })

  it('clears the missing flag once an entry loads, and all flags when the list changes', async () => {
    const controller = createPlaylistController()
    controller.addPaths([A, B, C])
    const missing = failingLoad([B])

    await controller.playAt(1, missing.deps)
    expect(controller.getState().missing).toEqual([1])

    // Reordering the list invalidates index-based missing flags.
    controller.moveEntry(0, 1)
    expect(controller.getState().missing).toEqual([])
  })

  it('stops a skip pass when the playlist is cleared during an awaited load', async () => {
    const controller = createPlaylistController()
    controller.addPaths([A, B, C])
    const load = vi.fn(async (filePath: string): Promise<OpenMediaResult> => {
      controller.clear()
      return { status: 'failed', filePath, message: 'open failed' }
    })

    await controller.playAt(1, { load, play: vi.fn(async () => undefined) })

    expect(load.mock.calls.map((call) => call[0])).toEqual([B])
    expect(controller.getState().playlist.currentIndex).toBe(-1)
  })

  it('does not extend a skip pass into entries added during an awaited load', async () => {
    const controller = createPlaylistController()
    controller.addPaths([A])
    const load = vi.fn(async (filePath: string): Promise<OpenMediaResult> => {
      controller.addPaths([B])
      return { status: 'failed', filePath, message: 'open failed' }
    })

    await controller.playAt(0, { load, play: vi.fn(async () => undefined) })

    expect(load.mock.calls.map((call) => call[0])).toEqual([A])
    expect(controller.getState().playlist.entries).toEqual([A, B])
    expect(controller.getState().playlist.currentIndex).toBe(0)
  })
})
