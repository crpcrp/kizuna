import { describe, expect, it, vi } from 'vitest'
import {
  createRecentFilesController,
  type BannerTimer,
  type RecentFilesBridge
} from '@src/renderer/src/state/recentFilesController'
import { type OpenSession } from '@src/renderer/src/state/mediaSession'
import type { Track } from '@src/shared/track'
import type { Cue } from '@src/shared/cue'
import type { RecentMediaFile } from '@src/shared/mediaHistory'
import type { FileAvailability } from '@src/shared/preloadApi'

const audioTrack: Track = { id: 1, kind: 'audio', codec: 'aac' }
const subtitleTrack: Track = { id: 2, kind: 'subtitle', codec: 'ass' }
const recent = (path: string, openedAt = 1): RecentMediaFile => ({ path, openedAt })

interface Deferred<T> {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (err: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (err: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** Fake `BannerTimer` whose handles fire only via explicit `run` — and never
 * after `clear`, mirroring real setTimeout/clearTimeout — so the controller's
 * auto-dismiss cancellation logic is exercised without a real clock. */
function fakeBannerTimer(): BannerTimer & { run(handle: unknown): void; pending(): unknown[] } {
  let nextHandle = 1
  const callbacks = new Map<number, () => void>()
  const cancelled = new Set<number>()
  return {
    set(callback) {
      const handle = nextHandle++
      callbacks.set(handle, callback)
      return handle
    },
    clear(handle) {
      cancelled.add(handle as number)
    },
    run(handle) {
      if (cancelled.has(handle as number)) return
      callbacks.get(handle as number)?.()
    },
    pending() {
      return [...callbacks.keys()].filter((handle) => !cancelled.has(handle))
    }
  }
}

function makeSession(
  bridge: RecentFilesBridge,
  overrides: Partial<OpenSession> = {}
): OpenSession & { bridge: RecentFilesBridge } {
  return {
    dispatch: vi.fn(),
    subtitleToken: { current: 0 },
    cueCache: new Map(),
    fileToken: { current: 0 },
    ...overrides,
    bridge
  }
}

function makeBridge(
  overrides: {
    getRecentFiles?: () => Promise<RecentMediaFile[]>
    clearRecentFiles?: () => Promise<void>
    openFile?: () => Promise<string | undefined>
    checkFileAvailability?: (path: string) => Promise<FileAvailability>
    removeRecentFile?: (path: string) => Promise<RecentMediaFile[]>
  } = {}
): RecentFilesBridge {
  return {
    media: {
      openFile: vi.fn(overrides.openFile ?? (() => Promise.resolve('/video.mkv'))),
      enumerateTracks: vi.fn().mockResolvedValue([audioTrack]),
      loadSubtitle: vi.fn().mockResolvedValue([]),
      loadExternalSubtitle: vi.fn().mockResolvedValue([])
    },
    player: {
      load: vi.fn().mockResolvedValue(undefined),
      setAudioTrack: vi.fn().mockResolvedValue(undefined),
      seek: vi.fn().mockResolvedValue(undefined)
    },
    mediaHistory: {
      getPlaybackHistory: vi.fn().mockResolvedValue(undefined),
      setAudioTrack: vi.fn().mockResolvedValue(undefined),
      setSubtitleTrack: vi.fn().mockResolvedValue(undefined),
      getRecentFiles: vi.fn(overrides.getRecentFiles ?? (() => Promise.resolve([]))),
      clearRecentFiles: vi.fn(overrides.clearRecentFiles ?? (() => Promise.resolve(undefined))),
      checkFileAvailability: vi.fn(
        overrides.checkFileAvailability ??
          (() => Promise.resolve({ status: 'available' } as FileAvailability))
      ),
      removeRecentFile: vi.fn(overrides.removeRecentFile ?? (() => Promise.resolve([])))
    }
  }
}

describe('recentFilesController init', () => {
  it('populates the recent-files list on success', async () => {
    const controller = createRecentFilesController()
    const bridge = makeBridge({ getRecentFiles: () => Promise.resolve([recent('/a.mkv')]) })
    await controller.init(bridge)
    expect(controller.getState().recentFiles).toEqual([recent('/a.mkv')])
    expect(controller.getState().errorMessage).toBeUndefined()
  })

  it('clears the list and sets a sanitized error on failure', async () => {
    const controller = createRecentFilesController()
    const bridge = makeBridge({ getRecentFiles: () => Promise.reject(new Error('disk error')) })
    await controller.init(bridge)
    expect(controller.getState().recentFiles).toEqual([])
    expect(controller.getState().errorMessage).toBe('disk error')
  })
})

describe('recentFilesController openPicker', () => {
  it('toggles mediaOpening around the call and refreshes recents after a successful open', async () => {
    const controller = createRecentFilesController()
    const bridge = makeBridge({ getRecentFiles: () => Promise.resolve([recent('/video.mkv')]) })
    const seen: boolean[] = []
    controller.subscribe(() => seen.push(controller.getState().mediaOpening))

    const result = await controller.openPicker(makeSession(bridge))

    expect(result.status).toBe('opened')
    expect(seen[0]).toBe(true)
    expect(seen.at(-1)).toBe(false)
    expect(controller.getState().mediaOpening).toBe(false)
    expect(controller.getState().recentFiles).toEqual([recent('/video.mkv')])
  })

  it('does not touch the recent list or set an error on cancel', async () => {
    const controller = createRecentFilesController()
    const bridge = makeBridge({ openFile: () => Promise.resolve(undefined) })
    const result = await controller.openPicker(makeSession(bridge))
    expect(result).toEqual({ status: 'cancelled' })
    expect(bridge.mediaHistory.getRecentFiles).not.toHaveBeenCalled()
    expect(controller.getState().errorMessage).toBeUndefined()
  })

  it('surfaces a failed load as the error message', async () => {
    const controller = createRecentFilesController()
    const bridge = makeBridge()
    ;(bridge.player.load as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('mpv refused'))
    const result = await controller.openPicker(makeSession(bridge))
    expect(result.status).toBe('failed')
    expect(controller.getState().errorMessage).toBe('mpv refused')
    expect(controller.getState().mediaOpening).toBe(false)
  })
})

describe('recentFilesController openRecent', () => {
  it('refreshes the list and reports the message after a confirmed-missing recent', async () => {
    const controller = createRecentFilesController()
    const bridge = makeBridge({
      checkFileAvailability: () => Promise.resolve({ status: 'missing' }),
      getRecentFiles: () => Promise.resolve([])
    })
    const result = await controller.openRecent(makeSession(bridge), '/gone.mkv')
    expect(result.status).toBe('missing')
    expect(bridge.mediaHistory.removeRecentFile).toHaveBeenCalledWith('/gone.mkv')
    expect(controller.getState().recentFiles).toEqual([])
    expect(controller.getState().errorMessage).toBe('This file could no longer be found.')
  })

  it('retains the list and reports a transient availability error', async () => {
    const controller = createRecentFilesController()
    const bridge = makeBridge({
      checkFileAvailability: () =>
        Promise.resolve({ status: 'error', message: 'Permission denied' }),
      getRecentFiles: () => Promise.resolve([recent('/still-there.mkv')])
    })
    await controller.init(bridge)
    const result = await controller.openRecent(makeSession(bridge), '/still-there.mkv')
    expect(result.status).toBe('failed')
    expect(bridge.mediaHistory.removeRecentFile).not.toHaveBeenCalled()
    expect(controller.getState().recentFiles).toEqual([recent('/still-there.mkv')])
    expect(controller.getState().errorMessage).toBe('Permission denied')
  })
})

describe('recentFilesController openPath', () => {
  it('opens a dropped path without an availability check, refreshing recents', async () => {
    const controller = createRecentFilesController()
    const bridge = makeBridge({ getRecentFiles: () => Promise.resolve([recent('/dropped.mkv')]) })
    const seen: boolean[] = []
    controller.subscribe(() => seen.push(controller.getState().mediaOpening))

    const result = await controller.openPath(makeSession(bridge), '/dropped.mkv')

    expect(result).toMatchObject({ status: 'opened', filePath: '/dropped.mkv' })
    expect(bridge.mediaHistory.checkFileAvailability).not.toHaveBeenCalled()
    expect(bridge.media.openFile).not.toHaveBeenCalled()
    expect(seen[0]).toBe(true)
    expect(seen.at(-1)).toBe(false)
    expect(controller.getState().recentFiles).toEqual([recent('/dropped.mkv')])
  })

  it('surfaces a failed load as the error message and clears the opening guard', async () => {
    const controller = createRecentFilesController()
    const bridge = makeBridge()
    ;(bridge.player.load as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('mpv refused'))

    const result = await controller.openPath(makeSession(bridge), '/dropped.mkv')

    expect(result.status).toBe('failed')
    expect(controller.getState().errorMessage).toBe('mpv refused')
    expect(controller.getState().mediaOpening).toBe(false)
  })
})

describe('recentFilesController openPath/openPicker via OpenSession', () => {
  it('opens a dropped path from an OpenSession, refreshing recents', async () => {
    const controller = createRecentFilesController()
    const bridge = makeBridge({ getRecentFiles: () => Promise.resolve([recent('/dropped.mkv')]) })

    const result = await controller.openPath(makeSession(bridge), '/dropped.mkv')

    expect(result).toMatchObject({ status: 'opened', filePath: '/dropped.mkv' })
    expect(bridge.mediaHistory.checkFileAvailability).not.toHaveBeenCalled()
    expect(controller.getState().recentFiles).toEqual([recent('/dropped.mkv')])
  })

  it('opens the picker from an OpenSession, refreshing recents', async () => {
    const controller = createRecentFilesController()
    const bridge = makeBridge({ getRecentFiles: () => Promise.resolve([recent('/video.mkv')]) })

    const result = await controller.openPicker(makeSession(bridge))

    expect(result.status).toBe('opened')
    expect(controller.getState().recentFiles).toEqual([recent('/video.mkv')])
  })

  it('refuses an openPath started while an openPicker is in flight', async () => {
    const controller = createRecentFilesController()
    const picked = deferred<string | undefined>()
    const bridge = makeBridge({ openFile: () => picked.promise })

    const picker = controller.openPicker(makeSession(bridge))
    const blocked = await controller.openPath(makeSession(bridge), '/dropped.mkv')

    expect(blocked).toEqual({ status: 'busy' })
    picked.resolve('/picked.mkv')
    await picker
  })
})

describe('recentFilesController subtitle encoding', () => {
  it('forwards a non-default encoding through picker, recent, and dropped-path opens', async () => {
    const cases = [
      (controller: ReturnType<typeof createRecentFilesController>, bridge: RecentFilesBridge) =>
        controller.openPicker(makeSession(bridge, { externalSubtitleEncoding: 'shift_jis' })),
      (controller: ReturnType<typeof createRecentFilesController>, bridge: RecentFilesBridge) =>
        controller.openRecent(
          makeSession(bridge, { externalSubtitleEncoding: 'shift_jis' }),
          '/recent.mkv'
        ),
      (controller: ReturnType<typeof createRecentFilesController>, bridge: RecentFilesBridge) =>
        controller.openPath(
          makeSession(bridge, { externalSubtitleEncoding: 'shift_jis' }),
          '/dropped.mkv'
        )
    ]

    for (const open of cases) {
      const controller = createRecentFilesController()
      const bridge = makeBridge()
      ;(bridge.mediaHistory.getPlaybackHistory as ReturnType<typeof vi.fn>).mockResolvedValue({
        positionSeconds: 0,
        updatedAt: 1,
        subtitle: { mode: 'external', path: '/subs/episode.srt' }
      })

      await open(controller, bridge)

      expect(bridge.media.loadExternalSubtitle).toHaveBeenCalledWith(
        '/subs/episode.srt',
        'shift_jis'
      )
    }
  })
})

describe('recentFilesController open exclusion', () => {
  it('refuses a second openPath started in the same frame as busy, loading only once', async () => {
    const controller = createRecentFilesController()
    const load = deferred<void>()
    const bridge = makeBridge()
    ;(bridge.player.load as ReturnType<typeof vi.fn>).mockReturnValue(load.promise)

    const first = controller.openPath(makeSession(bridge), '/first.mkv')
    const second = await controller.openPath(makeSession(bridge), '/second.mkv')

    expect(second).toEqual({ status: 'busy' })
    // A refused open reports nothing and overwrites nothing.
    expect(controller.getState().errorMessage).toBeUndefined()
    expect(controller.getState().mediaOpening).toBe(true)

    await vi.waitFor(() => expect(bridge.player.load).toHaveBeenCalled())
    expect(bridge.player.load).toHaveBeenCalledTimes(1)
    expect(bridge.player.load).toHaveBeenCalledWith('/first.mkv')

    load.resolve(undefined)
    await expect(first).resolves.toMatchObject({ status: 'opened', filePath: '/first.mkv' })
  })

  it('releases the guard when the in-flight open rejects, so a later open can start', async () => {
    const controller = createRecentFilesController()
    const load = deferred<void>()
    const bridge = makeBridge()
    ;(bridge.player.load as ReturnType<typeof vi.fn>).mockReturnValueOnce(load.promise)

    const first = controller.openPath(makeSession(bridge), '/first.mkv')
    expect(await controller.openPath(makeSession(bridge), '/second.mkv')).toEqual({
      status: 'busy'
    })

    load.reject(new Error('mpv refused'))
    expect(await first).toMatchObject({ status: 'failed' })
    expect(controller.getState().mediaOpening).toBe(false)

    const third = await controller.openPath(makeSession(bridge), '/third.mkv')

    expect(third).toMatchObject({ status: 'opened', filePath: '/third.mkv' })
    expect(bridge.player.load).toHaveBeenLastCalledWith('/third.mkv')
  })

  it('blocks openRecent while an openPicker is in flight', async () => {
    const controller = createRecentFilesController()
    const picked = deferred<string | undefined>()
    const bridge = makeBridge({ openFile: () => picked.promise })

    const picker = controller.openPicker(makeSession(bridge))
    const blocked = await controller.openRecent(makeSession(bridge), '/recent.mkv')

    expect(blocked).toEqual({ status: 'busy' })
    expect(bridge.mediaHistory.checkFileAvailability).not.toHaveBeenCalled()
    expect(bridge.player.load).not.toHaveBeenCalled()

    picked.resolve('/picked.mkv')
    expect(await picker).toMatchObject({ status: 'opened', filePath: '/picked.mkv' })
    expect(bridge.player.load).toHaveBeenCalledTimes(1)
    expect(bridge.player.load).toHaveBeenCalledWith('/picked.mkv')
  })
})

describe('recentFilesController late subtitle-restoration warnings', () => {
  /** A bridge whose only subtitle track's extraction is under the test's control. */
  function makeSubtitleBridge(overrides: Parameters<typeof makeBridge>[0] = {}): {
    bridge: RecentFilesBridge
    extraction: Deferred<Cue[]>
  } {
    const bridge = makeBridge(overrides)
    const extraction = deferred<Cue[]>()
    ;(bridge.media.enumerateTracks as ReturnType<typeof vi.fn>).mockResolvedValue([
      audioTrack,
      subtitleTrack
    ])
    ;(bridge.media.loadSubtitle as ReturnType<typeof vi.fn>).mockReturnValue(extraction.promise)
    return { bridge, extraction }
  }

  it('shows a subtitle extraction failure that lands after the open already succeeded', async () => {
    const controller = createRecentFilesController()
    const { bridge, extraction } = makeSubtitleBridge()

    const result = await controller.openPath(makeSession(bridge), '/dropped.mkv')

    expect(result).toMatchObject({ status: 'opened', warnings: [] })
    expect(controller.getState().errorMessage).toBeUndefined()

    extraction.reject(new Error('ffmpeg failed'))

    await vi.waitFor(() => expect(controller.getState().errorMessage).toBe('ffmpeg failed'))
    expect(controller.getState().mediaOpening).toBe(false)
  })

  it('does not clear a warning that arrives while the open result is still being applied', async () => {
    const controller = createRecentFilesController()
    const listing = deferred<RecentMediaFile[]>()
    const { bridge, extraction } = makeSubtitleBridge({ getRecentFiles: () => listing.promise })

    const open = controller.openPath(makeSession(bridge), '/dropped.mkv')
    // The open resolved and is now awaiting its recents refresh — the point at
    // which it would otherwise overwrite the banner with its own empty warnings.
    await vi.waitFor(() => expect(bridge.mediaHistory.getRecentFiles).toHaveBeenCalled())
    extraction.reject(new Error('ffmpeg failed'))
    await vi.waitFor(() => expect(controller.getState().errorMessage).toBe('ffmpeg failed'))

    listing.resolve([recent('/dropped.mkv')])
    await open

    expect(controller.getState().errorMessage).toBe('ffmpeg failed')
    expect(controller.getState().recentFiles).toEqual([recent('/dropped.mkv')])
  })

  it('reports the failure for a recent-file open too', async () => {
    const controller = createRecentFilesController()
    const { bridge, extraction } = makeSubtitleBridge()

    await controller.openRecent(makeSession(bridge), '/recent.mkv')
    extraction.reject(new Error('ffmpeg failed'))

    await vi.waitFor(() => expect(controller.getState().errorMessage).toBe('ffmpeg failed'))
  })
})

describe('recentFilesController reportError', () => {
  it('shows the message in the error banner, and dismissError clears it', () => {
    const controller = createRecentFilesController()

    controller.reportError('Unsupported file type.')
    expect(controller.getState().errorMessage).toBe('Unsupported file type.')

    controller.dismissError()
    expect(controller.getState().errorMessage).toBeUndefined()
  })
})

describe('recentFilesController reportTransient', () => {
  it('shows the message immediately, defaulting to a 1000ms auto-dismiss', () => {
    const timer = fakeBannerTimer()
    const controller = createRecentFilesController(timer)

    controller.reportTransient('Screenshot saved: /a.png')
    expect(controller.getState().errorMessage).toBe('Screenshot saved: /a.png')

    const [handle] = timer.pending()
    timer.run(handle)
    expect(controller.getState().errorMessage).toBeUndefined()
  })

  it('honors a custom ttlMs', () => {
    const timer = fakeBannerTimer()
    const setSpy = vi.spyOn(timer, 'set')
    const controller = createRecentFilesController(timer)

    controller.reportTransient('Screenshot saved: /a.png', 2500)

    expect(setSpy).toHaveBeenCalledWith(expect.any(Function), 2500)
  })

  it('gives a second transient message its own full display time, cancelling the first timer', () => {
    const timer = fakeBannerTimer()
    const controller = createRecentFilesController(timer)

    controller.reportTransient('Screenshot saved: /a.png')
    const first = timer.pending()[0]

    controller.reportTransient('Screenshot saved: /b.png')
    expect(timer.pending()).not.toContain(first)

    // The stale first timer firing is a no-op: cancelled timers never invoke
    // their callback, matching real clearTimeout semantics.
    timer.run(first)
    expect(controller.getState().errorMessage).toBe('Screenshot saved: /b.png')

    timer.run(timer.pending()[0])
    expect(controller.getState().errorMessage).toBeUndefined()
  })

  it('does not let a stale transient timer clear a newer error banner', () => {
    const timer = fakeBannerTimer()
    const controller = createRecentFilesController(timer)

    controller.reportTransient('Screenshot saved: /a.png')
    const pending = timer.pending()[0]

    controller.reportError('mpv: no video')
    timer.run(pending)

    expect(controller.getState().errorMessage).toBe('mpv: no video')
  })

  it('does not let a stale transient timer clear a message set by reportError beforehand and dismissError', () => {
    const timer = fakeBannerTimer()
    const controller = createRecentFilesController(timer)

    controller.reportTransient('Screenshot saved: /a.png')
    const pending = timer.pending()[0]

    controller.dismissError()
    timer.run(pending)

    expect(controller.getState().errorMessage).toBeUndefined()
  })
})

describe('recentFilesController dispose', () => {
  it('cancels a pending transient timer so it never clears the banner', () => {
    const timer = fakeBannerTimer()
    const controller = createRecentFilesController(timer)

    controller.reportTransient('Screenshot saved: /a.png')
    const pending = timer.pending()[0]

    controller.dispose()
    timer.run(pending)

    expect(controller.getState().errorMessage).toBe('Screenshot saved: /a.png')
  })

  it('is a no-op when nothing is pending', () => {
    const timer = fakeBannerTimer()
    const controller = createRecentFilesController(timer)
    expect(() => controller.dispose()).not.toThrow()
  })
})

describe('recentFilesController clearRecent', () => {
  it('empties the list and clears any error on success', async () => {
    const controller = createRecentFilesController()
    const bridge = makeBridge({ getRecentFiles: () => Promise.resolve([recent('/a.mkv')]) })
    await controller.init(bridge)
    await controller.clearRecent(bridge)
    expect(controller.getState().recentFiles).toEqual([])
    expect(controller.getState().errorMessage).toBeUndefined()
  })

  it('retains the displayed list and warns on failure', async () => {
    const controller = createRecentFilesController()
    const bridge = makeBridge({
      getRecentFiles: () => Promise.resolve([recent('/a.mkv')]),
      clearRecentFiles: () => Promise.reject(new Error('write failed'))
    })
    await controller.init(bridge)
    await controller.clearRecent(bridge)
    expect(controller.getState().recentFiles).toEqual([recent('/a.mkv')])
    expect(controller.getState().errorMessage).toBe('write failed')
  })
})

describe('recentFilesController dismissError', () => {
  it('clears the error message without touching the list', async () => {
    const controller = createRecentFilesController()
    const bridge = makeBridge({ getRecentFiles: () => Promise.reject(new Error('boom')) })
    await controller.init(bridge)
    expect(controller.getState().errorMessage).toBe('boom')
    controller.dismissError()
    expect(controller.getState().errorMessage).toBeUndefined()
    expect(controller.getState().recentFiles).toEqual([])
  })
})
