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
import type { OcrDisplayCaptureMetadata, OcrResult } from '@src/shared/ocr'

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

function makeWindow(
  id: number,
  events: string[],
  options: { close?: () => Promise<void> } = {}
): GameOcrWindow & { triggerClosed(): void; visible(): boolean } {
  let visible = false
  const closedListeners = new Set<() => void>()
  const triggerClosed = (): void => {
    visible = false
    closedListeners.forEach((listener) => listener())
  }
  return {
    present: vi.fn(async () => {
      events.push(`present:${id}`)
      visible = true
    }),
    setRecognizing: vi.fn(),
    setRegions: vi.fn(),
    rendererReady: vi.fn(),
    close: vi.fn(async () => {
      events.push(`close:${id}`)
      if (options.close) await options.close()
      triggerClosed()
    }),
    isVisible: () => visible,
    onClosed: (listener) => {
      closedListeners.add(listener)
      return () => closedListeners.delete(listener)
    },
    triggerClosed,
    visible: () => visible
  }
}

function setup(
  overrides: Partial<Parameters<typeof createGameOcrController>[0]> = {},
  windowOptions: { close?: () => Promise<void> } = {}
) {
  const events: string[] = []
  const windows: Array<GameOcrWindow & { triggerClosed(): void; visible(): boolean }> = []
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

    expect(fake.events).toEqual([
      'settle',
      'capture:1',
      'present:1',
      'recognize:1',
      'close:1',
      'settle',
      'capture:2',
      'present:2',
      'recognize:2'
    ])
    expect(fake.windows[0].visible()).toBe(false)
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

  it('publishes accepted regions to the frame that was captured for them', async () => {
    const fake = setup()
    await fake.controller.arm()
    await fake.controller.capture()
    const firstRequest = fake.recognitionRequests[0]
    await fake.controller.capture()
    const secondRequest = fake.recognitionRequests[1]

    firstRequest.deferred.resolve(result(firstRequest.request.sessionId, 1, 'old'))
    await Promise.resolve()
    expect(fake.windows[0].setRegions).not.toHaveBeenCalled()
    expect(fake.windows[1].setRegions).not.toHaveBeenCalled()

    const fresh = result(secondRequest.request.sessionId, secondRequest.request.captureId, 'new')
    secondRequest.deferred.resolve(fresh)
    await vi.waitFor(() => expect(fake.windows[1].setRegions).toHaveBeenCalledOnce())
    expect(fake.windows[1].setRegions).toHaveBeenCalledWith(fresh)
    expect(fake.windows[0].setRegions).not.toHaveBeenCalled()
    // The sign only covers the recognition it belongs to.
    expect(fake.windows[1].setRecognizing).toHaveBeenCalledWith(false)
  })

  it('never captures while a prior presentation is still visible', async () => {
    const closeGate = deferred<void>()
    const fake = setup({}, { close: () => closeGate.promise })
    await expect(fake.controller.arm()).resolves.toBe(true)
    await fake.controller.capture()

    const second = fake.controller.capture()
    await Promise.resolve()
    expect(fake.captureService.capture).toHaveBeenCalledOnce()
    expect(fake.windows[0]?.visible()).toBe(true)

    closeGate.resolve()
    await second
    expect(fake.captureService.capture).toHaveBeenCalledTimes(2)
    expect(fake.windows[0]?.visible()).toBe(false)
  })

  it('does not restore stale state when closing the old frame fails', async () => {
    const fake = setup({}, { close: async () => Promise.reject(new Error('close failed')) })
    await fake.controller.arm()
    await fake.controller.capture()
    await fake.controller.capture()

    expect(fake.captureService.capture).toHaveBeenCalledOnce()
    expect(fake.onResult).not.toHaveBeenCalled()
    expect(fake.controller.getStatus()).toMatchObject({ state: 'error' })
    expect(fake.onError).toHaveBeenCalledWith('Game OCR capture failed.', expect.any(Error))
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

  it('stays in error after a failed frame is closed, and re-arms the released shortcut', async () => {
    const fake = setup()
    await fake.controller.arm()
    await fake.controller.capture()
    const request = fake.recognitionRequests[0]

    request.deferred.reject(new Error('the worker died mid-recognition'))
    await vi.waitFor(() => expect(fake.controller.getStatus()).toMatchObject({ state: 'error' }))
    expect(fake.shortcut.unregister).toHaveBeenCalledWith('Control+Shift+G')

    // Closing the failed frame must not advertise an armed hotkey that the
    // failure already released.
    fake.windows[0].triggerClosed()
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

  it('invalidates recognition when the user closes the frozen frame', async () => {
    const fake = setup()
    await fake.controller.arm()
    await fake.controller.capture()
    const request = fake.recognitionRequests[0]

    fake.windows[0].triggerClosed()
    expect(fake.controller.getStatus()).toMatchObject({ state: 'armed' })
    expect(fake.invalidateResults).toHaveBeenCalled()

    request.deferred.resolve(result(request.request.sessionId, request.request.captureId, 'closed'))
    await Promise.resolve()
    expect(fake.onResult).not.toHaveBeenCalled()
  })
})
