import { describe, expect, it, vi } from 'vitest'
import {
  desktopStreamConstraints,
  freezeCurrentFrame,
  waitForFreshFrame,
  type CaptureVideo,
  type GameOcrCaptureSurface
} from '@src/renderer/src/state/gameOcrCaptureStream'

function surfaceFor(
  video: Partial<CaptureVideo> = {}
): GameOcrCaptureSurface & { drawn: number; sizes: Array<{ width: number; height: number }> } {
  const state = {
    drawn: 0,
    sizes: [] as Array<{ width: number; height: number }>,
    video: { videoWidth: 2560, videoHeight: 1440, ...video } as CaptureVideo,
    context: {
      drawImage: () => {
        state.drawn += 1
      }
    },
    resize: (size: { width: number; height: number }) => {
      state.sizes.push(size)
    }
  }
  return state
}

describe('waitForFreshFrame', () => {
  it('resolves as soon as the stream composites a frame', async () => {
    const video: CaptureVideo = {
      videoWidth: 1,
      videoHeight: 1,
      requestVideoFrameCallback: (callback) => {
        callback()
        return 1
      }
    }

    await expect(waitForFreshFrame(video, new Promise<void>(() => undefined))).resolves.toBe(true)
  })

  it('gives up rather than hanging on a screen that never changes', async () => {
    // A desktop capture stream only produces frames when the screen changes, so
    // on a still screen this callback may not fire for seconds — measured 3.3 s
    // and 14.4 s. A capture the user is waiting on must not be behind that.
    const video: CaptureVideo = {
      videoWidth: 1,
      videoHeight: 1,
      requestVideoFrameCallback: () => 1
    }
    let allowFallback!: () => void
    const fallback = new Promise<void>((resolve) => {
      allowFallback = resolve
    })

    const waiting = waitForFreshFrame(video, fallback)
    allowFallback()
    await expect(waiting).resolves.toBe(false)
  })

  it('does not wait at all where the browser cannot report frames', async () => {
    await expect(
      waitForFreshFrame({ videoWidth: 1, videoHeight: 1 }, Promise.resolve())
    ).resolves.toBe(false)
  })
})

describe('freezeCurrentFrame', () => {
  it('draws the frame it already has when no fresh frame is required', async () => {
    const surface = surfaceFor({
      requestVideoFrameCallback: vi.fn(() => 1)
    })

    const outcome = await freezeCurrentFrame({
      surface,
      imageSize: { width: 2560, height: 1440 },
      requireFreshFrame: false
    })

    // The first capture of a run covered nothing of Kizuna's own, so the frame
    // in hand is the live game and waiting would only add latency.
    expect(surface.video.requestVideoFrameCallback).not.toHaveBeenCalled()
    expect(surface.drawn).toBe(1)
    expect(outcome).toEqual({ imageSize: { width: 2560, height: 1440 }, fresh: true })
  })

  it('waits for a frame composited after the previous one was hidden', async () => {
    const requestVideoFrameCallback = vi.fn((callback: () => void) => {
      callback()
      return 1
    })
    const surface = surfaceFor({ requestVideoFrameCallback })

    const outcome = await freezeCurrentFrame({
      surface,
      imageSize: { width: 2560, height: 1440 },
      requireFreshFrame: true,
      freshFrameFallback: new Promise<void>(() => undefined)
    })

    expect(requestVideoFrameCallback).toHaveBeenCalledOnce()
    expect(outcome.fresh).toBe(true)
    expect(surface.drawn).toBe(1)
  })

  it('refuses an unsafe recapture without the main-process fallback boundary', async () => {
    const surface = surfaceFor({ requestVideoFrameCallback: vi.fn(() => 1) })

    await expect(
      freezeCurrentFrame({
        surface,
        imageSize: { width: 2560, height: 1440 },
        requireFreshFrame: true
      })
    ).rejects.toThrow('requires a main-process fallback')
    expect(surface.drawn).toBe(0)
  })

  it('sizes the canvas to the stream rather than to the requested geometry', async () => {
    const surface = surfaceFor({ videoWidth: 1920, videoHeight: 1080 })

    const outcome = await freezeCurrentFrame({
      surface,
      imageSize: { width: 2560, height: 1440 },
      requireFreshFrame: false
    })

    // What the stream actually delivers is what the OCR regions are measured
    // against; trusting the display geometry would offset every box.
    expect(surface.sizes).toEqual([{ width: 1920, height: 1080 }])
    expect(outcome.imageSize).toEqual({ width: 1920, height: 1080 })
  })

  it('falls back to the requested size before the stream reports its own', async () => {
    const surface = surfaceFor({ videoWidth: 0, videoHeight: 0 })

    const outcome = await freezeCurrentFrame({
      surface,
      imageSize: { width: 800, height: 600 },
      requireFreshFrame: false
    })

    expect(outcome.imageSize).toEqual({ width: 800, height: 600 })
  })
})

describe('desktopStreamConstraints', () => {
  it('asks Chromium for one desktop source and no audio', () => {
    const constraints = desktopStreamConstraints('screen:0:0') as {
      audio: boolean
      video: { mandatory: Record<string, unknown> }
    }

    expect(constraints.audio).toBe(false)
    expect(constraints.video.mandatory).toMatchObject({
      chromeMediaSource: 'desktop',
      chromeMediaSourceId: 'screen:0:0'
    })
  })
})
