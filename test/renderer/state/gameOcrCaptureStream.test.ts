import { describe, expect, it, vi } from 'vitest'
import {
  createCaptureStreamRegistry,
  desktopStreamConstraints,
  freezeCurrentFrame,
  type CaptureStream,
  type CaptureStreamEntry,
  type CaptureTrack,
  type CaptureVideo,
  type GameOcrCaptureSurface
} from '@src/renderer/src/state/gameOcrCaptureStream'

function surface(video: Partial<CaptureVideo> = {}): {
  value: GameOcrCaptureSurface
  resize: ReturnType<typeof vi.fn>
  drawImage: ReturnType<typeof vi.fn>
} {
  const resize = vi.fn()
  const drawImage = vi.fn()
  const source: CaptureVideo = {
    videoWidth: 1920,
    videoHeight: 1080,
    ...video
  }
  return {
    value: { video: source, resize, context: { drawImage } },
    resize,
    drawImage
  }
}

describe('freezeCurrentFrame', () => {
  it('draws the current desktop stream frame immediately', async () => {
    const capture = surface()

    await expect(
      freezeCurrentFrame({ surface: capture.value, imageSize: { width: 2560, height: 1440 } })
    ).resolves.toEqual({ imageSize: { width: 1920, height: 1080 } })

    expect(capture.resize).toHaveBeenCalledWith({ width: 1920, height: 1080 })
    expect(capture.drawImage).toHaveBeenCalledWith(capture.value.video, 0, 0)
  })

  it('uses display geometry until the stream reports its dimensions', async () => {
    const capture = surface({ videoWidth: 0, videoHeight: 0 })

    await expect(
      freezeCurrentFrame({ surface: capture.value, imageSize: { width: 1024, height: 768 } })
    ).resolves.toEqual({ imageSize: { width: 1024, height: 768 } })
  })
})

interface FakeStream {
  stream: CaptureStream
  tracks: Array<CaptureTrack & { stop: ReturnType<typeof vi.fn>; end(): void }>
}

function fakeStream(): FakeStream {
  const listeners = new Set<() => void>()
  const track = {
    readyState: 'live',
    stop: vi.fn(function stop(this: { readyState: string }) {
      track.readyState = 'ended'
    }),
    addEventListener: (_type: 'ended', listener: () => void) => {
      listeners.add(listener)
    },
    end: (): void => {
      track.readyState = 'ended'
      for (const listener of listeners) listener()
    }
  }
  return {
    stream: { getTracks: () => [track], getVideoTracks: () => [track] },
    tracks: [track]
  }
}

function registryFor(maxWindowStreams?: number): {
  registry: ReturnType<typeof createCaptureStreamRegistry>
  open: ReturnType<typeof vi.fn>
  streams: Map<string, FakeStream>
} {
  const streams = new Map<string, FakeStream>()
  const open = vi.fn(async ({ sourceId }: { sourceId: string }): Promise<CaptureStreamEntry> => {
    const created = fakeStream()
    streams.set(sourceId, created)
    return { stream: created.stream, video: { videoWidth: 1024, videoHeight: 768 } }
  })
  return {
    registry: createCaptureStreamRegistry({
      open,
      ...(maxWindowStreams === undefined ? {} : { maxWindowStreams })
    }),
    open,
    streams
  }
}

