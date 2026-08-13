import type { GameOcrTargetKind } from '../../../shared/gameOcr'
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

/** The subset of `MediaStreamTrack` the retention rules need. */
export interface CaptureTrack {
  readyState: string
  stop(): void
  addEventListener?(type: 'ended', listener: () => void): void
}

/** The subset of `MediaStream` the retention rules need. */
export interface CaptureStream {
  getTracks(): CaptureTrack[]
  getVideoTracks(): CaptureTrack[]
}

export interface CaptureStreamEntry {
  stream: CaptureStream
  video: CaptureVideo
}

export interface CaptureStreamRequest {
  sourceId: string
  targetKind: GameOcrTargetKind
}

export interface CaptureStreamRegistryOptions {
  /** Opens a stream. Injected so the rules below need no media stack. */
  open(request: CaptureStreamRequest): Promise<CaptureStreamEntry>
}

/**
 * How many *window* streams stay open at once. One is enough: only the current
 * target is ever frozen, and a user who alt-tabs through a dozen programs must
 * not leave Kizuna holding capture access to all of them. Display streams are
 * not bounded — there are only ever a handful, and keeping them open is what
 * makes a warm capture one `drawImage`.
 */
const MAX_WINDOW_STREAMS = 1

export interface CaptureStreamRegistry {
  acquire(request: CaptureStreamRequest): Promise<CaptureStreamEntry>
  /** Stops and forgets every retained stream. */
  releaseAll(): void
  /** Retained source ids, most recently used last. For tests and diagnostics. */
  retained(): string[]
}

/**
 * Keeps desktop capture streams open between captures, keyed by source id.
 *
 * The retained stream is the whole reason a capture costs one `drawImage`
 * rather than a stream open, so it is not thrown away at a frame boundary. It
 * is thrown away when it can no longer produce frames — a window that closed,
 * a display that went away, a track the user revoked — because such a stream
 * is indistinguishable from a working one until something tries to draw it.
 */
export function createCaptureStreamRegistry(
  options: CaptureStreamRegistryOptions
): CaptureStreamRegistry {
  // Insertion order is least-recently-used first; re-acquiring re-inserts.
  const entries = new Map<string, { entry: CaptureStreamEntry; targetKind: GameOcrTargetKind }>()
  const openings = new Map<string, Promise<CaptureStreamEntry>>()
  let released = false

  const stopEntry = (entry: CaptureStreamEntry): void => {
    try {
      for (const track of entry.stream.getTracks()) track.stop()
    } catch {
      // A track belonging to a stream that already ended cannot be stopped
      // again, and failing to do so must not fail the capture that noticed.
    }
  }

  const evict = (sourceId: string): void => {
    const record = entries.get(sourceId)
    if (!record) return
    entries.delete(sourceId)
    stopEntry(record.entry)
  }

  const isLive = (entry: CaptureStreamEntry): boolean =>
    entry.stream.getVideoTracks().some((track) => track.readyState === 'live')

  /** Drops the oldest window streams once a new one has been added. */
  const enforceWindowLimit = (): void => {
    const windows = [...entries.entries()].filter(([, record]) => record.targetKind === 'window')
    for (const [sourceId] of windows.slice(0, Math.max(0, windows.length - MAX_WINDOW_STREAMS))) {
      evict(sourceId)
    }
  }

  return {
    async acquire(request): Promise<CaptureStreamEntry> {
      if (released) throw new Error('The Game OCR capture streams have been released.')
      const existing = entries.get(request.sourceId)
      if (existing && isLive(existing.entry)) {
        // Re-insert so this is the most recently used entry.
        entries.delete(request.sourceId)
        entries.set(request.sourceId, existing)
        return existing.entry
      }
      if (existing) evict(request.sourceId)

      const pending = openings.get(request.sourceId)
      if (pending) return pending

      const operation = (async (): Promise<CaptureStreamEntry> => {
        const entry = await options.open(request)
        // Teardown can land while this open is still in flight. Retaining the
        // stream now would leave a live capture behind a registry nothing
        // holds any more — precisely the access this bounds.
        if (released) {
          stopEntry(entry)
          throw new Error('The Game OCR capture streams were released while opening.')
        }
        entries.set(request.sourceId, { entry, targetKind: request.targetKind })
        // A stream whose track ends is evicted as soon as it says so, rather
        // than on the next capture that would have drawn a frozen frame.
        for (const track of entry.stream.getVideoTracks()) {
          track.addEventListener?.('ended', () => {
            if (entries.get(request.sourceId)?.entry === entry) {
              evict(request.sourceId)
            }
          })
        }
        if (request.targetKind === 'window') enforceWindowLimit()
        return entry
      })()
      openings.set(request.sourceId, operation)
      try {
        return await operation
      } finally {
        if (openings.get(request.sourceId) === operation) openings.delete(request.sourceId)
      }
    },

    releaseAll(): void {
      released = true
      for (const sourceId of [...entries.keys()]) evict(sourceId)
      openings.clear()
    },

    retained(): string[] {
      return [...entries.keys()]
    }
  }
}

/** Constraints for one window's or display's desktop capture stream. */
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
