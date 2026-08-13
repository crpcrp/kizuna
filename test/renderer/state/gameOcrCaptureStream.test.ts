import { describe, expect, it, vi } from 'vitest'
import {
  desktopStreamConstraints,
  freezeCurrentFrame,
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

describe('desktopStreamConstraints', () => {
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