describe('createCaptureStreamRegistry', () => {
  it('reuses a live stream instead of reopening it', async () => {
    const { registry, open } = registryFor()
    const request = { sourceId: 'window:111:0', targetKind: 'window' as const }

    const first = await registry.acquire(request)
    const second = await registry.acquire(request)

    // Reuse is the whole latency argument: a warm capture is one drawImage.
    expect(second).toBe(first)
    expect(open).toHaveBeenCalledOnce()
  })

  it('opens each source once even when two captures race', async () => {
    const { registry, open } = registryFor()
    const request = { sourceId: 'screen:1:0', targetKind: 'display' as const }

    const [first, second] = await Promise.all([
      registry.acquire(request),
      registry.acquire(request)
    ])

    expect(second).toBe(first)
    expect(open).toHaveBeenCalledOnce()
  })

  it('reopens a stream whose track was revoked', async () => {
    const { registry, open, streams } = registryFor()
    const request = { sourceId: 'window:111:0', targetKind: 'window' as const }

    const first = await registry.acquire(request)
    // A window that closed, or a track the user revoked, leaves a stream that
    // will never produce another frame and is otherwise indistinguishable.
    streams.get('window:111:0')!.tracks[0]!.readyState = 'ended'
    const second = await registry.acquire(request)

    expect(second).not.toBe(first)
    expect(open).toHaveBeenCalledTimes(2)
  })

  it('evicts a stream as soon as its track ends', async () => {
    const { registry, streams } = registryFor()

    await registry.acquire({ sourceId: 'window:111:0', targetKind: 'window' })
    expect(registry.retained()).toEqual(['window:111:0'])

    streams.get('window:111:0')!.tracks[0]!.end()

    expect(registry.retained()).toEqual([])
  })

  it('retains only the current window stream when the user switches programs', async () => {
    const { registry, streams } = registryFor()

    await registry.acquire({ sourceId: 'window:111:0', targetKind: 'window' })
    await registry.acquire({ sourceId: 'window:222:0', targetKind: 'window' })

    // Alt-tabbing through a dozen programs must not leave Kizuna holding
    // desktop capture access to all twelve.
    expect(registry.retained()).toEqual(['window:222:0'])
    expect(streams.get('window:111:0')!.tracks[0]!.stop).toHaveBeenCalledOnce()
  })

  it('keeps display streams open alongside the current window stream', async () => {
    const { registry } = registryFor()

    await registry.acquire({ sourceId: 'screen:1:0', targetKind: 'display' })
    await registry.acquire({ sourceId: 'screen:2:0', targetKind: 'display' })
    await registry.acquire({ sourceId: 'window:111:0', targetKind: 'window' })

    // There are only ever a handful of displays, and reopening one is the
    // expensive path a warm capture exists to avoid.
    expect(registry.retained()).toEqual(['screen:1:0', 'screen:2:0', 'window:111:0'])
  })

  it('keeps the window it just returned to, not the one before it', async () => {
    const { registry } = registryFor()

    await registry.acquire({ sourceId: 'window:111:0', targetKind: 'window' })
    await registry.acquire({ sourceId: 'window:222:0', targetKind: 'window' })
    await registry.acquire({ sourceId: 'window:111:0', targetKind: 'window' })

    expect(registry.retained()).toEqual(['window:111:0'])
  })

  it('stops every retained stream when the frame is torn down', async () => {
    const { registry, streams } = registryFor()

    await registry.acquire({ sourceId: 'screen:1:0', targetKind: 'display' })
    await registry.acquire({ sourceId: 'window:111:0', targetKind: 'window' })
    registry.releaseAll()

    expect(registry.retained()).toEqual([])
    for (const stream of streams.values()) {
      expect(stream.tracks[0]!.stop).toHaveBeenCalled()
    }
  })

  it('survives a stream that refuses to be stopped', async () => {
    const { registry, streams } = registryFor()
    await registry.acquire({ sourceId: 'window:111:0', targetKind: 'window' })
    streams.get('window:111:0')!.tracks[0]!.stop.mockImplementation(() => {
      throw new Error('track already ended')
    })

    expect(() => registry.releaseAll()).not.toThrow()
    expect(registry.retained()).toEqual([])
  })

  it('stops a stream that finishes opening after teardown', async () => {
    // The frame can be torn down while an open is still in flight. Retaining
    // that stream would leave a live capture behind a registry nothing holds.
    let finishOpen!: (entry: CaptureStreamEntry) => void
    const opened = fakeStream()
    const registry = createCaptureStreamRegistry({
      open: () =>
        new Promise<CaptureStreamEntry>((resolve) => {
          finishOpen = resolve
        })
    })

    const pending = registry.acquire({ sourceId: 'window:111:0', targetKind: 'window' })
    registry.releaseAll()
    finishOpen({ stream: opened.stream, video: { videoWidth: 1024, videoHeight: 768 } })

    await expect(pending).rejects.toThrow(/released/)
    expect(registry.retained()).toEqual([])
    expect(opened.tracks[0]!.stop).toHaveBeenCalledOnce()
  })

  it('refuses to acquire once released', async () => {
    const { registry } = registryFor()
    registry.releaseAll()

    await expect(
      registry.acquire({ sourceId: 'window:111:0', targetKind: 'window' })
    ).rejects.toThrow(/released/)
  })

  it('does not retain a stream whose open failed', async () => {
    const registry = createCaptureStreamRegistry({
      open: async () => {
        throw new Error('capture denied')
      }
    })

    await expect(
      registry.acquire({ sourceId: 'window:111:0', targetKind: 'window' })
    ).rejects.toThrow('capture denied')
    expect(registry.retained()).toEqual([])
  })
})

describe('desktopStreamConstraints', () => {
  it('captures the selected window at native size without audio', () => {
    // Windows and displays are opened identically; only the source id differs.
    expect(desktopStreamConstraints('window:1902762:0')).toMatchObject({
      video: {
        mandatory: { chromeMediaSourceId: 'window:1902762:0', chromeMediaSource: 'desktop' }
      }
    })
  })

  it('captures the selected display at native size without audio', () => {
    expect(desktopStreamConstraints('screen:2:0')).toEqual({
      audio: false,
      video: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: 'screen:2:0',
          maxWidth: 4096,
          maxHeight: 4096,
          maxFrameRate: 30
        }
      }
    })
  })
})
