import { GAME_OCR_CHANNELS } from '../../../shared/ipcChannels'
import type {
  GameOcrCaptureBytes,
  GameOcrFreezeRequest,
  GameOcrFrozenFrame,
  GameOcrRegionsRendered
} from '../../../shared/gameOcr'
import type { OcrDisplayBounds, OcrImageSize, OcrResult } from '../../../shared/ocr'
import { parseWindowSourceHandle } from './windowCapture'
import { sendToWindow, type SendTarget } from '../../windowOptions'

/** Minimal BrowserWindow surface used by the controller and its tests. */
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
  /**
   * Asks the frame to freeze the display it is streaming, shows it once the
   * renderer reports the frame drawn, and resolves with what was actually
   * captured. On recapture the old canvas may remain visible; native content
   * protection keeps this window out of the desktop stream.
   */
  freeze(request: GameOcrFreezeRequest): Promise<OcrImageSize>
  /**
   * The encoded screenshot for that capture, which the renderer produces after
   * the frame is already on screen. Resolves whenever the encode lands.
   */
  captureBytes(captureId: number): Promise<Uint8Array>
  /** Renderer→main report that the frame is drawn. Bound by the IPC glue. */
  reportFrozen(frozen: GameOcrFrozenFrame): void
  /** Renderer→main report carrying the encoded screenshot. */
  reportCaptureBytes(value: GameOcrCaptureBytes): void
  /** Renderer→main report that the accepted word boxes reached a paint. */
  reportRegionsRendered(value: GameOcrRegionsRendered): void
  /** Updates the small renderer-owned recognition indicator. */
  setRecognizing(recognizing: boolean): void
  /**
   * Publishes the accepted OCR regions for the presented screenshot. The
   * result carries its own session/capture identity, so a renderer that has
   * already been discarded can drop a late push instead of drawing boxes over
   * a newer frame.
   */
  setRegions(result: OcrResult): void
  /** Marks the dedicated renderer ready to receive presentation pushes. */
  rendererReady(): void
  /**
   * Asks the frame to put its current text selection on the clipboard. The
   * window is never focused, so the copy arrives from a global shortcut.
   */
  copySelection(): void
  /** Places the retained window on the display being captured. */
  moveTo(displayBounds: OcrDisplayBounds): void
  /**
   * Issues one native hide, drops the screenshot and boxes, and resolves
   * without waiting for Electron's lagging native `hide` event. The renderer
   * survives, so the next frame skips the load-and-handshake cost.
   */
  discard(): Promise<void>
  /** The renderer asked for the live game back: discards, then notifies. */
  dismiss(): Promise<void>
  /** Clears state, closes the native window, and resolves after it is closed. */
  close(): Promise<void>
  isVisible(): boolean
  /** Subscribes to renderer-requested dismissals of the current frame. */
  onDismissed(listener: () => void): () => void
  /** Subscribes to native close/crash cleanup notifications. */
  onClosed(listener: () => void): () => void
  /** Subscribes to the renderer's final word-box paint acknowledgement. */
  onRegionsRendered(listener: (value: GameOcrRegionsRendered) => void): () => void
}

export interface GameOcrWindowControllerOptions {
  window: GameOcrNativeWindow
  loaded?: boolean
  /** The bounds the native window was constructed with, so the first capture
   * on that same display does not move a window that is already there. */
  displayBounds?: OcrDisplayBounds
}

