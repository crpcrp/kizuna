import { BrowserWindow, type BrowserWindowConstructorOptions } from 'electron'
import { join } from 'node:path'
import {
  getLinuxUiOverlayOptions,
  getLinuxVideoHostOptions,
  getMainWindowOptions,
  type WindowBounds,
  type WindowControlTarget
} from './windowOptions'

/** Events used by the coordinator; the callbacks intentionally ignore Electron's event object. */
type WindowPairEvent =
  'close' | 'closed' | 'move' | 'resize' | 'enter-full-screen' | 'leave-full-screen'

interface ManagedWindow extends WindowControlTarget {
  isDestroyed(): boolean
  isMinimized(): boolean
  restore(): void
  on(event: WindowPairEvent, listener: () => void): unknown
}

export interface AppWindowSet {
  /** Window whose native handle is passed to mpv as `--wid`. */
  readonly videoHost: BrowserWindow
  /** Window containing the preload and React renderer. */
  readonly uiOverlay: BrowserWindow
  /** True only when Linux has two distinct BrowserWindows. */
  readonly paired: boolean
  /** The sole owner of logical window operations for this app window set. */
  readonly coordinator: AppWindowCoordinator
  /** Resolves a renderer/native window to the maintained logical pair. */
  readonly controlsFor: (window: BrowserWindow | null) => WindowControlTarget | null
  /** Subscribes to deduplicated native fullscreen transitions. */
  readonly onFullscreenChanged: (listener: (fullscreen: boolean) => void) => () => void
  /** Restores and focuses the logical app window after a second launch. */
  readonly activate: () => void
  /** Closes both Linux windows with recursion protection; closes the one Windows window otherwise. */
  readonly close: () => void
}

export type BrowserWindowFactory = (options: BrowserWindowConstructorOptions) => BrowserWindow

export interface CreateAppWindowSetOptions {
  preloadPath: string
  platform?: NodeJS.Platform
  createWindow?: BrowserWindowFactory
  setTimeoutFn?: WindowPairSetTimeout
  clearTimeoutFn?: WindowPairClearTimeout
}

export type WindowPairSetTimeout = (callback: () => void, delayMs: number) => unknown
export type WindowPairClearTimeout = (handle: unknown) => void

interface AppWindowCoordinatorOptions {
  paired?: boolean
  setTimeoutFn?: WindowPairSetTimeout
  clearTimeoutFn?: WindowPairClearTimeout
}

/** A rectangle comparison that avoids native writes which would create events. */
function sameBounds(left: WindowBounds, right: WindowBounds): boolean {
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  )
}

/**
 * Owns every logical window mutation. Linux uses `videoHost` as the canonical
 * bounds/fullscreen/taskbar owner and mirrors its rectangle to `uiOverlay`.
 * Windows still uses one BrowserWindow, so every operation reaches that native
 * window once.
 */
export class AppWindowCoordinator implements WindowControlTarget {
  private readonly videoHost: ManagedWindow
  private readonly uiOverlay: ManagedWindow
  private readonly paired: boolean
  private readonly setTimeoutFn: WindowPairSetTimeout
  private readonly clearTimeoutFn: WindowPairClearTimeout
  private readonly fullscreenListeners = new Set<(fullscreen: boolean) => void>()
  private readonly closePair: () => void
  private syncScheduled = false
  private syncTimer: unknown
  private syncing = false
  private preFullscreenBounds: WindowBounds | undefined
  private fullscreenExitRequested = false
  private reenterAfterFullscreenLeave = false
  private lastFullscreenNotification: boolean | undefined

