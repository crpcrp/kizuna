// Capture and recognition flow: latest-request-wins, stale-result rejection,
// window-capture fallback, and the retained frozen frame. Driven through the
// controller facade, which is the only way a capture session is created.

import { describe, expect, it, vi } from 'vitest'
import type { GameOcrCaptureTargets } from '@src/main/services/gameOcr/captureTarget'
import { deferred } from '@test/harness/deferred'
import { result, setupGameOcr as setup, target, windowTarget } from '@test/harness/fakeGameOcr'

describe('Game OCR capture sessions', () => {
  it('sends a cached capture to the renderer before yielding the shortcut callback', async () => {
    const targets: GameOcrCaptureTargets = {
      resolve: vi.fn(() => target(1)),
      invalidate: vi.fn(),
      dispose: vi.fn()
    }
    const fake = setup({ targets })
    await fake.controller.arm()

    const capture = fake.controller.capture()

    // No Promise boundary exists before freeze sends its renderer IPC.
    expect(fake.createPresentation).toHaveBeenCalledOnce()
    expect(fake.windows[0].freeze).toHaveBeenCalledOnce()
    await capture
  })

  it('recaptures in place without hiding the retained frame', async () => {
    const fake = setup()
    await expect(fake.controller.arm()).resolves.toBe(true)

    await fake.controller.capture()
    const firstRequest = fake.recognitionRequests[0]
    const secondCapture = fake.controller.capture()
    await secondCapture

    // One capture-protected window serves both frames. The existing screenshot
    // stays visible until the canvas is replaced, so there is no discard,
    // native hide, or compositor wait on the shortcut path.
    expect(fake.events).toEqual([
      'capture:1',
      'present:1',
      'recognize:1',
      'capture:2',
      'moveTo:1:200',
      'present:1',
      'recognize:2'
    ])
    expect(fake.windows).toHaveLength(1)
    expect(fake.createPresentation).toHaveBeenCalledOnce()
    expect(fake.windows[0].visible()).toBe(true)
    expect(fake.queue[0]).toBeDefined()

    const secondRequest = fake.recognitionRequests[1]
    firstRequest.deferred.resolve(result(firstRequest.request.sessionId, 1, 'old'))
    await Promise.resolve()
    expect(fake.onResult).not.toHaveBeenCalled()

    secondRequest.deferred.resolve(result(secondRequest.request.sessionId, 2, 'new'))
    await vi.waitFor(() => expect(fake.onResult).toHaveBeenCalledOnce())
    expect(fake.onResult).toHaveBeenCalledOnce()
    expect(fake.onResult).toHaveBeenCalledWith(
      result(secondRequest.request.sessionId, secondRequest.request.captureId, 'new')
    )
  })

  it('publishes accepted regions only for the capture they belong to', async () => {
    const fake = setup()
    await fake.controller.arm()
    await fake.controller.capture()
    const firstRequest = fake.recognitionRequests[0]
    await fake.controller.capture()
    const secondRequest = fake.recognitionRequests[1]
    const frame = fake.windows[0]

    firstRequest.deferred.resolve(result(firstRequest.request.sessionId, 1, 'old'))
    await Promise.resolve()
    expect(frame.setRegions).not.toHaveBeenCalled()

    const fresh = result(secondRequest.request.sessionId, secondRequest.request.captureId, 'new')
    secondRequest.deferred.resolve(fresh)
    await vi.waitFor(() => expect(frame.setRegions).toHaveBeenCalledOnce())
    expect(frame.setRegions).toHaveBeenCalledWith(fresh)
    // The sign only covers the recognition it belongs to.
    expect(frame.setRecognizing).toHaveBeenCalledWith(false)
  })

  it('does not wait for renderer discard before a visible recapture', async () => {
    const discardGate = deferred<void>()
    const fake = setup({}, { discard: () => discardGate.promise })
    await expect(fake.controller.arm()).resolves.toBe(true)
    await fake.controller.capture()

    const second = fake.controller.capture()
    await second
    expect(fake.targets.resolve).toHaveBeenCalledTimes(2)
    expect(fake.windows[0].discard).not.toHaveBeenCalled()
    expect(fake.windows[0]?.visible()).toBe(true)
    discardGate.resolve()
  })

  it('starts a newer capture without waiting for an obsolete freeze', async () => {
    const firstFreeze = deferred<{ width: number; height: number }>()
    const fake = setup(
      {},
      {
        freeze: (request) =>
          request.captureId === 1 ? firstFreeze.promise : Promise.resolve(request.imageSize)
      }
    )
    await fake.controller.arm()

    const first = fake.controller.capture()
    await vi.waitFor(() => expect(fake.windows[0]?.freeze).toHaveBeenCalledOnce())
    const second = fake.controller.capture()

    await second
    expect(fake.windows[0].freeze).toHaveBeenCalledTimes(2)
    expect(fake.recognitionRequests[0]?.request.captureId).toBe(2)

    firstFreeze.resolve({ width: 640, height: 480 })
    await first
    expect(fake.recognitionRequests).toHaveLength(1)
  })

  it('registers the OCR-byte waiter before asking the renderer to draw', async () => {
    const fake = setup()
    await fake.controller.arm()
    await fake.controller.capture()
    const frame = fake.windows[0]

    // Registering first closes the race where a fast encode arrives before
    // main starts listening; the renderer still encodes only after drawing.
    expect(frame.freeze).toHaveBeenCalledOnce()
    expect(frame.captureBytes).toHaveBeenCalledWith(1)
    expect(frame.captureBytes.mock.invocationCallOrder[0]).toBeLessThan(
      frame.freeze.mock.invocationCallOrder[0]
    )

    const request = fake.recognitionRequests[0]
    request.deferred.resolve(result(request.request.sessionId, request.request.captureId, '日本語'))
    await vi.waitFor(() => expect(fake.onResult).toHaveBeenCalledOnce())
    expect(fake.controller.getStatus()).toMatchObject({ state: 'inspecting' })
  })

  it('passes the selected display source to the frame', async () => {
    const fake = setup()
    await fake.controller.arm()
    await fake.controller.capture()

    expect(fake.windows[0].freeze).toHaveBeenLastCalledWith({
      sessionId: 1,
      captureId: 1,
      sourceId: 'screen:1:0',
      targetKind: 'display',
      imageSize: { width: 640, height: 480 }
    })

    await fake.controller.capture()
    expect(fake.windows[0].freeze).toHaveBeenLastCalledWith(
      expect.objectContaining({ sourceId: 'screen:2:0' })
    )
  })

  it('reports why recognition failed, not only that it failed', async () => {
    const fake = setup()
    await fake.controller.arm()
    await fake.controller.capture()

    fake.recognitionRequests[0].deferred.reject(
      new Error('PP-OCR worker rejected the request: request failed: invalid recognition request')
    )

    await vi.waitFor(() =>
      expect(fake.controller.getStatus()).toMatchObject({
        state: 'error',
        error:
          'Game OCR recognition failed: PP-OCR worker rejected the request: ' +
          'request failed: invalid recognition request'
      })
    )
  })

  it('falls back to the bare stage when the failure carries no message', async () => {
    const fake = setup()
    await fake.controller.arm()
    await fake.controller.capture()

    fake.recognitionRequests[0].deferred.reject(new Error(''))

    await vi.waitFor(() =>
      expect(fake.controller.getStatus()).toMatchObject({
        state: 'error',
        error: 'Game OCR recognition failed.'
      })
    )
  })

  it('captures immediately after dismissal without a compositor wait', async () => {
    const fake = setup()
    await fake.controller.arm()
    await fake.controller.capture()
    fake.windows[0].triggerDismissed()
    fake.events.length = 0

    await fake.controller.capture()

    expect(fake.events).toEqual(['capture:2', 'moveTo:1:200', 'present:1', 'recognize:2'])
    expect(fake.targets.resolve).toHaveBeenCalledTimes(2)
  })

  it('freezes the display the pointer is on', async () => {
    const fake = setup()
    await fake.controller.arm()
    await fake.controller.capture()

    expect(fake.windows[0].freeze).toHaveBeenCalledWith(
      expect.objectContaining({ sourceId: 'screen:1:0', imageSize: { width: 640, height: 480 } })
    )
  })

  it('reports shortcut-to-word-box timing only after the renderer paints the boxes', async () => {
    let clock = 0
    const onTimings = vi.fn()
    const fake = setup({ now: () => (clock += 2), onTimings })
    await fake.controller.arm()
    await fake.controller.capture()

    expect(onTimings).not.toHaveBeenCalled()
    const request = fake.recognitionRequests[0]
    request.deferred.resolve(result(request.request.sessionId, request.request.captureId, 'text'))
    await vi.waitFor(() => expect(fake.windows[0].setRegions).toHaveBeenCalledOnce())
    expect(onTimings).not.toHaveBeenCalled()

    fake.windows[0].triggerRegionsRendered(request.request)
    expect(onTimings).toHaveBeenCalledOnce()
    expect(onTimings.mock.calls[0][0]).toMatchObject({
      sessionId: 1,
      captureId: 1,
      settleMs: 0,
      cursorMs: 0,
      displayMs: 0,
      sourceMs: 0,
      captureEventLoopMs: expect.any(Number),
      targetCacheHit: false,
      sourceCacheHit: false,
      recognizeMs: expect.any(Number),
      renderMs: expect.any(Number),
      totalMs: expect.any(Number)
    })

    // A capture reports once; a repeated paint acknowledgement adds nothing.
    fake.windows[0].triggerRegionsRendered(request.request)
    expect(onTimings).toHaveBeenCalledOnce()
  })

  it('keeps capturing when the timing observer throws', async () => {
    const fake = setup({
      onTimings: () => {
        throw new Error('logging failed')
      }
    })
    await fake.controller.arm()
    await fake.controller.capture()
    const request = fake.recognitionRequests[0]
    request.deferred.resolve(result(request.request.sessionId, request.request.captureId, 'text'))
    await vi.waitFor(() => expect(fake.windows[0].setRegions).toHaveBeenCalledOnce())
    fake.windows[0].triggerRegionsRendered(request.request)

    expect(fake.controller.getStatus()).toMatchObject({ state: 'inspecting' })
    expect(fake.onError).not.toHaveBeenCalled()
  })

  it('reuses the retained window across frames and rebuilds it after one is destroyed', async () => {
    const fake = setup()
    await fake.controller.arm()
    await fake.controller.capture()
    await fake.controller.capture()

    expect(fake.createPresentation).toHaveBeenCalledOnce()
    // The second capture landed on another display, so the retained window
    // followed it rather than staying on the first display's bounds.
    expect(fake.windows[0].boundsHistory).toEqual([{ x: 200, y: 0, width: 640, height: 480 }])

    // A display change or a dead renderer destroys the window; the next
    // capture must build a replacement instead of reusing a dead one.
    fake.windows[0].triggerClosed()
    expect(fake.controller.getStatus()).toMatchObject({ state: 'armed' })
    expect(fake.targets.invalidate).toHaveBeenCalledOnce()

    await fake.controller.capture()
    expect(fake.createPresentation).toHaveBeenCalledTimes(2)
    expect(fake.windows).toHaveLength(2)
    expect(fake.windows[1].visible()).toBe(true)
  })
})

