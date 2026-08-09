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

function setup(filePath = '/one.mkv') {
  const dimensions = deferred<{ width: number; height: number } | undefined>()
  const chapters = deferred<never[]>()
  const dispatch = vi.fn()
  const bridge = {
    player: {
      setSpeed: vi.fn().mockResolvedValue(undefined),
      setAudioDelay: vi.fn().mockResolvedValue(undefined),
      setLoudnessNorm: vi.fn().mockResolvedValue(undefined),
      setAbLoop: vi.fn().mockResolvedValue(undefined),
      setVideoAdjustments: vi.fn().mockResolvedValue(undefined)
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
  })

  it('does not send URL state to mpv or local-media probes', () => {
    const result = setup('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    expect(result.bridge.player.setSpeed).not.toHaveBeenCalled()
    expect(result.bridge.player.setAudioDelay).not.toHaveBeenCalled()
    expect(result.bridge.player.setAbLoop).not.toHaveBeenCalled()
    expect(result.bridge.media.getVideoDimensions).not.toHaveBeenCalled()
    expect(result.bridge.media.getChapters).not.toHaveBeenCalled()
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

  it('silently ignores optional chapter probe failures', async () => {
    const result = setup()
    result.bridge.media.getChapters.mockReset()
    result.bridge.media.getChapters.mockRejectedValue(new Error('ffprobe failed'))
    result.input.loadGeneration = 2

    expect(() => result.hook.rerender({ value: result.input })).not.toThrow()
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: 'chaptersLoaded' })
    )
  })
})