  constructor(
    videoHost: ManagedWindow,
    uiOverlay: ManagedWindow,
    {
      paired = videoHost !== uiOverlay,
      setTimeoutFn,
      clearTimeoutFn
    }: AppWindowCoordinatorOptions = {}
  ) {
    this.videoHost = videoHost
    this.uiOverlay = uiOverlay
    this.paired = paired
    this.setTimeoutFn = setTimeoutFn ?? ((callback, delayMs) => setTimeout(callback, delayMs))
    this.clearTimeoutFn =
      clearTimeoutFn ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>))
    this.closePair = attachPairCloseHandlers(videoHost, uiOverlay)

    if (paired) {
      videoHost.on('move', this.queueBoundsSync)
      videoHost.on('resize', this.queueBoundsSync)
      // A child move/resize should not become a second source of truth. Queue a
      // correction from the host instead, which also handles a compositor
      // update that reaches the child before the parent's event.
      uiOverlay.on('move', this.queueBoundsSync)
      uiOverlay.on('resize', this.queueBoundsSync)
    }

    // Only the canonical host participates in native fullscreen. Listening to
    // both sides would produce duplicate renderer transitions and could make a
    // child fullscreen independently of its video parent.
    videoHost.on('enter-full-screen', () => this.handleFullscreenChanged(true))
    videoHost.on('leave-full-screen', () => this.handleFullscreenChanged(false))
  }

  /** Returns the bounds of the canonical host, falling back during teardown. */
  getBounds(): WindowBounds {
    return this.readBounds(this.videoHost) ?? this.readBounds(this.uiOverlay) ?? emptyBounds()
  }

  /** Applies one logical rectangle to the host and overlay, if both are live. */
  setBounds(bounds: WindowBounds): void {
    this.synchronizePair(bounds)
    this.queueBoundsSync()
  }

  /** Minimizes the logical pair, without calling the same BrowserWindow twice. */
  minimize(): void {
    this.forEachDistinctLive((window) => this.callSafely(window, () => window.minimize()))
  }

  /** Restores every minimized side of the logical pair. */
  restore(): void {
    this.forEachDistinctLive((window) => {
      this.callSafely(window, () => {
        if (window.isMinimized()) window.restore()
      })
    })
  }

  /** Focuses the host first, then leaves keyboard focus on the interactive overlay. */
  focus(): void {
    if (this.isLive(this.videoHost)) this.callSafely(this.videoHost, () => this.videoHost.focus())
    if (this.uiOverlay !== this.videoHost && this.isLive(this.uiOverlay)) {
      this.callSafely(this.uiOverlay, () => this.uiOverlay.focus())
    }
  }

  /** Second-instance activation treats the pair as one foreground application. */
  activate(): void {
    this.restore()
    this.focus()
  }

  isFullScreen(): boolean {
    const window = this.isLive(this.videoHost) ? this.videoHost : this.uiOverlay
    if (!this.isLive(window)) return false
    try {
      return window.isFullScreen()
    } catch {
      return false
    }
  }

  /** The host initiates native fullscreen; its child remains a child overlay. */
  setFullScreen(flag: boolean): void {
    if (!this.isLive(this.videoHost)) return
    if (flag) {
      // A new enter request during an in-flight exit must not replace the
      // original windowed rectangle or restore it between the two transitions.
      if (this.fullscreenExitRequested && this.preFullscreenBounds) {
        this.reenterAfterFullscreenLeave = true
      }
      this.fullscreenExitRequested = false
      this.capturePreFullscreenBounds()
    } else {
      this.fullscreenExitRequested = this.preFullscreenBounds !== undefined
    }
    this.callSafely(this.videoHost, () => this.videoHost.setFullScreen(flag))
  }

  /** Mini-player always-on-top applies to both native sides on Linux. */
  setAlwaysOnTop(flag: boolean): void {
    this.forEachDistinctLive((window) => this.callSafely(window, () => window.setAlwaysOnTop(flag)))
  }

  /** Closes the pair once and cancels any pending geometry callback. */
  close(): void {
    this.cancelScheduledSync()
    this.closePair()
  }

  isCompletelyDestroyed(): boolean {
    return !this.isLive(this.videoHost) && !this.isLive(this.uiOverlay)
  }

  /** Captures the canonical windowed rectangle once per fullscreen cycle. */
  capturePreFullscreenBounds(): void {
    if (this.isFullScreen() || this.preFullscreenBounds) return
    const bounds = this.readBounds(this.videoHost)
    if (bounds) this.preFullscreenBounds = bounds
  }

  hasPreFullscreenBounds(): boolean {
    return this.preFullscreenBounds !== undefined
  }

  /** Restores both sides once, after the native host has left fullscreen. */
  restorePreFullscreenBounds(): void {
    const bounds = this.preFullscreenBounds
    if (!bounds) return
    this.preFullscreenBounds = undefined
    this.synchronizePair(bounds, false)
  }

  /** Registers a renderer-facing listener for one logical fullscreen change. */
  onFullscreenChanged(listener: (fullscreen: boolean) => void): () => void {
    this.fullscreenListeners.add(listener)
    return () => this.fullscreenListeners.delete(listener)
  }

  private readonly queueBoundsSync = (): void => {
    if (!this.paired || this.syncing || this.syncScheduled) return
    this.syncScheduled = true
    this.syncTimer = this.setTimeoutFn(() => {
      this.syncScheduled = false
      this.syncTimer = undefined
      this.synchronizeFromHost()
    }, 0)
  }

  private synchronizeFromHost(): void {
    const bounds = this.readBounds(this.videoHost)
    if (!bounds) return
    this.synchronizePair(bounds, false)
  }

  private synchronizePair(bounds: WindowBounds, schedule = true): void {
    this.syncing = true
    try {
      this.setIfDifferent(this.videoHost, bounds)
      if (this.uiOverlay !== this.videoHost) this.setIfDifferent(this.uiOverlay, bounds)
    } finally {
      this.syncing = false
    }
    if (schedule) this.queueBoundsSync()
  }

  private setIfDifferent(window: ManagedWindow, bounds: WindowBounds): void {
    const current = this.readBounds(window)
    if (!current || sameBounds(current, bounds) || !this.isLive(window)) return
    this.callSafely(window, () => window.setBounds(bounds))
  }

  private handleFullscreenChanged(fullscreen: boolean): void {
    if (fullscreen) {
      this.fullscreenExitRequested = false
      this.synchronizeFromHost()
    } else {
      const reenter = this.reenterAfterFullscreenLeave
      this.reenterAfterFullscreenLeave = false
      this.fullscreenExitRequested = false
      if (reenter) {
        // Keep the fullscreen rectangle in place while the native transition
        // immediately starts again. The saved windowed bounds are restored on
        // the eventual leave event.
        this.callSafely(this.videoHost, () => this.videoHost.setFullScreen(true))
      } else {
        this.restorePreFullscreenBounds()
      }
    }
    if (this.lastFullscreenNotification === fullscreen) return
    this.lastFullscreenNotification = fullscreen
    for (const listener of this.fullscreenListeners) {
      try {
        listener(fullscreen)
      } catch {
        // A renderer notification must not prevent the other listeners from
        // observing the native transition or break Electron's event handler.
      }
    }
  }

  private forEachDistinctLive(action: (window: ManagedWindow) => void): void {
    if (this.isLive(this.videoHost)) action(this.videoHost)
    if (this.uiOverlay !== this.videoHost && this.isLive(this.uiOverlay)) action(this.uiOverlay)
  }

  private isLive(window: ManagedWindow): boolean {
    try {
      return !window.isDestroyed()
    } catch {
      return false
    }
  }

  private readBounds(window: ManagedWindow): WindowBounds | undefined {
    if (!this.isLive(window)) return undefined
    try {
      return window.getBounds()
    } catch {
      return undefined
    }
  }

  private callSafely(window: ManagedWindow, action: () => void): void {
    if (!this.isLive(window)) return
    try {
      action()
    } catch {
      // Native windows may disappear between the liveness check and the call.
    }
  }

  private cancelScheduledSync(): void {
    if (!this.syncScheduled) return
    this.clearTimeoutFn(this.syncTimer)
    this.syncScheduled = false
    this.syncTimer = undefined
  }
}