describe('Game OCR focused-window capture', () => {
  it('covers only the window, and sends only its pixels to OCR', async () => {
    // The acceptance criterion: a 1024x768 game on a 2560x1440 display.
    const fake = setup({
      queue: [windowTarget('1902762', { x: 120, y: 80, width: 1024, height: 768 })]
    })
    await fake.controller.arm()
    await fake.controller.capture()

    expect(fake.createPresentation).toHaveBeenCalledWith({
      x: 120,
      y: 80,
      width: 1024,
      height: 768
    })
    expect(fake.windows[0].freeze).toHaveBeenLastCalledWith({
      sessionId: 1,
      captureId: 1,
      sourceId: 'window:1902762:0',
      targetKind: 'window',
      imageSize: { width: 1024, height: 768 }
    })
    expect(fake.recognitionRequests[0]?.request).toMatchObject({
      imageSize: { width: 1024, height: 768 }
    })
  })

  it('moves and resizes the retained overlay when the user alt-tabs', async () => {
    const fake = setup({
      queue: [
        windowTarget('111', { x: 120, y: 80, width: 1024, height: 768 }),
        windowTarget('222', { x: -1500, y: 40, width: 800, height: 600 })
      ]
    })
    await fake.controller.arm()
    await fake.controller.capture()
    await fake.controller.capture()

    // One retained window serves both games; only its rectangle changes.
    expect(fake.createPresentation).toHaveBeenCalledOnce()
    expect(fake.windows[0].boundsHistory).toEqual([{ x: -1500, y: 40, width: 800, height: 600 }])
    expect(fake.windows[0].freeze).toHaveBeenLastCalledWith(
      expect.objectContaining({ sourceId: 'window:222:0' })
    )
  })

  it('reports what it captured, without a full executable path', async () => {
    const diagnostics: string[] = []
    const fake = setup({
      onDiagnostic: (message: string) => diagnostics.push(message),
      queue: [windowTarget('1902762', { x: 0, y: 0, width: 1024, height: 768 })]
    })
    await fake.controller.arm()
    await fake.controller.capture()

    expect(diagnostics).toEqual(['[game-ocr] target window game.exe (pid 4321) 1024x768'])
  })

  it('falls back to display capture when the window will not freeze', async () => {
    // Exclusive fullscreen, a protected surface, and a handle Chromium
    // declines all arrive here as a freeze failure.
    const fake = setup(
      {
        queue: [windowTarget('1902762', { x: 0, y: 0, width: 1024, height: 768 }), target(2)]
      },
      {
        freeze: async (request) => {
          if (request.captureId === 1) throw new Error('capture is not available for this window')
          return request.imageSize
        }
      }
    )
    await fake.controller.arm()
    await fake.controller.capture()

    // Game OCR stays armed and a frame still appears: the user sees a display
    // capture, not an error.
    expect(fake.controller.getStatus().state).toBe('recognizing')
    expect(fake.windows[0].freeze).toHaveBeenLastCalledWith(
      expect.objectContaining({ sourceId: 'screen:2:0', targetKind: 'display' })
    )
    expect(fake.onError).not.toHaveBeenCalled()
  })

  it('retries a failed window capture under a fresh capture identity', async () => {
    const fake = setup(
      {
        queue: [windowTarget('1902762', { x: 0, y: 0, width: 1024, height: 768 }), target(2)]
      },
      {
        freeze: async (request) => {
          if (request.captureId === 1) throw new Error('capture is not available for this window')
          return request.imageSize
        }
      }
    )
    await fake.controller.arm()
    await fake.controller.capture()

    // The abandoned window capture's late reply must not be mistaken for the
    // display capture that replaced it.
    expect(fake.recognitionRequests).toHaveLength(1)
    expect(fake.recognitionRequests[0]?.request.captureId).toBe(2)
  })

  it('still fails a display capture that cannot freeze, so the user is told', async () => {
    const fake = setup(
      { queue: [target(1)] },
      {
        freeze: async () => {
          throw new Error('display capture denied')
        }
      }
    )
    await fake.controller.arm()
    await fake.controller.capture()

    expect(fake.controller.getStatus()).toMatchObject({ state: 'error' })
    expect(fake.onError).toHaveBeenCalledWith(
      expect.stringContaining('display capture denied'),
      expect.anything()
    )
  })

  it('drops an in-flight capture whose target the user has already left', async () => {
    const freezeGate = deferred<{ width: number; height: number }>()
    const fake = setup(
      {
        queue: [
          windowTarget('111', { x: 0, y: 0, width: 1024, height: 768 }),
          windowTarget('222', { x: 0, y: 0, width: 800, height: 600 })
        ]
      },
      {
        freeze: async (request) =>
          request.captureId === 1 ? freezeGate.promise : request.imageSize
      }
    )
    await fake.controller.arm()

    const first = fake.controller.capture()
    const second = fake.controller.capture()
    freezeGate.resolve({ width: 1024, height: 768 })
    await Promise.all([first, second])

    // Only the window the user is actually looking at is recognized.
    expect(fake.recognitionRequests).toHaveLength(1)
    expect(fake.recognitionRequests[0]?.request).toMatchObject({
      captureId: 2,
      imageSize: { width: 800, height: 600 }
    })
  })

  it('records the target kind and foreground cost in the latency report', async () => {
    const timings: Array<{ targetKind: string; foregroundMs: number }> = []
    const fake = setup({
      onTimings: (value: { targetKind: string; foregroundMs: number }) => timings.push(value),
      queue: [
        {
          ...windowTarget('1902762', { x: 0, y: 0, width: 1024, height: 768 }),
          diagnostics: {
            cursorMs: 0,
            displayMs: 0,
            sourceMs: 0,
            foregroundMs: 3,
            targetCacheHit: false,
            sourceCacheHit: false
          }
        }
      ]
    })
    await fake.controller.arm()
    await fake.controller.capture()
    fake.recognitionRequests[0]?.deferred.resolve(result(1, 1, '日本語'))
    await Promise.resolve()
    await Promise.resolve()
    fake.windows[0].triggerRegionsRendered({ sessionId: 1, captureId: 1 })

    expect(timings[0]).toMatchObject({ targetKind: 'window', foregroundMs: 3 })
  })
})
