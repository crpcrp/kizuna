import type { GameOcrTargetKind } from '../../../shared/gameOcr'
import type { OcrImageSize } from '../../../shared/ocr'

export interface CaptureVideo {
  videoWidth: number
  videoHeight: number
}

export interface CaptureCanvasContext {
  drawImage(source: CaptureVideo, x: number, y: number): void
}

export interface GameOcrCaptureSurface {
  video: CaptureVideo
  context: CaptureCanvasContext
  resize(size: OcrImageSize): void
}

export interface FreezeOptions {
  surface: GameOcrCaptureSurface
  imageSize: OcrImageSize
}

export interface FreezeOutcome {
  imageSize: OcrImageSize
}

// Windows capture excludes the frozen-frame window, so drawing can run while the old screenshot is visible.
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

export interface CaptureTrack {
  readyState: string
  stop(): void
  addEventListener?(type: 'ended', listener: () => void): void
}

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
  open(request: CaptureStreamRequest): Promise<CaptureStreamEntry>
}

// Retain only one window stream to bound capture access; keep display streams warm for fast captures.
const MAX_WINDOW_STREAMS = 1

export interface CaptureStreamRegistry {
  acquire(request: CaptureStreamRequest): Promise<CaptureStreamEntry>
  releaseAll(): void
  retained(): string[]
}

// Retain streams between frames, but evict ended tracks so later captures cannot reuse a frozen image.
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
        entries.delete(request.sourceId)
        entries.set(request.sourceId, existing)
        return existing.entry
      }
      if (existing) evict(request.sourceId)

      const pending = openings.get(request.sourceId)
      if (pending) return pending

      const operation = (async (): Promise<CaptureStreamEntry> => {
        const entry = await options.open(request)
        // Teardown may race a stream open; stop late streams so capture access cannot outlive the registry.
        if (released) {
          stopEntry(entry)
          throw new Error('The Game OCR capture streams were released while opening.')
        }
        entries.set(request.sourceId, { entry, targetKind: request.targetKind })
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

export function desktopStreamConstraints(
  sourceId: string,
  maxFrameRate = 30
): MediaStreamConstraints {
  return {
    audio: false,
    video: {
      // Electron accepts Chromium desktop-capture constraints, which are absent from standard getUserMedia types.
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
