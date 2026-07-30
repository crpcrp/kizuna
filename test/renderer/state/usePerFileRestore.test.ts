// @vitest-environment happy-dom
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { initialPlayerState } from '@src/renderer/src/state/playerState'
import {
  usePerFileRestore,
  type UsePerFileRestoreInput
} from '@src/renderer/src/state/usePerFileRestore'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

function setup(
  filePath = '/one.mkv',
  playerGetVideoDimensions: () => Promise<{ width: number; height: number } | undefined> = () =>
    new Promise(() => {})
) {
  const dimensions = deferred<{ width: number; height: number } | undefined>()
  const chapters = deferred<never[]>()
  const dispatch = vi.fn()
  const bridge = {
    player: {
      setSpeed: vi.fn().mockResolvedValue(undefined),
      setAudioDelay: vi.fn().mockResolvedValue(undefined),
      setLoudnessNorm: vi.fn().mockResolvedValue(undefined),
      setAbLoop: vi.fn().mockResolvedValue(undefined),
      setVideoAdjustments: vi.fn().mockResolvedValue(undefined),
      getVideoDimensions: vi.fn(playerGetVideoDimensions)
    },
    media: {
      getVideoDimensions: vi
        .fn()
        .mockReturnValueOnce(dimensions.promise)
        .mockReturnValue(new Promise(() => {})),
      getChapters: vi
        .fn()
        .mockReturnValueOnce(chapters.promise)
        .mockReturnValue(new Promise(() => {}))
    }
  }
  const input: UsePerFileRestoreInput = {
    dispatch,
    bridge,
    filePath,
    loadGeneration: 1,
    settingsReady: true,
    playbackSettingsRef: { current: initialPlayerState },
    subtitleOffsetsRef: { current: {} },
    folderSubtitleOffsetsRef: { current: {} },
    audioDelaysRef: { current: {} },
    videoAdjustmentsRef: { current: initialPlayerState.videoAdjustments },
    reapplyAudioDevice: vi.fn(),
    setVideoDimensions: vi.fn()
  }
  const hook = renderHook(({ value }) => usePerFileRestore(value), {
    initialProps: { value: input }
  })
  return { input, hook, bridge, dimensions, chapters, dispatch }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('usePerFileRestore', () => {
  it('starts restoration and probes for the destination path', () => {
    const result = setup()
    expect(result.bridge.player.setSpeed).toHaveBeenCalledWith(1)
    expect(result.bridge.player.setAbLoop).toHaveBeenCalledWith(null, null)
    expect(result.bridge.media.getVideoDimensions).toHaveBeenCalledWith('/one.mkv')
    expect(result.bridge.media.getChapters).toHaveBeenCalledWith('/one.mkv')
  })

  it('reads dimensions from ffprobe (media), never mpv, for a local path', () => {
    const result = setup()
    expect(result.bridge.media.getVideoDimensions).toHaveBeenCalledWith('/one.mkv')
    expect(result.bridge.player.getVideoDimensions).not.toHaveBeenCalled()
  })

  it('reads dimensions from mpv (player), never ffprobe, for a remote URL', () => {
    const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
    const result = setup(url, () => Promise.resolve({ width: 1280, height: 720 }))
    expect(result.bridge.player.getVideoDimensions).toHaveBeenCalledTimes(1)
    expect(result.bridge.media.getVideoDimensions).not.toHaveBeenCalled()
  })

  it('retries the mpv read on the URL path until one resolves a value', async () => {
    vi.useFakeTimers()
    try {
      const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
      const player = vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockResolvedValueOnce(undefined)
        .mockResolvedValue({ width: 640, height: 360 })
      const result = setup(url, player)
      // First read (mount) resolved undefined; drain it, then advance the timer.
      await vi.advanceTimersByTimeAsync(0)
      expect(player).toHaveBeenCalledTimes(1)
      expect(result.input.setVideoDimensions).not.toHaveBeenCalledWith({ width: 640, height: 360 })
      await vi.advanceTimersByTimeAsync(400)
      expect(player).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(400)
      expect(player).toHaveBeenCalledTimes(3)
      expect(result.input.setVideoDimensions).toHaveBeenCalledWith({ width: 640, height: 360 })
      // Stops as soon as a value arrives — no further polling.
      await vi.advanceTimersByTimeAsync(400)
      expect(player).toHaveBeenCalledTimes(3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('discards an in-flight URL read after the file switches mid-poll', async () => {
    vi.useFakeTimers()
    try {
      const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
      const late = deferred<{ width: number; height: number } | undefined>()
      const player = vi.fn().mockReturnValueOnce(late.promise)
      const result = setup(url, player)
      // Switch to a different file before the first read resolves.
      result.input.filePath = '/local.mkv'
      result.input.loadGeneration = 2
      result.hook.rerender({ value: result.input })
      late.resolve({ width: 1920, height: 1080 })
      await vi.advanceTimersByTimeAsync(0)
      expect(result.input.setVideoDimensions).not.toHaveBeenCalledWith({
        width: 1920,
        height: 1080
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('ignores stale dimension and chapter completions after a later file wins', async () => {
    const result = setup()
    result.input.filePath = '/two.mkv'
    result.input.loadGeneration = 2
    result.hook.rerender({ value: result.input })
    await act(async () => {
      result.dimensions.resolve({ width: 1, height: 1 })
      result.chapters.resolve([])
      await Promise.resolve()
    })
    expect(result.input.setVideoDimensions).not.toHaveBeenCalledWith({ width: 1, height: 1 })
    expect(result.dispatch).not.toHaveBeenCalledWith({ type: 'chaptersLoaded', chapters: [] })
  })

  it('invalidates pending work on cleanup', async () => {
    const result = setup()
    result.hook.unmount()
    await act(async () => {
      result.dimensions.resolve({ width: 1, height: 1 })
      result.chapters.resolve([])
      await Promise.resolve()
    })
    expect(result.input.setVideoDimensions).not.toHaveBeenCalledWith({ width: 1, height: 1 })
    expect(result.dispatch).not.toHaveBeenCalledWith({ type: 'chaptersLoaded', chapters: [] })
  })
})
