import { describe, expect, it } from 'vitest'
import {
  HIDDEN_PREVIEW,
  pointerRatio,
  previewBucket,
  previewLeftOffset,
  SeekPreviewController,
  type PreviewTimer,
  type SeekPreviewState,
  type ThumbnailFetch
} from '@src/renderer/src/state/seekPreview'

/** Fake timer that lets a test fire the pending debounced callback on demand. */
function fakeTimer(): PreviewTimer & { run(handle: number): void; pending(): number[] } {
  let nextHandle = 1
  const callbacks = new Map<number, () => void>()
  const cancelled = new Set<number>()
  return {
    set(callback) {
      const handle = nextHandle++
      callbacks.set(handle, callback)
      return handle
    },
    clear(handle) {
      cancelled.add(handle as number)
    },
    run(handle) {
      if (cancelled.has(handle)) return
      const callback = callbacks.get(handle)
      callbacks.delete(handle)
      callback?.()
    },
    pending() {
      return [...callbacks.keys()].filter((handle) => !cancelled.has(handle))
    }
  }
}

/** A fetch whose per-call promises the test resolves manually. */
function deferredFetch() {
  const resolvers: Array<(value: { dataUrl: string } | null) => void> = []
  const calls: Array<{ path: string; timeSec: number; durationSec: number }> = []
  const fetch: ThumbnailFetch = (path, timeSec, durationSec) => {
    calls.push({ path, timeSec, durationSec })
    return new Promise((resolve) => resolvers.push(resolve))
  }
  return { fetch, calls, resolve: (i: number, v: { dataUrl: string } | null) => resolvers[i](v) }
}

describe('previewBucket', () => {
  it('maps a time to its 1-percent bucket, clamped to 0..99', () => {
    expect(previewBucket(0, 100)).toBe(0)
    expect(previewBucket(50, 100)).toBe(50)
    expect(previewBucket(100, 100)).toBe(99)
    expect(previewBucket(250, 100)).toBe(99)
  })

  it('returns null for non-finite input or a sub-second duration', () => {
    expect(previewBucket(NaN, 100)).toBeNull()
    expect(previewBucket(5, Infinity)).toBeNull()
    expect(previewBucket(0.1, 0.5)).toBeNull()
  })
})

describe('pointerRatio', () => {
  it('returns the clamped 0..1 position of clientX within the rect', () => {
    expect(pointerRatio(100, { left: 100, width: 200 })).toBe(0)
    expect(pointerRatio(200, { left: 100, width: 200 })).toBe(0.5)
    expect(pointerRatio(400, { left: 100, width: 200 })).toBe(1)
    expect(pointerRatio(50, { left: 100, width: 200 })).toBe(0)
  })

  it('returns 0 for a zero-width rect', () => {
    expect(pointerRatio(150, { left: 100, width: 0 })).toBe(0)
  })
})

describe('previewLeftOffset', () => {
  it('centers in the middle and clamps at both edges', () => {
    expect(previewLeftOffset(0, 400, 162)).toBe(0)
    expect(previewLeftOffset(0.1, 400, 162)).toBe(0)
    expect(previewLeftOffset(0.5, 400, 162)).toBe(119)
    expect(previewLeftOffset(0.9, 400, 162)).toBe(238)
    expect(previewLeftOffset(1, 400, 162)).toBe(238)
  })

  it('returns zero when the container is no wider than the preview', () => {
    expect(previewLeftOffset(0.5, 162, 162)).toBe(0)
    expect(previewLeftOffset(0.5, 100, 162)).toBe(0)
  })

  it('returns zero for invalid or negative measurements', () => {
    expect(previewLeftOffset(0.5, Number.NaN, 162)).toBe(0)
    expect(previewLeftOffset(0.5, 400, -1)).toBe(0)
    expect(previewLeftOffset(Number.POSITIVE_INFINITY, 400, 162)).toBe(0)
  })
})