/**
 * Creates the lifecycle around an already-created native window. Keeping this
 * separate from Electron construction keeps native lifecycle testable.
 */
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
  const regionsRenderedListeners = new Set<(value: GameOcrRegionsRendered) => void>()
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

  /** Fails everything still waiting on a renderer that can no longer answer. */
  const abandonWaiters = (reason: string): void => {
    const frozen = [...frozenWaiters.values()]
    frozenWaiters.clear()
    for (const waiter of frozen) waiter.reject(new Error(reason))
    const waiters = [...bytesWaiters.values()]
    bytesWaiters.clear()
    for (const waiter of waiters) waiter.reject(new Error(reason))
  }

  /**
   * Only `present` awaits readiness. A load that fails while no presentation is
   * queued — a crashed renderer whose reload also fails, for instance — would
   * otherwise reject a promise nobody holds, which Node reports as an
   * unhandled rejection, so the rejection is marked handled here.
   */
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
    // Only the request goes out here. Content protection excludes this window
    // from the desktop stream, so a retained visible canvas is safe to replace.
    sendToWindow(window, GAME_OCR_CHANNELS.freeze, request)
  }

  const showFrozen = (): void => {
    if (closed) return
    // Shown, never focused. `focus()` on a non-focusable window is at best a
    // no-op and at worst an attempt to take a foreground Windows will refuse,
    // and taking it is precisely what stalls the game behind the frame.
    if (!window.isVisible()) window.show()
    // Raised without being activated. Always-on-top is a band, not a position:
    // inside it Windows orders by which window was most recently activated, and
    // a window that never activates therefore loses to a game that is itself
    // topmost — the frame is shown, behind the game, and nothing appears to
    // happen. `screen-saver` puts it in a higher band than an ordinary topmost
    // window, and `moveTop` raises it there without asking for focus.
    window.setAlwaysOnTop?.(true, 'screen-saver')
    window.moveTop?.()
  }

  const requestHide = (): void => {
    if (closed || window.isDestroyed()) return
    // BrowserWindow.hide() issues the native command synchronously, but its
    // `hide` event can lag by seconds on Windows. Capture safety is provided by
    // the compositor yield plus desktop-stream frame acknowledgement, so the
    // shortcut path must not wait on that unrelated event.
    window.hide()
  }

  // Both the renderer's close request and a display change can ask for the
  // same close. The in-flight promise is reused so one native window never
  // accumulates a `closed` listener per request.
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
  // A window whose renderer is unusable cannot serve the next frame either.
  // Tearing it down hands the coordinator a clean rebuild instead of a
  // retained window whose readiness handshake would never complete again.
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
      // Marked handled: a capture abandoned before its bytes arrive leaves this
      // rejection with no reader, which Node would report as unhandled.
      void promise.catch(() => undefined)
      bytesWaiters.set(captureId, { promise, resolve, reject })
      return promise
    },

    /** Called by the IPC binding when the renderer reports a drawn frame. */
    reportFrozen(frozen): void {
      const waiter = frozenWaiters.get(frozen.captureId)
      if (!waiter) return
      frozenWaiters.delete(frozen.captureId)
      waiter.resolve(frozen)
    },

    /** Called by the IPC binding when the renderer finishes encoding. */
    reportCaptureBytes(value): void {
      const waiter = bytesWaiters.get(value.captureId)
      if (!waiter) return
      bytesWaiters.delete(value.captureId)
      if (value.error) waiter.reject(new Error(value.error))
      else waiter.resolve(value.imageBytes)
    },

    reportRegionsRendered(value): void {
      if (closed || !rendererIsReady) return
      for (const listener of regionsRenderedListeners) listener(value)
    },

    setRecognizing(recognizing): void {
      if (closed || !rendererLoaded) return
      sendToWindow(window, GAME_OCR_CHANNELS.recognitionState, recognizing)
    },

    setRegions(result): void {
      // A result that arrives before the renderer has taken its screenshot
      // would paint boxes over nothing; the coordinator only recognizes after
      // `present` resolved, so dropping it here is the crash/reload case.
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
      // The native window goes first so one background press returns to the
      // game even if renderer cleanup is delayed.
      requestHide()
      sendDiscard()
      // Listeners learn the frame is gone before the hide settles: the
      // coordinator has to invalidate the session's results either way, and
      // the user already sees the live game.
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

    onDismissed(listener): () => void {
      dismissListeners.add(listener)
      return () => dismissListeners.delete(listener)
    },

    onClosed(listener): () => void {
      closeListeners.add(listener)
      return () => closeListeners.delete(listener)
    },

    onRegionsRendered(listener): () => void {
      regionsRenderedListeners.add(listener)
      return () => regionsRenderedListeners.delete(listener)
    }
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
  // A window request's source id *is* its window handle. Checking the shape
  // here fails the capture in main, where it falls back to display capture,
  // rather than in the renderer as an opaque `getUserMedia` rejection.
  if (request.targetKind === 'window' && parseWindowSourceHandle(request.sourceId) === undefined) {
    throw new Error(`Game OCR freeze request names no window handle: ${request.sourceId}`)
  }
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}
