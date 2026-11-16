import { thumbnailBucket } from '../../../shared/thumbnailBucket'

export interface PreviewTimer {
  set(callback: () => void, delayMs: number): unknown
  clear(handle: unknown): void
}

const browserPreviewTimer: PreviewTimer = {
  set: (callback, delayMs) => window.setTimeout(callback, delayMs),
  clear: (handle) => window.clearTimeout(handle as number)
}

export type ThumbnailFetch = (
  path: string,
  timeSec: number,
  durationSec: number
) => Promise<{ dataUrl: string } | null>

/** Nominal outer width of the preview frame, including its border. */
export const SEEK_PREVIEW_OUTER_WIDTH = 162

export interface SeekPreviewState {
  visible: boolean
  dataUrl: string | null
  /** Hovered time in seconds, for the timestamp label. */
  timeSec: number
  /** Horizontal cursor position across the seekbar, `0..1`. */
  positionRatio: number
  containerWidth?: number
}

export const HIDDEN_PREVIEW: SeekPreviewState = {
  visible: false,
  dataUrl: null,
  timeSec: 0,
  positionRatio: 0
}

export function pointerRatio(clientX: number, rect: { left: number; width: number }): number {
  if (rect.width <= 0) return 0
  return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
}

export function previewLeftOffset(
  positionRatio: number,
  containerWidth: number,
  previewWidth: number
): number {
  if (![positionRatio, containerWidth, previewWidth].every(Number.isFinite)) return 0
  if (containerWidth < 0 || previewWidth < 0) return 0
  const ratio = Math.max(0, Math.min(1, positionRatio))
  const desired = ratio * containerWidth - previewWidth / 2
  return Math.max(0, Math.min(desired, Math.max(0, containerWidth - previewWidth)))
}

export class SeekPreviewController {
  private path: string | null = null
  private duration = 0
  private enabled = false
  private handle: unknown
  /** Bumped on every cancel so a late fetch from a prior source/leave is dropped. */
  private generation = 0
  /** Bucket of the most recent scheduled fetch; a response for any other bucket is stale. */
  private requestBucket: number | null = null
  private shownBucket: number | null = null
  // Keep the cached frame across leave/re-enter to avoid flashing a placeholder for the same bucket.
  private shownDataUrl: string | null = null
  private state: SeekPreviewState = HIDDEN_PREVIEW

  constructor(
    private readonly onChange: (state: SeekPreviewState) => void,
    private readonly fetchThumbnail: ThumbnailFetch,
    private readonly timer: PreviewTimer = browserPreviewTimer,
    private readonly delayMs = 150
  ) {}

  setSource(path: string | null, duration: number, enabled: boolean): void {
    this.cancel()
    this.path = enabled ? path : null
    this.duration = duration
    this.enabled = enabled && path !== null
    this.shownBucket = null
    this.shownDataUrl = null
    this.emit(HIDDEN_PREVIEW)
  }

  hover(positionRatio: number, containerWidth?: number): void {
    if (!this.enabled || this.path === null) return
    const ratio = Math.max(0, Math.min(1, positionRatio))
    const timeSec = ratio * this.duration
    const bucket = thumbnailBucket(timeSec, this.duration)
    if (bucket === null) return

    // Keep the last frame while fetching a new bucket so scrubbing does not flash empty previews.
    const dataUrl =
      bucket === this.shownBucket
        ? this.shownDataUrl
        : this.state.visible
          ? this.state.dataUrl
          : null
    const geometry = containerWidth === undefined ? {} : { containerWidth }
    this.emit({ visible: true, dataUrl, timeSec, positionRatio: ratio, ...geometry })

    // Returning to a cached bucket must retire work for another bucket, or its
    // late response could replace the cached frame after the cursor moved back.
    if (bucket === this.shownBucket) {
      if (this.requestBucket !== null) this.cancel()
      return
    }
    // Position-only moves in the requested bucket must not reset its debounce,
    // duplicate its fetch, or replace the image element.
    if (bucket === this.requestBucket) return
    this.schedule(bucket, timeSec)
  }

  leave(): void {
    this.cancel()
    this.emit(HIDDEN_PREVIEW)
  }

  private schedule(bucket: number, timeSec: number): void {
    if (this.handle !== undefined) this.timer.clear(this.handle)
    const generation = this.generation
    this.requestBucket = bucket
    this.handle = this.timer.set(() => {
      this.handle = undefined
      const path = this.path
      const duration = this.duration
      if (path === null) return
      void this.fetchThumbnail(path, timeSec, duration).then((result) => {
        if (generation !== this.generation) return
        if (this.requestBucket !== bucket) return
        this.requestBucket = null
        if (result === null) return
        this.shownBucket = bucket
        this.shownDataUrl = result.dataUrl
        this.emit({ ...this.state, dataUrl: result.dataUrl })
      })
    }, this.delayMs)
  }

  private cancel(): void {
    this.generation += 1
    this.requestBucket = null
    if (this.handle !== undefined) {
      this.timer.clear(this.handle)
      this.handle = undefined
    }
  }

  private emit(state: SeekPreviewState): void {
    this.state = state
    this.onChange(state)
  }
}
