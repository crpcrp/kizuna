import { createRequire } from 'node:module'
import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron'
import { GAME_OCR_CHANNELS } from '../../../shared/ipcChannels'
import type { GameOcrPresentation } from '../../../shared/gameOcr'
import type { OcrDisplayBounds, OcrResult } from '../../../shared/ocr'
import {
  applyNavigationGuards,
  applyReloadGuard,
  sendToWindow,
  type NavigationGuardTarget,
  type InputGuardTarget,
  type SendTarget
} from '../../windowOptions'

/** Options needed to construct the Windows-only frozen-frame window. */
export interface GameOcrWindowConstructionOptions {
  preloadPath: string
  displayBounds: OcrDisplayBounds
}

/**
 * The dedicated window is opaque and deliberately sits above the game. Its
 * bounds are logical desktop coordinates, so negative secondary-monitor
 * origins are preserved exactly.
 */
export function getGameOcrWindowOptions(
  preloadPath: string,
  displayBounds: OcrDisplayBounds
): BrowserWindowConstructorOptions {
  return {
    x: displayBounds.x,
    y: displayBounds.y,
    width: displayBounds.width,
    height: displayBounds.height,
    title: 'Game OCR',
    frame: false,
    transparent: false,
    backgroundColor: '#000000',
    show: false,
    skipTaskbar: true,
    focusable: true,
    alwaysOnTop: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    hasShadow: false,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  }
}

/** Minimal BrowserWindow surface used by the controller and its tests. */
export interface GameOcrNativeWindow extends SendTarget {
  show(): void
  hide(): void
  focus(): void
  close(): void
  isVisible(): boolean
  setBounds(bounds: OcrDisplayBounds): void
  loadURL(url: string): Promise<unknown> | unknown
  loadFile(path: string, options?: { query?: Record<string, string> }): Promise<unknown> | unknown
  on(event: 'closed' | 'hide', listener: () => void): unknown
  webContents: SendTarget['webContents'] &
    NavigationGuardTarget &
    InputGuardTarget & {
      on(
        event: 'did-finish-load' | 'render-process-gone' | 'did-fail-load',
        listener: (...args: unknown[]) => void
      ): unknown
      send(channel: string, ...args: unknown[]): void
      openDevTools?(options?: { mode?: string }): void
    }
}

export interface GameOcrWindow {
  /** Queues and presents a new screenshot, with recognition initially active. */
  present(presentation: GameOcrPresentation): Promise<void>
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
   * Places the retained window on the display the next frame was captured
   * from. Only meaningful while hidden; the coordinator calls it between a
   * discard and the following present.
   */
  moveTo(displayBounds: OcrDisplayBounds): void
  /**
   * Drops the screenshot and boxes, hides the window, and resolves once it is
   * no longer visible. The renderer survives, so the next frame skips the
   * whole load-and-handshake cost.
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
}

/** Minimal ipcMain surface used to bind this renderer to its native window. */
export interface GameOcrIpcMain {
  on(channel: string, listener: (event: { sender: unknown }) => void): unknown
  removeListener(channel: string, listener: (event: { sender: unknown }) => void): unknown
}

/** Display events that invalidate an active frozen frame's placement. */
export interface GameOcrDisplayEvents {
  on(event: 'display-metrics-changed' | 'display-removed', listener: () => void): unknown
  removeListener(
    event: 'display-metrics-changed' | 'display-removed',
    listener: () => void
  ): unknown
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
 * separate from Electron construction lets the recapture coordinator inject
 * the same awaitable discard boundary in tests and in production.
 */
export function createGameOcrWindowController({
  window,
  loaded = false,
  displayBounds
}: GameOcrWindowControllerOptions): GameOcrWindow {
  let rendererLoaded = loaded
  let rendererIsReady = loaded
  let pending: GameOcrPresentation | undefined
  let closed = false
  let readyResolve: (() => void) | undefined
  let readyReject: ((error: Error) => void) | undefined
  let closePromise: Promise<void> | undefined
  let bounds: OcrDisplayBounds | undefined = displayBounds ? { ...displayBounds } : undefined
  const closeListeners = new Set<() => void>()
  const dismissListeners = new Set<() => void>()
  const hideWaiters = new Set<() => void>()

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

  const releaseHideWaiters = (): void => {
    const waiters = [...hideWaiters]
    hideWaiters.clear()
    for (const waiter of waiters) waiter()
  }

  const notifyClosed = (): void => {
    if (closed) return
    closed = true
    rendererLoaded = false
    rendererIsReady = false
    const hadPendingPresentation = pending !== undefined
    pending = undefined
    if (hadPendingPresentation) {
      readyReject?.(new Error('Game OCR window closed before its renderer loaded.'))
    }
    readyReject = undefined
    readyResolve = undefined
    // A destroyed window never emits `hide`, so anything waiting on one must
    // be released here or a pending discard would hang the capture queue.
    releaseHideWaiters()
    for (const listener of closeListeners) listener()
  }

  const sendDiscard = (): void => {
    if (closed || window.isDestroyed() || window.webContents.isDestroyed()) return
    sendToWindow(window, GAME_OCR_CHANNELS.discard)
  }

  const showPending = (): void => {
    const next = pending
    if (!next || closed || !rendererLoaded) return
    pending = undefined
    sendToWindow(window, GAME_OCR_CHANNELS.present, next)
    if (!window.isVisible()) window.show()
    window.focus()
  }

  // One `hide` listener for the window's whole life, however many discards it
  // serves. The window is reused across frames, so registering per call would
  // grow a listener list for as long as Game OCR stays armed.
  //
  // `hide` is issued whenever the window still exists, without first asking
  // whether it is visible: a frozen frame left on screen because `isVisible()`
  // disagreed with what the user can see is the one failure this path must not
  // have, and hiding an already-hidden window is free.
  const waitUntilHidden = (): Promise<void> => {
    if (closed || window.isDestroyed()) return Promise.resolve()
    return new Promise<void>((resolve) => {
      hideWaiters.add(resolve)
      window.hide()
      if (!window.isVisible() && hideWaiters.delete(resolve)) resolve()
    })
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
  window.on('hide', releaseHideWaiters)
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
    pending = undefined
    resetReadyPromise()
    void waitUntilClosed()
  })

