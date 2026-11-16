import { GAME_OCR_CHANNELS } from '../../../shared/ipcChannels'
import type {
  GameOcrCaptureBytes,
  GameOcrFreezeRequest,
  GameOcrFrozenFrame
} from '../../../shared/gameOcr'
import type { OcrDisplayBounds, OcrImageSize, OcrResult } from '../../../shared/ocr'
import { parseWindowSourceHandle } from './windowCapture'
import { sendToWindow, type SendTarget } from '../../windowOptions'

export interface GameOcrNativeWindow extends SendTarget {
  show(): void
  hide(): void
  focus(): void
  /** Raises the window in the z-order without activating it. */
  moveTop?(): void
  /** Re-asserts the always-on-top band; `screen-saver` outranks a game's own. */
  setAlwaysOnTop?(flag: boolean, level?: string): void
  close(): void
  isVisible(): boolean
  isFocused(): boolean
  setBounds(bounds: OcrDisplayBounds): void
  on(event: 'closed' | 'hide', listener: () => void): unknown
  webContents: SendTarget['webContents'] & {
    on(
      event: 'did-finish-load' | 'render-process-gone' | 'did-fail-load',
      listener: (...args: unknown[]) => void
    ): unknown
    send(channel: string, ...args: unknown[]): void
  }
}

export interface GameOcrWindow {
  /** Resolves once drawn; content protection permits recapture over the visible old canvas. */
  freeze(request: GameOcrFreezeRequest): Promise<OcrImageSize>
  /** Encoding completes after the frozen frame is displayed. */
  captureBytes(captureId: number): Promise<Uint8Array>
  reportFrozen(frozen: GameOcrFrozenFrame): void
  reportCaptureBytes(value: GameOcrCaptureBytes): void
  setRecognizing(recognizing: boolean): void
  /** Session/capture identities let the renderer reject regions for an obsolete frame. */
  setRegions(result: OcrResult): void
  rendererReady(): void
  copySelection(): void
  moveTo(displayBounds: OcrDisplayBounds): void
  /** Hides without waiting for the native hide event; retains the renderer for reuse. */
  discard(): Promise<void>
  /** The renderer asked for the live game back: discards, then notifies. */
  dismiss(): Promise<void>
  /** Clears state, closes the native window, and resolves after it is closed. */
  close(): Promise<void>
  isVisible(): boolean
  isFocused(): boolean
  /** Subscribes to renderer-requested dismissals of the current frame. */
  onDismissed(listener: () => void): () => void
  /** Subscribes to native close/crash cleanup notifications. */
  onClosed(listener: () => void): () => void
}

export interface GameOcrWindowControllerOptions {
  window: GameOcrNativeWindow
  loaded?: boolean
  /** Initial logical bounds avoid an unnecessary first-capture move. */
  displayBounds?: OcrDisplayBounds
}

