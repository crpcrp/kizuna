// Fakes for every boundary the Game OCR controller touches: Electron's global
// shortcut, the capture-target resolver, the frozen-frame window, and the OCR
// adapter. Shared by the lifecycle (controller) and capture-session suites.

import { vi } from 'vitest'
import type {
  GameOcrCaptureTarget,
  GameOcrCaptureTargets,
  GameOcrDisplayCaptureTarget,
  GameOcrWindowCaptureTarget
} from '@src/main/services/gameOcr/captureTarget'
import {
  createGameOcrController,
  type GameOcrRecognitionAdapter,
  type GameOcrShortcut
} from '@src/main/services/gameOcr/controller'
import type { GameOcrWindow } from '@src/main/services/gameOcr/frozenFrameController'
import type { OcrDisplayBounds, OcrResult } from '@src/shared/ocr'
import { deferred, type Deferred } from './deferred'

export function target(id: number): GameOcrDisplayCaptureTarget {
  return {
    kind: 'display',
    sourceId: `screen:${id}:0`,
    bounds: { x: id * 100, y: 0, width: 640, height: 480 },
    expectedImageSize: { width: 640, height: 480 }
  }
}

/** `capture:<hwnd>` for a window, `capture:<display number>` for a display. */
function captureLabel(target: GameOcrCaptureTarget): string {
  return target.kind === 'window' ? target.hwnd : String(target.bounds.x / 100)
}

export function windowTarget(
  hwnd: string,
  bounds: OcrDisplayBounds,
  overrides: Partial<GameOcrWindowCaptureTarget> = {}
): GameOcrWindowCaptureTarget {
  return {
    kind: 'window',
    sourceId: `window:${hwnd}:0`,
    hwnd,
    pid: 4321,
    executableName: 'game.exe',
    bounds,
    expectedImageSize: { width: bounds.width, height: bounds.height },
    ...overrides
  }
}

export function result(sessionId: number, captureId: number, text: string): OcrResult {
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

export type FakeWindow = Omit<GameOcrWindow, 'freeze' | 'captureBytes'> & {
  freeze: ReturnType<typeof vi.fn>
  captureBytes: ReturnType<typeof vi.fn>
  triggerDismissed(): void
  triggerClosed(): void
  triggerRegionsRendered(value: { sessionId: number; captureId: number }): void
  visible(): boolean
  boundsHistory: OcrDisplayBounds[]
}

export interface FakeWindowOptions {
  discard?: () => Promise<void>
  freeze?: (request: {
    captureId: number
    imageSize: { width: number; height: number }
  }) => Promise<{ width: number; height: number }>
}

function makeWindow(id: number, events: string[], options: FakeWindowOptions = {}): FakeWindow {
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
  const bytes = new Map<
    number,
    { resolve(value: Uint8Array): void; promise: Promise<Uint8Array> }
  >()
  return {
    freeze: vi.fn(async (request) => {
      events.push(`present:${id}`)
      const imageSize = options.freeze ? await options.freeze(request) : request.imageSize
      visible = true
      return imageSize
    }),
    captureBytes: vi.fn((captureId: number) => {
      const existing = bytes.get(captureId)
      if (existing) return existing.promise
      let resolve!: (value: Uint8Array) => void
      const promise = new Promise<Uint8Array>((r) => {
        resolve = r
      })
      bytes.set(captureId, { promise, resolve })
      // The renderer encodes after the frame is up; the fake answers on the
      // next turn so the ordering the controller relies on is exercised.
      queueMicrotask(() => resolve(Uint8Array.of(captureId)))
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

export type SetupOverrides = Partial<Parameters<typeof createGameOcrController>[0]> & {
  /** Targets handed out in order, one per capture. */
  queue?: GameOcrCaptureTarget[]
}

export function setupGameOcr(
  overrides: SetupOverrides = {},
  windowOptions: FakeWindowOptions = {}
) {
  const events: string[] = []
  const windows: FakeWindow[] = []
  const queue: GameOcrCaptureTarget[] = overrides.queue ?? [target(1), target(2), target(3)]
  const usedTargets: GameOcrCaptureTarget[] = []
  let shortcutCallback: (() => void) | undefined
  const shortcut: GameOcrShortcut = {
    register: vi.fn((accelerator, callback) => {
      if (accelerator === 'Control+Shift+G') shortcutCallback = callback
      return true
    }),
    unregister: vi.fn()
  }
  const targets: GameOcrCaptureTargets = {
    resolve: vi.fn(async (resolveOptions) => {
      const head = queue[0]
      events.push(`capture:${head ? captureLabel(head) : 'none'}`)
      // A retry after a failed window capture must not be served a window.
      const index = resolveOptions?.excludeWindow
        ? queue.findIndex((candidate) => candidate.kind === 'display')
        : 0
      const next = index >= 0 ? queue.splice(index, 1)[0] : undefined
      if (!next) throw new Error('no fake capture target')
      usedTargets.push(next)
      return next
    }),
    invalidate: vi.fn(),
    dispose: vi.fn()
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
    targets,
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
    queue,
    usedTargets,
    shortcut,
    get shortcutCallback() {
      return shortcutCallback
    },
    targets,
    createPresentation: base.createPresentation,
    ocr,
    recognitionRequests,
    invalidateResults: base.invalidateResults,
    onResult: base.onResult,
    onError: base.onError
  }
}
