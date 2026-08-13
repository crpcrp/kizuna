import type { OcrImageSize } from '../../../shared/ocr'

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
 * Resolves `true` when a genuinely new frame arrived and `false` when main's
 * deadline allows the current frame. Main owns the deadline because Chromium
 * throttles timers in hidden renderers.
 */
export function waitForFreshFrame(video: CaptureVideo, fallback: Promise<void>): Promise<boolean> {
  const request = video.requestVideoFrameCallback
  if (typeof request !== 'function') return Promise.resolve(false)
  return new Promise<boolean>((resolve) => {
    let settled = false
    const finish = (fresh: boolean): void => {
      if (settled) return
      settled = true
      resolve(fresh)
    }
    void fallback.then(() => finish(false))
    request.call(video, () => finish(true))
  })
}

export interface FreezeOptions {
  surface: GameOcrCaptureSurface
  imageSize: OcrImageSize
  requireFreshFrame: boolean
  /** Main-process deadline, unaffected by hidden-renderer timer throttling. */
  freshFrameFallback?: Promise<void>
  /** Reopens the desktop stream when its hidden video never advances. */
  refreshSurface?: () => Promise<GameOcrCaptureSurface>
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
  surface: initialSurface,
  imageSize,
  requireFreshFrame,
  freshFrameFallback,
  refreshSurface
}: FreezeOptions): Promise<FreezeOutcome> {
  if (requireFreshFrame && !freshFrameFallback) {
    throw new Error('A fresh-frame capture requires a main-process fallback signal.')
  }
  const fresh = requireFreshFrame
    ? await waitForFreshFrame(initialSurface.video, freshFrameFallback as Promise<void>)
    : true
  let surface = initialSurface
  if (requireFreshFrame && !fresh) {
    if (!refreshSurface) {
      throw new Error('The stale desktop stream cannot be used without reopening it.')
    }
    // Never draw the stale frame, even while hidden. Reopening creates a new
    // desktop-capture pipeline after the overlay's native hide command.
    surface = await refreshSurface()
  }
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