export function createGameOcrWindowController({
  window,
  loaded = false,
  displayBounds
}: GameOcrWindowControllerOptions): GameOcrWindow {
  let rendererLoaded = loaded
  let rendererIsReady = loaded
  let presentationEpoch = 0
  let closed = false
  let readyResolve: (() => void) | undefined
  let readyReject: ((error: Error) => void) | undefined
  let closePromise: Promise<void> | undefined
  let bounds: OcrDisplayBounds | undefined = displayBounds ? { ...displayBounds } : undefined
  const closeListeners = new Set<() => void>()
  const dismissListeners = new Set<() => void>()
  const frozenWaiters = new Map<
    number,
    {
      resolve: (value: GameOcrFrozenFrame) => void
      reject: (e: unknown) => void
    }
  >()
  const bytesWaiters = new Map<
    number,
    {
      promise: Promise<Uint8Array>
      resolve: (value: Uint8Array) => void
      reject: (e: unknown) => void
    }
  >()

  const abandonWaiters = (reason: string): void => {
    const frozen = [...frozenWaiters.values()]
    frozenWaiters.clear()
    for (const waiter of frozen) waiter.reject(new Error(reason))
    const waiters = [...bytesWaiters.values()]
    bytesWaiters.clear()
    for (const waiter of waiters) waiter.reject(new Error(reason))
  }

  // Load failure can reject while no freeze is waiting; mark the rejection handled.
  const createReadyPromise = (): Promise<void> => {
    const promise = new Promise<void>((resolve, reject) => {
      readyResolve = resolve
      readyReject = reject
    })
    void promise.catch(() => undefined)
    return promise
  }

  let ready = rendererLoaded ? Promise.resolve() : createReadyPromise()

  const resetReadyPromise = (): void => {
    rendererIsReady = false
    ready = createReadyPromise()
  }

  const notifyClosed = (): void => {
    if (closed) return
    closed = true
    rendererLoaded = false
    rendererIsReady = false
    presentationEpoch++
    readyReject?.(new Error('Game OCR window closed before its renderer loaded.'))
    readyReject = undefined
    readyResolve = undefined
    abandonWaiters('The Game OCR window closed before its frame was captured.')
    for (const listener of closeListeners) listener()
  }

  const sendDiscard = (): void => {
    if (closed || window.isDestroyed() || window.webContents.isDestroyed()) return
    sendToWindow(window, GAME_OCR_CHANNELS.discard)
  }

  const sendFreeze = (request: GameOcrFreezeRequest): void => {
    if (closed || !rendererLoaded) return
    sendToWindow(window, GAME_OCR_CHANNELS.freeze, request)
  }

  const showFrozen = (): void => {
    if (closed) return
    if (!window.isVisible()) window.show()
    window.setAlwaysOnTop?.(true, 'screen-saver')
    window.moveTop?.()
    window.focus()
  }

  const requestHide = (): void => {
    if (closed || window.isDestroyed()) return
    // Windows can delay the hide event by seconds even though hide() issues the command immediately.
    window.hide()
  }

  // Reuse the pending close so concurrent requests do not accumulate native listeners.
  const waitUntilClosed = (): Promise<void> => {
    if (closed || window.isDestroyed()) return Promise.resolve()
    if (closePromise) return closePromise
    closePromise = new Promise<void>((resolve) => {
      let settled = false
      const finish = (): void => {
        if (settled) return
        settled = true
        resolve()
      }
      window.on('closed', finish)
      window.close()
      if (window.isDestroyed()) finish()
    })
    return closePromise
  }

  window.on('closed', notifyClosed)
  window.webContents.on('did-finish-load', () => {
    rendererLoaded = true
  })
  // Rebuild an unusable renderer rather than retaining a window that cannot complete readiness.
  window.webContents.on('did-fail-load', (...args) => {
    const reason = typeof args[1] === 'string' ? args[1] : 'renderer load failed'
    readyReject?.(new Error(`Game OCR renderer failed to load: ${reason}`))
    readyReject = undefined
    readyResolve = undefined
    void waitUntilClosed()
  })
  window.webContents.on('render-process-gone', () => {
    rendererLoaded = false
    rendererIsReady = false
    presentationEpoch++
    abandonWaiters('The Game OCR renderer stopped before its frame was captured.')
    resetReadyPromise()
    void waitUntilClosed()
  })

  return {
    async freeze(request): Promise<OcrImageSize> {
      if (closed) throw new Error('The Game OCR frame is gone.')
      validateFreezeRequest(request)
      const epoch = presentationEpoch
      if (!rendererIsReady) await ready
      if (closed || epoch !== presentationEpoch) {
        throw new Error('The Game OCR frame was discarded before it was captured.')
      }
      const settled = new Promise<GameOcrFrozenFrame>((resolve, reject) => {
        frozenWaiters.set(request.captureId, { resolve, reject })
      })
      sendFreeze(request)
      const frozen = await settled
      if (frozen.error) throw new Error(frozen.error)
      showFrozen()
      return frozen.imageSize
    },

    captureBytes(captureId): Promise<Uint8Array> {
      if (closed) return Promise.reject(new Error('The Game OCR frame is gone.'))
      const existing = bytesWaiters.get(captureId)
      if (existing) return existing.promise
      let resolve!: (value: Uint8Array) => void
      let reject!: (error: unknown) => void
      const promise = new Promise<Uint8Array>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise
        reject = rejectPromise
      })
      // An abandoned capture may have no reader left to handle rejection.
      void promise.catch(() => undefined)
      bytesWaiters.set(captureId, { promise, resolve, reject })
      return promise
    },

    reportFrozen(frozen): void {
      const waiter = frozenWaiters.get(frozen.captureId)
      if (!waiter) return
      frozenWaiters.delete(frozen.captureId)
      waiter.resolve(frozen)
    },

    reportCaptureBytes(value): void {
      const waiter = bytesWaiters.get(value.captureId)
      if (!waiter) return
      bytesWaiters.delete(value.captureId)
      if (value.error) waiter.reject(new Error(value.error))
      else waiter.resolve(value.imageBytes)
    },

    setRecognizing(recognizing): void {
      if (closed || !rendererLoaded) return
      sendToWindow(window, GAME_OCR_CHANNELS.recognitionState, recognizing)
    },

    setRegions(result): void {
      // Drop results during renderer crash/reload, before it can display a screenshot.
      if (closed || !rendererLoaded || !rendererIsReady) return
      sendToWindow(window, GAME_OCR_CHANNELS.regions, result)
    },

    rendererReady(): void {
      if (closed || !rendererLoaded || rendererIsReady) return
      rendererIsReady = true
      readyResolve?.()
      readyResolve = undefined
      readyReject = undefined
    },

    copySelection(): void {
      if (closed || !rendererLoaded) return
      sendToWindow(window, GAME_OCR_CHANNELS.copySelection)
    },

    moveTo(displayBounds): void {
      if (closed || window.isDestroyed()) return
      if (bounds && sameBounds(bounds, displayBounds)) return
      bounds = { ...displayBounds }
      window.setBounds(bounds)
    },

    async discard(): Promise<void> {
      presentationEpoch++
      abandonWaiters('The Game OCR frame was discarded before it was captured.')
      // Hide is the user-visible operation. Issue it before renderer cleanup.
      requestHide()
      sendDiscard()
    },

    async dismiss(): Promise<void> {
      presentationEpoch++
      abandonWaiters('The Game OCR frame was dismissed before it was captured.')
      // Return to the live game before potentially delayed renderer cleanup.
      requestHide()
      sendDiscard()
      // Invalidate results immediately, without waiting for the delayed native hide event.
      for (const listener of [...dismissListeners]) listener()
    },

    async close(): Promise<void> {
      presentationEpoch++
      abandonWaiters('The Game OCR frame closed before it was captured.')
      sendDiscard()
      await waitUntilClosed()
    },

    isVisible(): boolean {
      return !closed && !window.isDestroyed() && window.isVisible()
    },

    isFocused(): boolean {
      return !closed && !window.isDestroyed() && window.isVisible() && window.isFocused()
    },

    onDismissed(listener): () => void {
      dismissListeners.add(listener)
      return () => dismissListeners.delete(listener)
    },

    onClosed(listener): () => void {
      closeListeners.add(listener)
      return () => closeListeners.delete(listener)
    }
  }
}