  return {
    async present(presentation): Promise<void> {
      if (closed) return
      validatePresentation(presentation)
      pending = { ...presentation }
      if (!rendererIsReady) await ready
      showPending()
    },

    setRecognizing(recognizing): void {
      if (pending) pending = { ...pending, recognizing }
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
      showPending()
    },

    moveTo(displayBounds): void {
      if (closed || window.isDestroyed()) return
      if (bounds && sameBounds(bounds, displayBounds)) return
      bounds = { ...displayBounds }
      window.setBounds(bounds)
    },

    async discard(): Promise<void> {
      pending = undefined
      sendDiscard()
      await waitUntilHidden()
    },

    async dismiss(): Promise<void> {
      pending = undefined
      sendDiscard()
      // Listeners learn the frame is gone before the hide settles: the
      // coordinator has to invalidate the session's results either way, and
      // the user already sees the live game.
      for (const listener of [...dismissListeners]) listener()
      await waitUntilHidden()
    },

    async close(): Promise<void> {
      pending = undefined
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

export interface CreateGameOcrWindowOptions extends GameOcrWindowConstructionOptions {
  platform?: NodeJS.Platform
  devUrl?: string
  packagedHtmlPath: string
  createWindow?: (options: BrowserWindowConstructorOptions) => BrowserWindow
  ipcMain?: GameOcrIpcMain
  displayEvents?: GameOcrDisplayEvents
  /**
   * Asks the frozen-frame renderer to narrate the input it receives, and opens
   * its devtools detached so the log is readable while a frame covers the
   * display. Whether a press reaches the page at all is the one question about
   * this window that cannot be answered from inside the application.
   */
  traceInput?: boolean
}

/**
 * Production factory. The service is intentionally unavailable on Linux and
 * other platforms; the later Game OCR coordinator can keep that branch out of
 * the normal window-pair abstraction.
 */
export function createGameOcrWindow(options: CreateGameOcrWindowOptions): GameOcrWindow {
  if ((options.platform ?? process.platform) !== 'win32') return unsupportedWindow()

  let electron:
    | {
        BrowserWindow: typeof BrowserWindow
        ipcMain?: GameOcrIpcMain
        screen?: GameOcrDisplayEvents
      }
    | undefined
  const createWindow =
    options.createWindow ??
    ((windowOptions) => {
      const loadedElectron = createRequire(import.meta.url)('electron') as {
        BrowserWindow: typeof BrowserWindow
        ipcMain?: GameOcrIpcMain
        screen?: GameOcrDisplayEvents
      }
      electron = loadedElectron
      return new loadedElectron.BrowserWindow(windowOptions)
    })
  const window = createWindow(
    getGameOcrWindowOptions(options.preloadPath, options.displayBounds)
  ) as unknown as GameOcrNativeWindow
  // Windows clamps a window's *initial* size to the display's work area, so a
  // window constructed at the full display bounds comes up short by the
  // taskbar and leaves a live strip of the game uncovered below the frozen
  // frame. Re-asserting the same rectangle is not clamped, and applying it
  // while the window is still hidden means the first frame is already exact.
  window.setBounds({ ...options.displayBounds })
  applyNavigationGuards(window.webContents)
  applyReloadGuard(window.webContents)

  const query = options.traceInput ? '?trace=input' : ''
  if (options.devUrl) {
    void window.loadURL(`${options.devUrl.replace(/\/$/, '')}/gameOcr.html${query}`)
  } else {
    // loadFile keeps the query out of the path, which a file:// URL would not.
    void window.loadFile(
      options.packagedHtmlPath,
      options.traceInput ? { query: { trace: 'input' } } : {}
    )
  }
  if (options.traceInput) {
    window.webContents.openDevTools?.({ mode: 'detach' })
  }

  const controller = createGameOcrWindowController({
    window,
    displayBounds: options.displayBounds
  })
  const ipc = options.ipcMain ?? electron?.ipcMain
  if (ipc) {
    const removeIpcHandlers = registerGameOcrIpc(ipc, window, controller)
    controller.onClosed(removeIpcHandlers)
  }
  const displayEvents = options.displayEvents ?? electron?.screen
  if (displayEvents) {
    const closeForDisplayChange = (): void => {
      void controller.close()
    }
    displayEvents.on('display-metrics-changed', closeForDisplayChange)
    displayEvents.on('display-removed', closeForDisplayChange)
    controller.onClosed(() => {
      displayEvents.removeListener('display-metrics-changed', closeForDisplayChange)
      displayEvents.removeListener('display-removed', closeForDisplayChange)
    })
  }
  return controller
}

/** Binds renderer-ready and close requests only to this window's webContents. */
export function registerGameOcrIpc(
  ipc: GameOcrIpcMain,
  window: GameOcrNativeWindow,
  controller: Pick<GameOcrWindow, 'rendererReady' | 'dismiss'>
): () => void {
  const onRendererReady = (event: { sender: unknown }): void => {
    if (event.sender === window.webContents) controller.rendererReady()
  }
  const onClose = (event: { sender: unknown }): void => {
    // The renderer returns the user to the live game; it does not tear the
    // retained window down. Stopping Game OCR is what closes it for good.
    if (event.sender !== window.webContents) return
    if (process.env['KIZUNA_GAME_OCR_TIMING']) {
      console.log('[game-ocr] close request received from the frozen frame; hiding')
    }
    void controller.dismiss()
  }
  ipc.on(GAME_OCR_CHANNELS.rendererReady, onRendererReady)
  ipc.on(GAME_OCR_CHANNELS.close, onClose)
  return () => {
    ipc.removeListener(GAME_OCR_CHANNELS.rendererReady, onRendererReady)
    ipc.removeListener(GAME_OCR_CHANNELS.close, onClose)
  }
}

function unsupportedWindow(): GameOcrWindow {
  return {
    present: async () => {
      throw new Error('Game OCR frozen-frame presentation is only supported on Windows.')
    },
    setRecognizing: () => {},
    setRegions: () => {},
    rendererReady: () => {},
    moveTo: () => {},
    discard: async () => {},
    dismiss: async () => {},
    close: async () => {},
    isVisible: () => false,
    onDismissed: () => () => {},
    onClosed: () => () => {}
  }
}

function validatePresentation(presentation: GameOcrPresentation): void {
  if (
    !presentation ||
    typeof presentation.imageBase64 !== 'string' ||
    presentation.imageBase64.length === 0 ||
    typeof presentation.imageMediaType !== 'string' ||
    presentation.imageMediaType.length === 0 ||
    !isPositiveInteger(presentation.imageSize?.width) ||
    !isPositiveInteger(presentation.imageSize?.height) ||
    typeof presentation.recognizing !== 'boolean'
  ) {
    throw new Error('Game OCR presentation is invalid.')
  }
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}
