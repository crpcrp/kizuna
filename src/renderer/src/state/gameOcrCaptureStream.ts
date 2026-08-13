import type { OcrImageSize } from '../../../shared/ocr'

/** The subset of `<video>` this module needs, so tests need no media stack. */
export interface CaptureVideo {
  videoWidth: number
  videoHeight: number
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

export interface FreezeOptions {
  surface: GameOcrCaptureSurface
  imageSize: OcrImageSize
}

export interface FreezeOutcome {
  imageSize: OcrImageSize
}

/**
 * Draws the current stream frame into the frame's canvas.
 *
 * The frozen-frame window is excluded from Windows desktop capture, so this
 * draw can happen while the previous screenshot remains visible. The canvas
 * is replaced before React publishes the new capture identity.
 */
export async function freezeCurrentFrame({
  surface,
  imageSize
}: FreezeOptions): Promise<FreezeOutcome> {
  const size = {
    width: surface.video.videoWidth || imageSize.width,
    height: surface.video.videoHeight || imageSize.height
  }
  surface.resize(size)
  surface.context.drawImage(surface.video, 0, 0)
  return { imageSize: size }
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