type GameOcrIpcListener = (event: { sender: unknown }, value: unknown) => void

export interface GameOcrIpcMain {
  on(channel: string, listener: GameOcrIpcListener): unknown
  removeListener(channel: string, listener: GameOcrIpcListener): unknown
}

export function registerGameOcrIpc(
  ipc: GameOcrIpcMain,
  window: GameOcrNativeWindow,
  controller: Pick<
    GameOcrWindow,
    'rendererReady' | 'dismiss' | 'reportFrozen' | 'reportCaptureBytes'
  >
): () => void {
  const handlers: [string, (value: unknown) => void][] = [
    [GAME_OCR_CHANNELS.rendererReady, () => controller.rendererReady()],
    // Dismissal retains the renderer; stopping Game OCR destroys it.
    [GAME_OCR_CHANNELS.close, () => void controller.dismiss()],
    [GAME_OCR_CHANNELS.frozen, (value) => controller.reportFrozen(value as GameOcrFrozenFrame)],
    [
      GAME_OCR_CHANNELS.captureBytes,
      (value) => controller.reportCaptureBytes(value as GameOcrCaptureBytes)
    ]
  ]
  const listeners = handlers.map(([channel, handle]) => {
    const listener: GameOcrIpcListener = (event, value) => {
      if (event.sender === window.webContents) handle(value)
    }
    ipc.on(channel, listener)
    return [channel, listener] as const
  })
  return () => {
    for (const [channel, listener] of listeners) ipc.removeListener(channel, listener)
  }
}

function sameBounds(left: OcrDisplayBounds, right: OcrDisplayBounds): boolean {
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  )
}

function validateFreezeRequest(request: GameOcrFreezeRequest): void {
  if (
    !request ||
    typeof request.sourceId !== 'string' ||
    request.sourceId.length === 0 ||
    (request.targetKind !== 'window' && request.targetKind !== 'display') ||
    !isPositiveInteger(request.imageSize?.width) ||
    !isPositiveInteger(request.imageSize?.height)
  ) {
    throw new Error('Game OCR freeze request is invalid.')
  }
  // Validate in main so invalid window ids take the display-fallback path.
  if (request.targetKind === 'window' && parseWindowSourceHandle(request.sourceId) === undefined) {
    throw new Error(`Game OCR freeze request names no window handle: ${request.sourceId}`)
  }
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}