function emptyBounds(): WindowBounds {
  return { x: 0, y: 0, width: 0, height: 0 }
}

/**
 * Creates the platform-specific application window model. Keeping the Windows
 * case in this function means the main process has one renderer target and one
 * mpv target on every platform, without spreading nullable overlay checks over
 * startup and IPC code.
 */
export function createAppWindowSet({
  preloadPath,
  platform = process.platform,
  createWindow = (options) => new BrowserWindow(options),
  setTimeoutFn,
  clearTimeoutFn
}: CreateAppWindowSetOptions): AppWindowSet {
  if (platform !== 'linux') {
    const window = createWindow(getMainWindowOptions(preloadPath))
    const coordinator = new AppWindowCoordinator(window, window, {
      paired: false,
      setTimeoutFn,
      clearTimeoutFn
    })
    return {
      videoHost: window,
      uiOverlay: window,
      paired: false,
      coordinator,
      controlsFor: (candidate) =>
        candidate === window && !bothDestroyed(coordinator) ? coordinator : null,
      onFullscreenChanged: (listener) => coordinator.onFullscreenChanged(listener),
      activate: () => coordinator.activate(),
      close: () => coordinator.close()
    }
  }

  const videoHost = createWindow(getLinuxVideoHostOptions())
  const uiOverlay = createWindow(getLinuxUiOverlayOptions(preloadPath, videoHost))
  syncInitialWindowBounds(videoHost, uiOverlay)
  const coordinator = new AppWindowCoordinator(videoHost, uiOverlay, {
    paired: true,
    setTimeoutFn,
    clearTimeoutFn
  })

  return {
    videoHost,
    uiOverlay,
    paired: true,
    coordinator,
    controlsFor: (candidate) =>
      (candidate === videoHost || candidate === uiOverlay) && !bothDestroyed(coordinator)
        ? coordinator
        : null,
    onFullscreenChanged: (listener) => coordinator.onFullscreenChanged(listener),
    activate: () => coordinator.activate(),
    close: () => coordinator.close()
  }
}