describe('SeekPreviewController', () => {
  it('tracks the cursor immediately, then fills the image after the debounce', async () => {
    const timer = fakeTimer()
    const { fetch, calls, resolve } = deferredFetch()
    const states: SeekPreviewState[] = []
    const controller = new SeekPreviewController((s) => states.push(s), fetch, timer)
    controller.setSource('/video/ep.mkv', 100, true)

    controller.hover(0.5)
    // The box is visible with the timestamp before any fetch resolves.
    expect(states.at(-1)).toEqual({ visible: true, dataUrl: null, timeSec: 50, positionRatio: 0.5 })
    expect(calls).toHaveLength(0)

    timer.run(timer.pending()[0])
    expect(calls).toEqual([{ path: '/video/ep.mkv', timeSec: 50, durationSec: 100 }])
    resolve(0, { dataUrl: 'data:image/jpeg;base64,AAA' })
    await Promise.resolve()

    expect(states.at(-1)).toEqual({
      visible: true,
      dataUrl: 'data:image/jpeg;base64,AAA',
      timeSec: 50,
      positionRatio: 0.5
    })
  })

  it('drops a stale response whose bucket a newer hover superseded', async () => {
    const timer = fakeTimer()
    const { fetch, resolve } = deferredFetch()
    const states: SeekPreviewState[] = []
    const controller = new SeekPreviewController((s) => states.push(s), fetch, timer)
    controller.setSource('/video/ep.mkv', 100, true)

    controller.hover(0.1) // bucket 10
    timer.run(timer.pending()[0])
    controller.hover(0.8) // bucket 80
    timer.run(timer.pending().at(-1)!)

    // The slow first (bucket 10) response arrives after the second request.
    resolve(0, { dataUrl: 'STALE' })
    await Promise.resolve()
    expect(states.at(-1)?.dataUrl).toBeNull()

    resolve(1, { dataUrl: 'FRESH' })
    await Promise.resolve()
    expect(states.at(-1)?.dataUrl).toBe('FRESH')
  })

  it('does not reschedule or re-fetch while moving within the requested bucket', () => {
    const timer = fakeTimer()
    const { fetch, calls } = deferredFetch()
    const controller = new SeekPreviewController(() => {}, fetch, timer)
    controller.setSource('/video/ep.mkv', 100, true)

    controller.hover(0.99, 400)
    const handle = timer.pending()[0]
    controller.hover(1, 400)

    expect(timer.pending()).toEqual([handle])
    timer.run(handle)
    expect(calls).toHaveLength(1)
  })

  it('does not re-fetch while hovering within the already-shown bucket', async () => {
    const timer = fakeTimer()
    const { fetch, calls, resolve } = deferredFetch()
    const controller = new SeekPreviewController(() => {}, fetch, timer)
    controller.setSource('/video/ep.mkv', 100, true)

    controller.hover(0.5)
    timer.run(timer.pending()[0])
    resolve(0, { dataUrl: 'AAA' })
    await Promise.resolve()

    // A tiny move still inside bucket 50 must not schedule another fetch.
    controller.hover(0.505)
    expect(timer.pending()).toEqual([])
    expect(calls).toHaveLength(1)
  })

  it('re-shows a bucket’s cached frame immediately after leaving and re-entering it', async () => {
    const timer = fakeTimer()
    const { fetch, calls, resolve } = deferredFetch()
    const states: SeekPreviewState[] = []
    const controller = new SeekPreviewController((s) => states.push(s), fetch, timer)
    controller.setSource('/video/ep.mkv', 100, true)

    controller.hover(0.5)
    timer.run(timer.pending()[0])
    resolve(0, { dataUrl: 'CACHED' })
    await Promise.resolve()
    controller.leave()

    // Re-enter over the same bucket: the frame shows at once, no new fetch.
    controller.hover(0.5)
    expect(states.at(-1)).toEqual({
      visible: true,
      dataUrl: 'CACHED',
      timeSec: 50,
      positionRatio: 0.5
    })
    expect(timer.pending()).toEqual([])
    expect(calls).toHaveLength(1)
  })

  it('hides and cancels pending work on leave; a late response cannot resurrect it', async () => {
    const timer = fakeTimer()
    const { fetch, resolve } = deferredFetch()
    const states: SeekPreviewState[] = []
    const controller = new SeekPreviewController((s) => states.push(s), fetch, timer)
    controller.setSource('/video/ep.mkv', 100, true)

    controller.hover(0.5)
    timer.run(timer.pending()[0])
    controller.leave()
    expect(states.at(-1)).toEqual(HIDDEN_PREVIEW)

    resolve(0, { dataUrl: 'LATE' })
    await Promise.resolve()
    expect(states.at(-1)).toEqual(HIDDEN_PREVIEW)
  })

  it('is a no-op while disabled (audio-only / URL source)', () => {
    const timer = fakeTimer()
    const { fetch, calls } = deferredFetch()
    const states: SeekPreviewState[] = []
    const controller = new SeekPreviewController((s) => states.push(s), fetch, timer)
    controller.setSource('/audio/song.mp3', 200, false)

    states.length = 0
    controller.hover(0.5)
    expect(states).toEqual([])
    expect(timer.pending()).toEqual([])
    expect(calls).toHaveLength(0)
  })

  it('drops responses from a previous file after the source changes', async () => {
    const timer = fakeTimer()
    const { fetch, resolve } = deferredFetch()
    const states: SeekPreviewState[] = []
    const controller = new SeekPreviewController((s) => states.push(s), fetch, timer)
    controller.setSource('/video/a.mkv', 100, true)

    controller.hover(0.5)
    timer.run(timer.pending()[0])
    controller.setSource('/video/b.mkv', 100, true)

    resolve(0, { dataUrl: 'FROM-A' })
    await Promise.resolve()
    expect(states.at(-1)).toEqual(HIDDEN_PREVIEW)
  })

  it('ignores a null (no-frame) fetch result without painting', async () => {
    const timer = fakeTimer()
    const { fetch, resolve } = deferredFetch()
    const states: SeekPreviewState[] = []
    const controller = new SeekPreviewController((s) => states.push(s), fetch, timer)
    controller.setSource('/video/ep.mkv', 100, true)

    controller.hover(0.5)
    timer.run(timer.pending()[0])
    resolve(0, null)
    await Promise.resolve()

    expect(states.at(-1)?.dataUrl).toBeNull()
    expect(states.at(-1)?.visible).toBe(true)
  })
})
