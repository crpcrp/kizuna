import { describe, expect, it, vi } from 'vitest'
import { createMediaHistoryService, type MediaHistoryTimers } from '@src/main/services/mediaHistory'
import {
  MAX_PLAYBACK_ENTRIES,
  normalizeMediaHistory,
  type MediaHistory
} from '@src/shared/mediaHistory'
import type { Settings, SettingsStore } from '@src/main/services/settings'

const paths = { platform: 'posix' as const, cwd: '/media' }

function fakeSettings(
  initial?: MediaHistory,
  failWrites = false
): { store: SettingsStore; writes: () => number } {
  let mediaHistory = normalizeMediaHistory(initial, paths)
  let writeCount = 0
  const store: SettingsStore = {
    get: () => ({ mediaHistory }) as Settings,
    set: (patch) => {
      writeCount += 1
      if (failWrites) throw new Error('disk unavailable')
      mediaHistory = patch.mediaHistory ?? mediaHistory
      return { mediaHistory } as Settings
    }
  }
  return { store, writes: () => writeCount }
}

function fakeTimers(): {
  timers: MediaHistoryTimers
  lastHandle(): number | undefined
  runNext(): void
  forceRun(handle: number): void
  pending(): number
} {
  const callbacks = new Map<number, () => void>()
  const allCallbacks = new Map<number, () => void>()
  let nextId = 0
  return {
    timers: {
      setTimer: vi.fn((callback) => {
        const id = nextId++
        callbacks.set(id, callback)
        allCallbacks.set(id, callback)
        return id
      }),
      clearTimer: vi.fn((handle) => callbacks.delete(handle as number))
    },
    lastHandle: () => (nextId === 0 ? undefined : nextId - 1),
    runNext: () => {
      const entry = callbacks.entries().next().value as [number, () => void] | undefined
      if (!entry) return
      callbacks.delete(entry[0])
      entry[1]()
    },
    forceRun: (handle) => allCallbacks.get(handle)?.(),
    pending: () => callbacks.size
  }
}

function service(initial?: MediaHistory, failWrites = false) {
  const settings = fakeSettings(initial, failWrites)
  const clock = vi
    .fn()
    .mockReturnValueOnce(10)
    .mockReturnValueOnce(20)
    .mockReturnValueOnce(30)
    .mockReturnValue(40)
  const timer = fakeTimers()
  return {
    history: createMediaHistoryService({
      settings: settings.store,
      now: clock,
      timers: timer.timers,
      pathOptions: paths
    }),
    settings,
    timer
  }
}

