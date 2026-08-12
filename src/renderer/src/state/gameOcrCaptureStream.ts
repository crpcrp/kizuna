import type { OcrImageSize } from '../../../shared/ocr'

/**
 * How long a recapture waits for a frame composited after Kizuna's own frozen
 * frame stopped covering the display.
 *
 * A desktop capture stream only produces frames when the screen changes, so on
 * a static screen `requestVideoFrameCallback` can wait indefinitely — measured
 * stalls of 3.3 s and 14.4 s on a still desktop. Hiding the frozen frame *is* a
 * change, so the frame normally arrives within one refresh; this bound only
 * covers the case where the compositor disagrees, and falling back to the frame
 * already in hand is far better than hanging a capture the user is waiting for.
 */
export const FRESH_FRAME_TIMEOUT_MS = 120

/** The subset of `<video>` this module needs, so tests need no media stack. */
export interface CaptureVideo {
  videoWidth: number
  videoHeight: number
  requestVideoFrameCallback?(callback: () => void): number
  cancelVideoFrameCallback?(handle: number): void
}

/** The subset of `CanvasRenderingContext2D` this module needs. */
export interface CaptureCanvasContext {
  drawImage(source: CaptureVideo, x: number, y: number): void
}

export interface GameOcrCaptureSurface {
  video: CaptureVideo
  context: CaptureCanvasContext
  /** Sizes the backing store before the first draw at a new resolution. */
  resize(size: OcrImageSize): void
}

/**
 * Waits for the stream's next composited frame, or gives up.
 *
 * Resolves `true` when a genuinely new frame arrived and `false` when the wait
 * timed out, so the caller can record which of the two it drew — the difference
 * matters only for a recapture, where a timeout means the frame drawn may still
 * be the one Kizuna's own window was in.
 */
export function waitForFreshFrame(
  video: CaptureVideo,
  timeoutMs: number = FRESH_FRAME_TIMEOUT_MS,
  schedule: (callback: () => void, ms: number) => unknown = setTimeout,
  cancel: (handle: unknown) => void = (handle) => clearTimeout(handle as never)
): Promise<boolean> {
  const request = video.requestVideoFrameCallback
  if (typeof request !== 'function') return Promise.resolve(false)
  return new Promise<boolean>((resolve) => {
    let settled = false
    const timer = schedule(() => {
      if (settled) return
      settled = true
      resolve(false)
    }, timeoutMs)
    request.call(video, () => {
      if (settled) return
      settled = true
      cancel(timer)
      resolve(true)
    })
  })
}

export interface FreezeOptions {
  surface: GameOcrCaptureSurface
  imageSize: OcrImageSize
  requireFreshFrame: boolean
  timeoutMs?: number
}

export interface FreezeOutcome {
  imageSize: OcrImageSize
  /** False when a recapture fell back to the frame it already had. */
  fresh: boolean
}

/**
 * Draws the current stream frame into the frame's canvas.
 *
 * The draw deliberately happens while the frozen-frame window is still hidden:
 * a window that is not on screen cannot be in the picture it is about to show,
 * which is a stronger guarantee than the fixed compositor-settle delay it
 * replaces — that one only assumed the repaint had happened by then.
 */
export async function freezeCurrentFrame({
  surface,
  imageSize,
  requireFreshFrame,
  timeoutMs
}: FreezeOptions): Promise<FreezeOutcome> {
  const fresh = requireFreshFrame ? await waitForFreshFrame(surface.video, timeoutMs) : true
  const size = {
    width: surface.video.videoWidth || imageSize.width,
    height: surface.video.videoHeight || imageSize.height
  }
  surface.resize(size)
  surface.context.drawImage(surface.video, 0, 0)
  return { imageSize: size, fresh }
}

/** Constraints for one display's desktop capture stream. */
export function desktopStreamConstraints(
  sourceId: string,
  maxFrameRate = 30
): MediaStreamConstraints {
  return {
    audio: false,
    video: {
      // Chromium's desktop-capture constraints, which Electron honours when it
      // is given a source id from `desktopCapturer`. They are not standard
      // getUserMedia constraints, hence the cast.
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: sourceId,
        maxWidth: 4096,
        maxHeight: 4096,
        maxFrameRate
      }
    } as unknown as MediaTrackConstraints
  }
}
