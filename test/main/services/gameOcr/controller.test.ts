import { describe, expect, it, vi } from 'vitest'
import type {
  DisplayCapture,
  DisplayCaptureService
} from '@src/main/services/gameOcr/displayCapture'
import {
  createGameOcrController,
  type GameOcrRecognitionAdapter,
  type GameOcrShortcut
} from '@src/main/services/gameOcr/controller'
import type { GameOcrWindow } from '@src/main/services/gameOcr/frozenFrameWindow'
import type { OcrDisplayBounds, OcrDisplayCaptureMetadata, OcrResult } from '@src/shared/ocr'

type Deferred<T> = {
  promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function capture(id: number, onDispose?: () => void): DisplayCapture {
  const metadata: OcrDisplayCaptureMetadata = {
    displayId: id,
    displayBounds: { x: id * 100, y: 0, width: 640, height: 480 },
    scaleFactor: 1,
    imageSize: { width: 640, height: 480 }
  }
  let imageBase64: string | undefined = `image-${id}`
  return {
    ...metadata,
    metadata,
    imageMediaType: 'image/png',
    get imageBase64() {
      return imageBase64
    },
    get disposed() {
      return imageBase64 === undefined
    },
    dispose() {
      imageBase64 = undefined
      onDispose?.()
    }
  }
}

function result(sessionId: number, captureId: number, text: string): OcrResult {
  return {
    sessionId,
    captureId,
    imageSize: { width: 640, height: 480 },
    regions: [
      {
        id: `region-${captureId}`,
        text,
        bounds: { x: 10, y: 10, width: 80, height: 24 },
        confidence: 0.99
      }
    ]
  }
}

type FakeWindow = GameOcrWindow & {
  triggerDismissed(): void
  triggerClosed(): void
  visible(): boolean
  boundsHistory: OcrDisplayBounds[]
}

function makeWindow(
  id: number,
  events: string[],
  options: { discard?: () => Promise<void> } = {}
): FakeWindow {
  let visible = false
  const closedListeners = new Set<() => void>()
  const dismissedListeners = new Set<() => void>()
  const boundsHistory: OcrDisplayBounds[] = []
  const triggerClosed = (): void => {
    visible = false
    closedListeners.forEach((listener) => listener())
  }
  const discard = vi.fn(async () => {
    events.push(`discard:${id}`)
    if (options.discard) await options.discard()
    visible = false
  })
  return {
    present: vi.fn(async () => {
      events.push(`present:${id}`)
      visible = true
    }),
    setRecognizing: vi.fn(),
    setRegions: vi.fn(),
    rendererReady: vi.fn(),
    moveTo: vi.fn((bounds) => {
      events.push(`moveTo:${id}:${bounds.x}`)
      boundsHistory.push({ ...bounds })
    }),
    discard,
    dismiss: vi.fn(async () => {
      dismissedListeners.forEach((listener) => listener())
      await discard()
    }),
    close: vi.fn(async () => {
      events.push(`close:${id}`)
      triggerClosed()
    }),
    isVisible: () => visible,
    onDismissed: (listener) => {
      dismissedListeners.add(listener)
      return () => dismissedListeners.delete(listener)
    },
    onClosed: (listener) => {
      closedListeners.add(listener)
      return () => closedListeners.delete(listener)
    },
    triggerDismissed: () => {
      visible = false
      dismissedListeners.forEach((listener) => listener())
    },
    triggerClosed,
    visible: () => visible,
    boundsHistory
  }
}

function setup(
  overrides: Partial<Parameters<typeof createGameOcrController>[0]> = {},
  windowOptions: { discard?: () => Promise<void> } = {}
) {
  const events: string[] = []
  const windows: FakeWindow[] = []
  const captures = [capture(1), capture(2), capture(3)]
  const usedCaptures: DisplayCapture[] = []
  let shortcutCallback: (() => void) | undefined
  const shortcut: GameOcrShortcut = {
    register: vi.fn((_accelerator, callback) => {
      shortcutCallback = callback
      return true
    }),
    unregister: vi.fn()
  }
  const captureService: DisplayCaptureService = {
    capture: vi.fn(async () => {
      events.push(`capture:${captures[0]?.displayId}`)
      const next = captures.shift()
      if (!next) throw new Error('no fake capture')
      if (windows.some((window) => window.visible())) throw new Error('captured a visible frame')
      usedCaptures.push(next)
      return next
    })
  }
  const recognitionRequests: Array<{
    request: { sessionId: number; captureId: number }
    deferred: Deferred<OcrResult>
  }> = []
  const ocr: GameOcrRecognitionAdapter = {
    start: vi.fn(async () => undefined),
    recognize: vi.fn(async (request) => {
      events.push(`recognize:${request.captureId}`)
      const pending = deferred<OcrResult>()
      recognitionRequests.push({ request, deferred: pending })
      return pending.promise
    }),
    stop: vi.fn(async () => undefined)
  }
  const base = {
    shortcut,
    accelerator: 'Control+Shift+G',
    capture: captureService,
    settle: {
      settle: vi.fn(async () => {
        events.push('settle')
      })
    },
    createPresentation: vi.fn(() => {
      const window = makeWindow(windows.length + 1, events, windowOptions)
      windows.push(window)
      return window
    }),
    ocr,
    invalidateResults: vi.fn(),
    onResult: vi.fn(),
    onError: vi.fn()
  }
  const controller = createGameOcrController({ ...base, ...overrides })
  return {
    controller,
    events,
    windows,
    captures,
    usedCaptures,
    shortcut,
    get shortcutCallback() {
      return shortcutCallback
    },
    captureService,
    createPresentation: base.createPresentation,
    ocr,
    recognitionRequests,
    settle: base.settle,
    invalidateResults: base.invalidateResults,
    onResult: base.onResult,
    onError: base.onError
  }
}

describe('createGameOcrController', () => {
  it('discards the old frame before settling, capturing, presenting, and recognizing', async () => {
    const fake = setup()
    await expect(fake.controller.arm()).resolves.toBe(true)

    await fake.controller.capture()
    const firstRequest = fake.recognitionRequests[0]
    const secondCapture = fake.controller.capture()
    await secondCapture

    // One window serves both frames: the second capture moves it onto the
    // newly captured display instead of building a replacement. Only that
    // second capture settles — the first had no frame of Kizuna's own on
    // screen for the compositor to repaint.
    expect(fake.events).toEqual([
      'capture:1',
      'present:1',
      'recognize:1',
      'discard:1',
      'settle',
      'capture:2',
      'moveTo:1:200',
      'present:1',
      'recognize:2'
    ])
    expect(fake.windows).toHaveLength(1)
    expect(fake.createPresentation).toHaveBeenCalledOnce()
    expect(fake.windows[0].visible()).toBe(true)
    expect(fake.captures[0]).toBeDefined()

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

  it('never captures while a prior presentation is still visible', async () => {
    const discardGate = deferred<void>()
    const fake = setup({}, { discard: () => discardGate.promise })
    await expect(fake.controller.arm()).resolves.toBe(true)
    await fake.controller.capture()

    const second = fake.controller.capture()
    await Promise.resolve()
    expect(fake.captureService.capture).toHaveBeenCalledOnce()
    expect(fake.windows[0]?.visible()).toBe(true)

    discardGate.resolve()
    await second
    expect(fake.captureService.capture).toHaveBeenCalledTimes(2)
    expect(fake.windows[0]?.visible()).toBe(true)
  })

  it('does not restore stale state when discarding the old frame fails', async () => {
    const fake = setup({}, { discard: async () => Promise.reject(new Error('discard failed')) })
    await fake.controller.arm()
    await fake.controller.capture()
    await fake.controller.capture()

    expect(fake.captureService.capture).toHaveBeenCalledOnce()
    expect(fake.onResult).not.toHaveBeenCalled()
    expect(fake.controller.getStatus()).toMatchObject({ state: 'error' })
    expect(fake.onError).toHaveBeenCalledWith(
      'Game OCR capture failed: discard failed',
      expect.any(Error)
    )
  })

  it('rejects a shortcut conflict without claiming that Game OCR is armed', async () => {
    const fake = setup({
      shortcut: {
        register: vi.fn(() => false),
        unregister: vi.fn()
      }
    })

    await expect(fake.controller.arm()).resolves.toBe(false)
    expect(fake.controller.getStatus()).toMatchObject({
      state: 'error',
      error: 'Game OCR could not be armed.'
    })
    expect(fake.ocr.stop).toHaveBeenCalledOnce()
    expect(fake.shortcutCallback).toBeUndefined()
  })

  it('keeps the old shortcut registered when a rebind conflicts', async () => {
    const register = vi.fn((accelerator: string, callback: () => void) => {
      if (accelerator === 'Alt+O') return false
      fakeCallback = callback
      return true
    })
    let fakeCallback: (() => void) | undefined
    const fake = setup({
      shortcut: { register, unregister: vi.fn() }
    })

    await expect(fake.controller.arm()).resolves.toBe(true)
    await expect(fake.controller.setAccelerator('Alt+O')).resolves.toBe(false)

    expect(fake.controller.getStatus()).toMatchObject({ state: 'armed' })
    expect(register).toHaveBeenNthCalledWith(1, 'Control+Shift+G', expect.any(Function))
    expect(register).toHaveBeenNthCalledWith(2, 'Alt+O', expect.any(Function))
    expect(fake.shortcut.unregister).not.toHaveBeenCalled()
    expect(fake.onError).toHaveBeenCalledWith(
      'The Game OCR shortcut is already in use: Alt+O',
      expect.any(Error)
    )
    expect(fakeCallback).toBeDefined()
  })

  it('stops every active boundary, disposes the capture, and ignores late OCR', async () => {
    const fake = setup()
    await fake.controller.arm()
    await fake.controller.capture()
    const request = fake.recognitionRequests[0]

    await fake.controller.stop()
    expect(fake.controller.getStatus()).toMatchObject({ state: 'off' })
    expect(fake.shortcut.unregister).toHaveBeenCalledWith('Control+Shift+G')
    expect(fake.ocr.stop).toHaveBeenCalledOnce()
    expect(fake.invalidateResults).toHaveBeenCalled()
    expect(fake.windows[0].visible()).toBe(false)

    request.deferred.resolve(result(request.request.sessionId, request.request.captureId, 'late'))
    await Promise.resolve()
    expect(fake.onResult).not.toHaveBeenCalled()
  })

  it('stays in error after a failed frame is dismissed, and re-arms the released shortcut', async () => {
    const fake = setup()
    await fake.controller.arm()
    await fake.controller.capture()
    const request = fake.recognitionRequests[0]

    request.deferred.reject(new Error('the worker died mid-recognition'))
    await vi.waitFor(() => expect(fake.controller.getStatus()).toMatchObject({ state: 'error' }))
    expect(fake.shortcut.unregister).toHaveBeenCalledWith('Control+Shift+G')

    // Dismissing the failed frame must not advertise an armed hotkey that the
    // failure already released.
    fake.windows[0].triggerDismissed()
    expect(fake.controller.getStatus()).toMatchObject({ state: 'error' })

    ;(fake.shortcut.register as ReturnType<typeof vi.fn>).mockClear()
    await expect(fake.controller.arm()).resolves.toBe(true)
    expect(fake.shortcut.register).toHaveBeenCalledWith('Control+Shift+G', expect.any(Function))
    expect(fake.controller.getStatus()).toMatchObject({ state: 'armed' })
  })

  it('releases the encoded screenshot once recognition has finished with it', async () => {
    const fake = setup()
    await fake.controller.arm()
    await fake.controller.capture()
    const request = fake.recognitionRequests[0]
    const used = fake.captures.length

    request.deferred.resolve(result(request.request.sessionId, request.request.captureId, '日本語'))
    await vi.waitFor(() => expect(fake.onResult).toHaveBeenCalledOnce())

    expect(fake.controller.getStatus()).toMatchObject({ state: 'inspecting' })
    expect(fake.usedCaptures[0]?.disposed).toBe(true)
    expect(fake.captures.length).toBe(used)
  })

  it('invalidates recognition when the user dismisses the frozen frame', async () => {
    const fake = setup()
    await fake.controller.arm()
    await fake.controller.capture()
    const request = fake.recognitionRequests[0]

    fake.windows[0].triggerDismissed()
    expect(fake.controller.getStatus()).toMatchObject({ state: 'armed' })
    expect(fake.invalidateResults).toHaveBeenCalled()

    request.deferred.resolve(result(request.request.sessionId, request.request.captureId, 'closed'))
    await Promise.resolve()
    expect(fake.onResult).not.toHaveBeenCalled()
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

  it('skips the compositor settle when the user had already returned to the game', async () => {
    const fake = setup()
    await fake.controller.arm()
    await fake.controller.capture()
    fake.windows[0].triggerDismissed()
    fake.events.length = 0

    await fake.controller.capture()

    // The live game was already on screen, so there is no frame of Kizuna's
    // own for the compositor to repaint and nothing to wait for.
    expect(fake.events).not.toContain('settle')
    expect(fake.settle.settle).not.toHaveBeenCalled()
    expect(fake.captureService.capture).toHaveBeenCalledTimes(2)
  })

  it('presents the capture with its own media type rather than an assumed one', async () => {
    const fake = setup()
    await fake.controller.arm()
    await fake.controller.capture()

    expect(fake.windows[0].present).toHaveBeenCalledWith({
      imageBase64: 'image-1',
      imageMediaType: 'image/png',
      imageSize: { width: 640, height: 480 },
      recognizing: true
    })
  })

  it('reports the stage costs of one capture up to the visible screenshot', async () => {
    let clock = 0
    const onTimings = vi.fn()
    // 2 ms per step: dismiss, capture, present, and the timings read itself.
    const fake = setup({ now: () => (clock += 2), onTimings })
    await fake.controller.arm()
    await fake.controller.capture()

    expect(onTimings).toHaveBeenCalledOnce()
    expect(onTimings.mock.calls[0][0]).toMatchObject({
      sessionId: 1,
      settleMs: 0,
      totalMs: expect.any(Number)
    })
  })

  it('keeps capturing when the timing observer throws', async () => {
    const fake = setup({
      onTimings: () => {
        throw new Error('logging failed')
      }
    })
    await fake.controller.arm()
    await fake.controller.capture()

    expect(fake.controller.getStatus()).toMatchObject({ state: 'recognizing' })
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

    await fake.controller.capture()
    expect(fake.createPresentation).toHaveBeenCalledTimes(2)
    expect(fake.windows).toHaveLength(2)
    expect(fake.windows[1].visible()).toBe(true)
  })

  it('destroys the retained window when Game OCR stops', async () => {
    const fake = setup()
    await fake.controller.arm()
    await fake.controller.capture()

    await fake.controller.stop()
    expect(fake.windows[0].close).toHaveBeenCalledOnce()
    expect(fake.windows[0].visible()).toBe(false)

    // A later run gets a fresh window rather than the closed one.
    await fake.controller.arm()
    await fake.controller.capture()
    expect(fake.createPresentation).toHaveBeenCalledTimes(2)
  })
})