function bothDestroyed(coordinator: AppWindowCoordinator): boolean {
  return coordinator.isCompletelyDestroyed()
}

export interface ContentBoundsWindow {
  getContentBounds(): WindowBounds
  setContentBounds(bounds: WindowBounds): void
}

/** Aligns the child overlay once, before either Linux window is presented. */
export function syncInitialWindowBounds(
  videoHost: ContentBoundsWindow,
  uiOverlay: ContentBoundsWindow
): void {
  uiOverlay.setContentBounds(videoHost.getContentBounds())
}

interface CloseableWindow {
  on(event: 'close' | 'closed', listener: () => void): unknown
  close(): void
  isDestroyed(): boolean
}

/**
 * Closes the other side when either side is closed or unexpectedly destroyed.
 * The guard is intentionally local to the pair: it prevents close handlers from
 * recursively closing each other while still allowing the app's normal
 * `window-all-closed`/`before-quit` path to run.
 */
export function attachPairCloseHandlers(
  videoHost: CloseableWindow,
  uiOverlay: CloseableWindow
): () => void {
  let closing = false

  const closePair = (initiator?: CloseableWindow): void => {
    if (closing) return
    closing = true
    if (initiator !== uiOverlay && !uiOverlay.isDestroyed()) uiOverlay.close()
    if (initiator !== videoHost && !videoHost.isDestroyed()) videoHost.close()
  }

  videoHost.on('close', () => closePair(videoHost))
  uiOverlay.on('close', () => closePair(uiOverlay))
  videoHost.on('closed', () => closePair(videoHost))
  uiOverlay.on('closed', () => closePair(uiOverlay))

  return () => closePair()
}

export interface RendererWindowLoadOptions {
  devUrl?: string
  packagedHtmlPath: string
}

export interface RendererWindowTarget {
  webContents: {
    on(event: 'did-fail-load', listener: () => void): unknown
  }
  loadURL(url: string): Promise<unknown> | unknown
  loadFile(path: string): Promise<unknown> | unknown
}

/** Loads the renderer only into the renderer-owning overlay window. */
export function loadRendererWindow(
  uiOverlay: RendererWindowTarget,
  { devUrl, packagedHtmlPath }: RendererWindowLoadOptions
): void {
  if (devUrl) {
    let attemptsLeft = 3
    uiOverlay.webContents.on('did-fail-load', () => {
      if (attemptsLeft <= 0) return
      attemptsLeft -= 1
      setTimeout(() => void uiOverlay.loadURL(devUrl), 500)
    })
    void uiOverlay.loadURL(devUrl)
    return
  }
  void uiOverlay.loadFile(packagedHtmlPath)
}

/**
 * Presents a Linux pair only after Electron reports that the overlay renderer
 * has painted once. The overlay is shown first so the host is never visible
 * without its DOM surface; the host is then shown immediately behind that
 * child.
 */
export function presentAppWindowSet(
  windows: AppWindowSet,
  onRendererReady: (callback: () => void) => void = (callback) =>
    windows.uiOverlay.once('ready-to-show', callback)
): void {
  if (!windows.paired) return

  let presented = false
  onRendererReady(() => {
    if (presented || windows.uiOverlay.isDestroyed() || windows.videoHost.isDestroyed()) return
    presented = true
    windows.uiOverlay.show()
    windows.videoHost.show()
    windows.uiOverlay.focus()
  })
}

/** The packaged renderer path used by the main-process startup code. */
export function packagedRendererPath(dirname: string): string {
  return join(dirname, '../renderer/index.html')
}