describe('createMediaHistoryService', () => {
  it('stores last folder and returns copies of persisted recent and playback data', () => {
    const { history } = service()
    history.setLastOpenFolder('/media/series/../series')
    history.recordOpened('/media/series/episode.mkv')
    history.setAudioTrack('/media/series/episode.mkv', { id: 2, language: 'ja' })

    const recent = history.getRecentFiles()
    recent[0].path = 'changed'
    const playback = history.getPlaybackHistory('/media/series/episode.mkv')!
    playback.audioTrack!.language = 'changed'

    expect(history.getLastOpenFolder()).toBe('/media/series')
    expect(history.getRecentFiles()[0].path).toBe('/media/series/episode.mkv')
    expect(history.getPlaybackHistory('/media/series/episode.mkv')).toMatchObject({
      audioTrack: { language: 'ja' }
    })
  })

  it('ignores malformed paths and observations, including those received without an active file', () => {
    const { history, settings, timer } = service()
    history.setLastOpenFolder('')
    history.observePosition(4)
    history.observeDuration(60)
    history.recordOpened('')
    history.observePosition(-1)
    history.observePosition(Number.POSITIVE_INFINITY)
    history.observePosition('20')
    history.observeDuration(-1)
    history.observeDuration(Number.POSITIVE_INFINITY)

    expect(history.getLastOpenFolder()).toBeUndefined()
    expect(history.getPlaybackHistory('')).toBeUndefined()
    expect(history.removeRecentFile('')).toEqual([])
    expect(settings.writes()).toBe(0)
    expect(timer.pending()).toBe(0)
  })

  it('classifies file availability through the injected filesystem boundary', async () => {
    const settings = fakeSettings()
    const stat = vi.fn<(_path: string) => Promise<{ isFile(): boolean }>>()
    const history = createMediaHistoryService({
      settings: settings.store,
      pathOptions: paths,
      stat
    })

    stat.mockResolvedValueOnce({ isFile: () => true })
    expect(await history.checkFileAvailability('/media/video.mkv')).toEqual({ status: 'available' })
    stat.mockResolvedValueOnce({ isFile: () => false })
    expect(await history.checkFileAvailability('/media/folder')).toEqual({ status: 'missing' })
    stat.mockRejectedValueOnce(Object.assign(new Error('missing'), { code: 'ENOENT' }))
    expect(await history.checkFileAvailability('/media/gone.mkv')).toEqual({ status: 'missing' })
    stat.mockRejectedValueOnce(Object.assign(new Error('denied'), { code: 'EACCES' }))
    expect(await history.checkFileAvailability('/media/private.mkv')).toEqual({
      status: 'error',
      message: 'Unable to access this file.'
    })
    expect(await history.checkFileAvailability('')).toEqual({ status: 'missing' })

    // A network URL is always available without touching the filesystem.
    expect(await history.checkFileAvailability('https://host.example/stream.m3u8')).toEqual({
      status: 'available'
    })
    expect(stat).toHaveBeenCalledTimes(4)
  })

  it('records a URL as a recent file and reads it back byte-identical', () => {
    const { history } = service()
    const url = 'https://Host.example/Watch?v=Ab'
    history.recordOpened(url)
    history.observePosition(42)

    expect(history.getRecentFiles()[0].path).toBe(url)
    // The position lookup hits the same key the record was written under.
    history.flush()
    expect(history.getPlaybackHistory(url)).toMatchObject({ positionSeconds: 42 })
  })

  it('reorders and caps recents while preserving playback history when a shortcut is removed or cleared', () => {
    const { history } = service()
    for (let index = 0; index < 6; index += 1) history.recordOpened(`/media/${index}.mkv`)
    history.setSubtitleTrack('/media/0.mkv', { mode: 'off' })
    history.recordOpened('/media/2.mkv')

    expect(history.getRecentFiles().map((entry) => entry.path)).toEqual([
      '/media/2.mkv',
      '/media/5.mkv',
      '/media/4.mkv',
      '/media/3.mkv',
      '/media/1.mkv'
    ])
    expect(history.removeRecentFile('/media/0.mkv')).not.toContainEqual(
      expect.objectContaining({ path: '/media/0.mkv' })
    )
    history.clearRecentFiles()
    expect(history.getRecentFiles()).toEqual([])
    expect(history.getPlaybackHistory('/media/0.mkv')).toMatchObject({ subtitle: { mode: 'off' } })
  })

  it('keeps the active path while a playback mutation prunes the oldest eligible entry', () => {
    // `/media/0` is the oldest entry overall but survives because it is the
    // active path; `/media/1` is the oldest *eligible* (unprotected) entry and
    // is the one pruned. `/media/new` is written with a stale-looking clock
    // value (below both), yet survives because the just-mutated entry is
    // protected from pruning.
    const playbackByPath = Object.fromEntries(
      Array.from({ length: MAX_PLAYBACK_ENTRIES }, (_, index) => [
        `/media/${index}.mkv`,
        { positionSeconds: index, updatedAt: index === 0 ? 0 : index === 1 ? 500 : 1_000 }
      ])
    )
    const { history } = service({ recentFiles: [], playbackByPath })

    history.recordOpened('/media/0.mkv')
    history.clearRecentFiles()
    history.setAudioTrack('/media/new.mkv', { id: 2 })

    expect(history.getPlaybackHistory('/media/0.mkv')).toBeDefined()
    expect(history.getPlaybackHistory('/media/1.mkv')).toBeUndefined()
    expect(history.getPlaybackHistory('/media/new.mkv')).toMatchObject({ audioTrack: { id: 2 } })
  })

  it('merges track selections into a playback entry and ignores malformed paths or tracks', () => {
    const { history, settings } = service()
    history.setAudioTrack('/media/a.mkv', { id: 3, language: 'ja' })
    history.setSubtitleTrack('/media/a.mkv', { mode: 'track', track: { id: 4, title: 'English' } })
    history.setAudioTrack('', { id: 9 })
    history.setSubtitleTrack('/media/a.mkv', { mode: 'track', track: { id: -1 } })

    expect(history.getPlaybackHistory('/media/a.mkv')).toEqual({
      positionSeconds: 0,
      audioTrack: { id: 3, language: 'ja' },
      subtitle: { mode: 'track', track: { id: 4, title: 'English' } },
      updatedAt: 30
    })
    expect(settings.writes()).toBe(2)
  })

  it('stores an external subtitle file under its normalized path and rejects an unusable one', () => {
    const { history } = service()
    history.setSubtitleTrack('/media/a.mkv', {
      mode: 'external',
      path: '/subs/../subs/ep.srt',
      encoding: 'auto'
    })
    expect(history.getPlaybackHistory('/media/a.mkv')).toMatchObject({
      subtitle: { mode: 'external', path: '/subs/ep.srt' }
    })

    // A selection that cannot be normalized must leave the stored one intact,
    // not blank out the file's subtitle.
    history.setSubtitleTrack('/media/a.mkv', { mode: 'external', path: '', encoding: 'auto' })
    expect(history.getPlaybackHistory('/media/a.mkv')).toMatchObject({
      subtitle: { mode: 'external', path: '/subs/ep.srt' }
    })
  })

  it('buffers valid observations, preserves a known duration when mpv emits zero, and accepts backward seeks', () => {
    const { history, timer } = service()
    history.observePosition(5)
    history.recordOpened('/media/a.mkv')
    history.observeDuration(100)
    history.observeDuration(0)
    history.observePosition(70)
    history.observePosition(12)
    history.observeDuration(Number.NaN)
    expect(timer.pending()).toBe(1)

    timer.runNext()
    expect(history.getPlaybackHistory('/media/a.mkv')).toMatchObject({
      positionSeconds: 12,
      durationSeconds: 100
    })
  })

  it('persists a positive duration even before mpv has observed a position', () => {
    const { history, timer } = service()
    history.recordOpened('/media/a.mkv')
    history.observeDuration(100)
    timer.runNext()

    expect(history.getPlaybackHistory('/media/a.mkv')).toMatchObject({
      positionSeconds: 0,
      durationSeconds: 100
    })
  })

  it('flushes before switching files, prevents a stale timer from writing into the new active path, and writes at most once per flush', () => {
    const { history, timer, settings } = service()
    history.recordOpened('/media/a.mkv')
    history.observePosition(25)
    const staleTimer = timer.lastHandle()!
    history.recordOpened('/media/b.mkv')
    history.observePosition(50)
    timer.forceRun(staleTimer)
    const writesAfterSwitch = settings.writes()
    timer.runNext()

    expect(history.getPlaybackHistory('/media/a.mkv')).toMatchObject({ positionSeconds: 25 })
    expect(history.getPlaybackHistory('/media/b.mkv')).toMatchObject({ positionSeconds: 50 })
    expect(settings.writes()).toBe(writesAfterSwitch + 1)
  })

  it('beginLoad flushes the outgoing file and suspends position attribution, so an early spurious position cannot overwrite it', () => {
    const { history, timer } = service()
    history.recordOpened('/media/a.mkv')
    history.observePosition(77)
    history.beginLoad()
    // An early spurious position from mpv loading the next file arrives before recordOpened.
    history.observePosition(0)
    history.recordOpened('/media/b.mkv')

    expect(history.getPlaybackHistory('/media/a.mkv')).toMatchObject({ positionSeconds: 77 })
    expect(timer.pending()).toBe(0)
  })

  it('does not attribute a duration observed during suspension to either file', () => {
    const { history, timer } = service()
    history.recordOpened('/media/a.mkv')
    history.observePosition(77)
    history.beginLoad()
    history.observePath('/media/b.mkv')
    history.observeDuration(120)
    history.recordOpened('/media/b.mkv')

    expect(history.getPlaybackHistory('/media/b.mkv')).toBeUndefined()
    expect(timer.pending()).toBe(0)
    expect(history.getPlaybackHistory('/media/a.mkv')).toMatchObject({ positionSeconds: 77 })
  })

  it('discards a duration buffered during suspension when the load is aborted instead of completed', () => {
    const { history, timer } = service()
    history.recordOpened('/media/a.mkv')
    history.observePosition(30)
    timer.runNext()

    history.beginLoad()
    history.observeDuration(999) // suspended: buffered, but the load never lands
    history.abortLoad()
    timer.runNext()

    // Must not have leaked onto A, and no phantom entry was created either.
    const a = history.getPlaybackHistory('/media/a.mkv')
    expect(a).toMatchObject({ positionSeconds: 30 })
    expect(a?.durationSeconds).toBeUndefined()
  })

  it("round-trips A -> N -> P through beginLoad/recordOpened without corrupting either file's saved position", () => {
    const { history, timer } = service()
    history.recordOpened('/media/a.mkv')
    history.observePosition(90)
    timer.runNext()

    // N: navigate to B. Early spurious zero must not land on A.
    history.beginLoad()
    history.observePosition(0)
    history.recordOpened('/media/b.mkv')
    history.observePosition(15)
    timer.runNext()

    // P: navigate back to A. Early spurious zero must not land on B.
    history.beginLoad()
    history.observePosition(0)
    history.recordOpened('/media/a.mkv')

    expect(history.getPlaybackHistory('/media/a.mkv')).toMatchObject({ positionSeconds: 90 })
    expect(history.getPlaybackHistory('/media/b.mkv')).toMatchObject({ positionSeconds: 15 })
  })

  it('ignores a stale position after recordOpened until mpv reports the destination path', () => {
    const { history, timer } = service()
    history.recordOpened('/media/a.mkv')
    history.observePath('/media/a.mkv')
    history.observePosition(90)
    timer.runNext()

    history.beginLoad()
    history.recordOpened('/media/b.mkv')
    history.observePosition(90) // stale A/URL position after B became active
    expect(timer.pending()).toBe(0)
    history.observePath('/media/b.mkv')
    history.observePosition(12)
    timer.runNext()

    expect(history.getPlaybackHistory('/media/a.mkv')).toMatchObject({ positionSeconds: 90 })
    expect(history.getPlaybackHistory('/media/b.mkv')).toMatchObject({ positionSeconds: 12 })
  })

  it('abortLoad resumes tracking of the still-active file under its existing key after a rejected load command', () => {
    const { history, timer } = service()
    history.recordOpened('/media/a.mkv')
    history.observePosition(30)
    timer.runNext()

    history.beginLoad()
    history.observePosition(999) // suspended: must be ignored
    history.abortLoad()
    history.observePosition(45) // resumed tracking of A
    timer.runNext()

    expect(history.getPlaybackHistory('/media/a.mkv')).toMatchObject({ positionSeconds: 45 })
  })

  it('propagates settings write failures and dispose cancels its timer', () => {
    const { history } = service(undefined, true)
    expect(() => history.recordOpened('/media/a.mkv')).toThrow('disk unavailable')

    const working = service()
    working.history.recordOpened('/media/a.mkv')
    working.history.observePosition(20)
    expect(() => working.history.dispose()).not.toThrow()
    expect(working.timer.pending()).toBe(0)
  })
})
