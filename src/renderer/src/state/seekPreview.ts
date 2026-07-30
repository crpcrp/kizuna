// Seekbar hover thumbnails — renderer state.
//
// Owns the hover→preview lifecycle for the seekbar: it debounces the (cheap,
// synchronous) cursor tracking from the (expensive, async) thumbnail fetch,
// keeps a single request in flight, and drops stale responses by comparing the
// bucket that was requested against the newest one. The timer and the fetch are
// both injected so the whole thing is unit-testable without a clock, a browser,
// or the preload bridge.

/** Injected timer seam — mirrors `subtitleSearchDebounce`'s `SearchTimer`. */
export interface PreviewTimer {
  set(callback: () => void, delayMs: number): unknown
  clear(handle: unknown): void
}

/** Production timer bound to the browser's `setTimeout`/`clearTimeout`. */
export const browserPreviewTimer: PreviewTimer = {
  set: (callback, delayMs) => window.setTimeout(callback, delayMs),
  clear: (handle) => window.clearTimeout(handle as number)
}

/** Fetches the preview frame for a hovered time — the preload
 * `media.getThumbnail` in production, a fake in tests. */
export type ThumbnailFetch = (
  path: string,
  timeSec: number,
  durationSec: number
) => Promise<{ dataUrl: string } | null>

/** Nominal outer width of the preview frame, including its border. */
export const SEEK_PREVIEW_OUTER_WIDTH = 162

/** The renderable preview state the controller pushes to React. */
export interface SeekPreviewState {
  /** Whether the floating preview is shown at all (true while hovering). */
  visible: boolean
  /** The current frame image, or null while it is still being generated. */
  dataUrl: string | null
  /** Hovered time in seconds, for the timestamp label. */
  timeSec: number
  /** Horizontal cursor position across the seekbar, `0..1`. */
  positionRatio: number
  /** Measured seekbar width used to keep the preview inside its container. */
  containerWidth?: number
}

/** The hidden/idle state — no box, no image. */
export const HIDDEN_PREVIEW: SeekPreviewState = {
  visible: false,
  dataUrl: null,
  timeSec: 0,
  positionRatio: 0
}

/**
 * The 1-percent bucket a hovered time maps to (`0..99`), or `null` when no
 * preview should be shown (non-finite input, or a duration under 1 s). Mirrors
 * `bucketFor` in `main/services/thumbnails.ts` so the renderer dedupes on the
 * same granularity the cache keys on — kept local because that module pulls in
 * `node:*` and can't cross into the renderer bundle.
 */
export function previewBucket(timeSec: number, durationSec: number): number | null {
  if (!Number.isFinite(timeSec) || !Number.isFinite(durationSec)) return null
  if (durationSec < 1) return null
  return Math.max(0, Math.min(99, Math.floor((timeSec / durationSec) * 100)))
}

/**
 * Pure: the `0..1` horizontal ratio of `clientX` within a seekbar rectangle,
 * clamped to the edges. Isolated so BottomBar's pointer handler stays a
 * one-liner and the math is testable without a real DOM.
 */
export function pointerRatio(clientX: number, rect: { left: number; width: number }): number {
  if (rect.width <= 0) return 0
  return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width))
}

/**
 * Left pixel offset for a preview centered on the pointer where possible and
 * clamped fully inside the available width. Invalid or negative measurements
 * safely collapse to the left edge.
 */
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

/**
 * Drives the seekbar hover preview. `hover` tracks the cursor synchronously
 * (the box follows immediately, keeping the last frame until a fresh one
 * arrives) while debouncing the thumbnail fetch; `leave` hides it; `setSource`
 * swaps the loaded file (and disables previews for audio-only / URL sources).
 */
export class SeekPreviewController {
  private path: string | null = null
  private duration = 0
  private enabled = false
  private handle: unknown
  /** Bumped on every cancel so a late fetch from a prior source/leave is dropped. */
  private generation = 0
  /** Bucket of the most recent scheduled fetch; a response for any other bucket is stale. */
  private requestBucket: number | null = null
  /** Bucket whose frame is cached below, so re-hovering it skips the fetch. */
  private shownBucket: number | null = null
  /** The cached frame for `shownBucket`; kept across `leave` so re-entering the
   * same bucket re-shows it immediately instead of flashing the placeholder. */
  private shownDataUrl: string | null = null
  private state: SeekPreviewState = HIDDEN_PREVIEW

  constructor(
    private readonly onChange: (state: SeekPreviewState) => void,
    private readonly fetchThumbnail: ThumbnailFetch,
    private readonly timer: PreviewTimer = browserPreviewTimer,
    private readonly delayMs = 150
  ) {}

  /**
   * Point the controller at the loaded file. `enabled` is false for sources
   * without previews (audio-only, remote URLs); a null path disables too. Any
   * pending work is cancelled and the preview hidden.
   */
  setSource(path: string | null, duration: number, enabled: boolean): void {
    this.cancel()
    this.path = enabled ? path : null
    this.duration = duration
    this.enabled = enabled && path !== null
    this.shownBucket = null
    this.shownDataUrl = null
    this.emit(HIDDEN_PREVIEW)
  }

  /** Cursor moved to `positionRatio` (`0..1`) across the measured seekbar. */
  hover(positionRatio: number, containerWidth?: number): void {
    if (!this.enabled || this.path === null) return
    const ratio = Math.max(0, Math.min(1, positionRatio))
    const timeSec = ratio * this.duration
    const bucket = previewBucket(timeSec, this.duration)
    if (bucket === null) return

    // Follow the cursor now. Re-show this bucket's cached frame if we have one
    // (covers re-entering after a leave); otherwise, while actively scrubbing,
    // carry the last frame over so the box never flickers empty between buckets.
    const dataUrl =
      bucket === this.shownBucket
        ? this.shownDataUrl
        : this.state.visible
          ? this.state.dataUrl
          : null
    const geometry = containerWidth === undefined ? {} : { containerWidth }
    this.emit({ visible: true, dataUrl, timeSec, positionRatio: ratio, ...geometry })

    // Position-only moves in the shown or already-requested bucket must not
    // reset its debounce, duplicate its fetch, or replace the image element.
    if (bucket === this.shownBucket || bucket === this.requestBucket) return
    this.schedule(bucket, timeSec)
  }

  /** Cursor left the seekbar: cancel pending work and hide the preview. */
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
        // Stale-drop: a new source/leave (generation) or a newer hover
        // (requestBucket) has superseded this request.
        if (generation !== this.generation) return
        if (this.requestBucket !== bucket) return
        this.requestBucket = null
        if (result === null) return
        // Cache the frame so re-entering this bucket (e.g. after a leave)
        // re-shows it immediately without another round-trip.
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
