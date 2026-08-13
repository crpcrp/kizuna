import { describe, expect, it, vi } from 'vitest'
import type {
  GameOcrDisplaySources,
  GameOcrDisplayTarget
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

function target(id: number): GameOcrDisplayTarget {
  const metadata: OcrDisplayCaptureMetadata = {
    displayId: id,
    displayBounds: { x: id * 100, y: 0, width: 640, height: 480 },
    scaleFactor: 1,
    imageSize: { width: 640, height: 480 }
  }
  return { metadata, sourceId: `screen:${id}:0` }
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

type FakeWindow = Omit<GameOcrWindow, 'freeze' | 'captureBytes'> & {
  freeze: ReturnType<typeof vi.fn>
  captureBytes: ReturnType<typeof vi.fn>
  triggerDismissed(): void
  triggerClosed(): void
  triggerRegionsRendered(value: { sessionId: number; captureId: number }): void
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
  const regionsRenderedListeners = new Set<
    (value: { sessionId: number; captureId: number }) => void
  >()
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
  const bytes = new Map<number, { resolve(value: string): void; promise: Promise<string> }>()
  return {
    freeze: vi.fn(async (request) => {
      events.push(`present:${id}`)
      visible = true
      return request.imageSize
    }),
    captureBytes: vi.fn((captureId: number) => {
      const existing = bytes.get(captureId)
      if (existing) return existing.promise
      let resolve!: (value: string) => void
      const promise = new Promise<string>((r) => {
        resolve = r
      })
      bytes.set(captureId, { promise, resolve })
      // The renderer encodes after the frame is up; the fake answers on the
      // next turn so the ordering the controller relies on is exercised.
      queueMicrotask(() => resolve(`image-${captureId}`))
      return promise
    }),
    reportFrozen: vi.fn(),
    reportCaptureBytes: vi.fn(),
    reportRegionsRendered: vi.fn(),
    setRecognizing: vi.fn(),
    setRegions: vi.fn(),
    rendererReady: vi.fn(),
    copySelection: vi.fn(),
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
    onRegionsRendered: (listener) => {
      regionsRenderedListeners.add(listener)
      return () => regionsRenderedListeners.delete(listener)
    },
    triggerDismissed: () => {
      visible = false
      dismissedListeners.forEach((listener) => listener())
    },
    triggerClosed,
    triggerRegionsRendered: (value) => {
      regionsRenderedListeners.forEach((listener) => listener(value))
    },
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
  const targets = [target(1), target(2), target(3)]
  const usedTargets: GameOcrDisplayTarget[] = []
  let shortcutCallback: (() => void) | undefined
  const shortcut: GameOcrShortcut = {
    register: vi.fn((_accelerator, callback) => {
      shortcutCallback = callback
      return true
    }),
    unregister: vi.fn()
  }
  const displays: GameOcrDisplaySources = {
    cursorDisplay: vi.fn(async () => {
      events.push(`capture:${targets[0]?.metadata.displayId}`)
      const next = targets.shift()
      if (!next) throw new Error('no fake display')
      usedTargets.push(next)
      return next
    }),
    invalidate: vi.fn()
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
    displays,
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
  const controller = createGameOcrController({
    ...base,
    ...overrides
  } as Parameters<typeof createGameOcrController>[0])
  return {
    controller,
    events,
    windows,
    targets,
    usedTargets,
    shortcut,
    get shortcutCallback() {
      return shortcutCallback
    },
    displays,
    createPresentation: base.createPresentation,
    ocr,
    recognitionRequests,
    invalidateResults: base.invalidateResults,
    onResult: base.onResult,
    onError: base.onError
  }
}

describe('createGameOcrController', () => {
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
    expect(fake.targets[0]).toBeDefined()

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
    expect(fake.displays.cursorDisplay).toHaveBeenCalledTimes(2)
    expect(fake.windows[0].discard).not.toHaveBeenCalled()
    expect(fake.windows[0]?.visible()).toBe(true)
    discardGate.resolve()
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
      imageSize: { width: 640, height: 480 }
    })

    await fake.controller.capture()
    expect(fake.windows[0].freeze).toHaveBeenLastCalledWith(
      expect.objectContaining({ sourceId: 'screen:2:0' })
    )
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

  it('claims Escape and Ctrl+C only while a frame is on screen', async () => {
    const fake = setup()
    await fake.controller.arm()
    const registered = (): string[] =>
      (fake.shortcut.register as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[0])

    // Arming claims the capture hotkey and nothing else: Escape and Ctrl+C
    // belong to the game until a frame is actually covering it.
    expect(registered()).toEqual(['Control+Shift+G'])

    await fake.controller.capture()
    expect(registered()).toEqual(['Control+Shift+G', 'Escape', 'CommandOrControl+C'])
    expect(fake.shortcut.unregister).not.toHaveBeenCalled()

    fake.windows[0].triggerDismissed()
    expect(fake.shortcut.unregister).toHaveBeenCalledWith('Escape')
    expect(fake.shortcut.unregister).toHaveBeenCalledWith('CommandOrControl+C')
    expect(fake.shortcut.unregister).not.toHaveBeenCalledWith('Control+Shift+G')
  })

  it('dismisses the frame from Escape and copies the selection from Ctrl+C', async () => {
    const handlers = new Map<string, () => void>()
    const fake = setup({
      shortcut: {
        register: vi.fn((accelerator: string, callback: () => void) => {
          handlers.set(accelerator, callback)
          return true
        }),
        unregister: vi.fn()
      }
    })
    await fake.controller.arm()
    await fake.controller.capture()
    const frame = fake.windows[0]

    handlers.get('CommandOrControl+C')?.()
    expect(frame.copySelection).toHaveBeenCalledOnce()
    expect(frame.dismiss).not.toHaveBeenCalled()

    handlers.get('Escape')?.()
    await vi.waitFor(() => expect(frame.dismiss).toHaveBeenCalledOnce())
    expect(fake.controller.getStatus()).toMatchObject({ state: 'armed' })
  })

  it('keeps the frame usable when Escape is already taken by something else', async () => {
    const fake = setup({
      shortcut: {
        register: vi.fn((accelerator: string) => accelerator !== 'Escape'),
        unregister: vi.fn()
      }
    })
    await fake.controller.arm()
    await fake.controller.capture()

    // A conflict is reported, not fatal: the background press still closes it.
    expect(fake.onError).toHaveBeenCalledWith(
      expect.stringContaining('could not claim Escape'),
      expect.any(Error)
    )
    expect(fake.controller.getStatus()).toMatchObject({ state: 'recognizing' })
    expect(fake.windows[0].visible()).toBe(true)
  })

  it('releases the frame shortcuts when Game OCR stops with a frame open', async () => {
    const fake = setup()
    await fake.controller.arm()
    await fake.controller.capture()

    await fake.controller.stop()

    expect(fake.shortcut.unregister).toHaveBeenCalledWith('Escape')
    expect(fake.shortcut.unregister).toHaveBeenCalledWith('CommandOrControl+C')
    expect(fake.shortcut.unregister).toHaveBeenCalledWith('Control+Shift+G')
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
    expect(fake.displays.cursorDisplay).toHaveBeenCalledTimes(2)
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
      recognizeMs: expect.any(Number),
      renderMs: expect.any(Number),
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
