import { describe, it, expect, vi } from 'vitest'
import {
  createSidebarTranslationController,
  placeSidebarTranslationPopup,
  type SidebarTranslationPopup
} from '@src/renderer/src/state/sidebarTranslation'
import { cueKey } from '@src/renderer/src/state/tokenization'
import type { Cue } from '@src/shared/cue'
import { deferred } from '@test/harness/deferred'

const cueA: Cue = { start: 0, end: 2, text: 'hello' }
const cueB: Cue = { start: 3, end: 5, text: 'world' }

describe('createSidebarTranslationController', () => {
  const anchor = { top: 10, left: 20 }

  it('shows loading, then the resolved translation', async () => {
    const changes: Array<SidebarTranslationPopup | null> = []
    const controller = createSidebarTranslationController(
      (popup) => changes.push(popup),
      () => 'request-1',
      vi.fn()
    )
    const translation = deferred<string>()

    controller.open(cueKey(cueA), anchor, () => translation.promise)
    expect(changes).toEqual([{ anchor, cueKey: cueKey(cueA), status: 'loading' }])

    translation.resolve('Hello')
    await translation.promise
    await Promise.resolve()
    expect(changes.at(-1)).toEqual({ anchor, cueKey: cueKey(cueA), status: 'done', text: 'Hello' })
  })

  it('shows an error when translation rejects', async () => {
    const changes: Array<SidebarTranslationPopup | null> = []
    const controller = createSidebarTranslationController(
      (popup) => changes.push(popup),
      () => 'request-1',
      vi.fn()
    )
    const translation = deferred<string>()

    controller.open(cueKey(cueA), anchor, () => translation.promise)
    translation.reject(new Error('offline'))
    await translation.promise.catch(() => undefined)
    await Promise.resolve()

    expect(changes.at(-1)).toEqual({ anchor, cueKey: cueKey(cueA), status: 'error' })
  })

  it('uses the per-cue cache and ignores a repeat click while that cue is loading', async () => {
    const changes: Array<SidebarTranslationPopup | null> = []
    const controller = createSidebarTranslationController(
      (popup) => changes.push(popup),
      () => 'request-1',
      vi.fn()
    )
    const translation = deferred<string>()
    const request = vi.fn(() => translation.promise)

    controller.open(cueKey(cueA), anchor, request)
    controller.open(cueKey(cueA), { top: 11, left: 21 }, request)
    expect(request).toHaveBeenCalledOnce()

    translation.resolve('Hello')
    await translation.promise
    await Promise.resolve()
    controller.open(cueKey(cueA), { top: 12, left: 22 }, request)

    expect(request).toHaveBeenCalledOnce()
    expect(changes.at(-1)).toEqual({
      anchor: { top: 12, left: 22 },
      cueKey: cueKey(cueA),
      status: 'done',
      text: 'Hello'
    })
  })

  it('discards a late result after a newer row is opened', async () => {
    const changes: Array<SidebarTranslationPopup | null> = []
    const controller = createSidebarTranslationController(
      (popup) => changes.push(popup),
      () => 'request-1',
      vi.fn()
    )
    const first = deferred<string>()
    const second = deferred<string>()

    controller.open(cueKey(cueA), anchor, () => first.promise)
    controller.open(cueKey(cueB), { top: 30, left: 40 }, () => second.promise)
    first.resolve('stale')
    await first.promise
    await Promise.resolve()
    expect(changes.at(-1)).toEqual({
      anchor: { top: 30, left: 40 },
      cueKey: cueKey(cueB),
      status: 'loading'
    })

    second.resolve('current')
    await second.promise
    await Promise.resolve()
    expect(changes.at(-1)).toEqual({
      anchor: { top: 30, left: 40 },
      cueKey: cueKey(cueB),
      status: 'done',
      text: 'current'
    })
  })

  it('clears the popup and invalidates its in-flight request', async () => {
    const changes: Array<SidebarTranslationPopup | null> = []
    const cancel = vi.fn()
    const controller = createSidebarTranslationController(
      (popup) => changes.push(popup),
      () => 'request-1',
      cancel
    )
    const translation = deferred<string>()

    controller.open(cueKey(cueA), anchor, () => translation.promise)
    controller.close()
    translation.resolve('too late')
    await translation.promise
    await Promise.resolve()

    expect(changes.at(-1)).toBeNull()
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(cancel).toHaveBeenCalledWith('request-1')
  })

  it('cancels the first request exactly once before opening a newer row', () => {
    const changes: Array<SidebarTranslationPopup | null> = []
    const createRequestId = vi.fn().mockReturnValueOnce('first').mockReturnValueOnce('second')
    const cancel = vi.fn()
    const controller = createSidebarTranslationController(
      (popup) => changes.push(popup),
      createRequestId,
      cancel
    )
    const first = deferred<string>()
    const second = deferred<string>()

    controller.open(cueKey(cueA), anchor, () => first.promise)
    controller.open(cueKey(cueB), { top: 30, left: 40 }, () => second.promise)

    expect(cancel).toHaveBeenCalledTimes(1)
    expect(cancel).toHaveBeenCalledWith('first')
    expect(changes.at(-1)).toEqual({
      anchor: { top: 30, left: 40 },
      cueKey: cueKey(cueB),
      status: 'loading'
    })
  })

  it('does not cancel a request after it has completed successfully', async () => {
    const changes: Array<SidebarTranslationPopup | null> = []
    const cancel = vi.fn()
    const controller = createSidebarTranslationController(
      (popup) => changes.push(popup),
      () => 'request-1',
      cancel
    )
    const translation = deferred<string>()

    controller.open(cueKey(cueA), anchor, () => translation.promise)
    translation.resolve('Hello')
    await translation.promise
    await Promise.resolve()
    controller.close()
    controller.open(cueKey(cueA), { top: 11, left: 21 }, () => Promise.resolve('unused'))

    expect(cancel).not.toHaveBeenCalled()
  })
})

describe('placeSidebarTranslationPopup', () => {
  const viewport = { width: 400, height: 300 }
  const popup = { width: 100, height: 60 }

  it('places a top-edge row below and clamps the left edge', () => {
    expect(
      placeSidebarTranslationPopup({ top: 4, left: 0, width: 20, bottom: 24 }, popup, viewport)
    ).toEqual({ top: 32, left: 8, placement: 'below' })
  })

  it('places a bottom-edge row above and clamps the right edge', () => {
    expect(
      placeSidebarTranslationPopup({ top: 280, left: 390, width: 20, bottom: 300 }, popup, viewport)
    ).toEqual({ top: 212, left: 292, placement: 'above' })
  })

  it('pins an oversized popup to the viewport margin', () => {
    expect(
      placeSidebarTranslationPopup(
        { top: 100, left: 100, width: 20, bottom: 120 },
        { width: 500, height: 400 },
        viewport
      )
    ).toEqual({ top: 8, left: 8, placement: 'below' })
  })

  it('keeps exact-fit boundaries at the viewport margin', () => {
    expect(
      placeSidebarTranslationPopup(
        { top: 76, left: 8, width: 20, bottom: 96 },
        { width: 384, height: 60 },
        viewport
      )
    ).toEqual({ top: 8, left: 8, placement: 'above' })
  })
})
