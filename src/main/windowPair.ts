import { BrowserWindow, type BrowserWindowConstructorOptions } from 'electron'
import {
  getLinuxUiOverlayOptions,
  getLinuxVideoHostOptions,
  getMainWindowOptions,
  type WindowBounds,
  type WindowControlTarget
} from './windowOptions'
import type { WindowShapeRect } from '../shared/windowShape'

type WindowPairEvent =
  'close' | 'closed' | 'move' | 'resize' | 'enter-full-screen' | 'leave-full-screen'

export interface WindowCloseEvent {
  preventDefault(): void
}

interface ManagedWindow extends Omit<
  WindowControlTarget,
  'capturePreFullscreenBounds' | 'hasPreFullscreenBounds'
> {
  isDestroyed(): boolean
  isMinimized(): boolean
  show(): void
  restore(): void
  getMediaSourceId(): string
  moveAbove(mediaSourceId: string): void
  on(event: WindowPairEvent, listener: (event?: WindowCloseEvent) => void): unknown
}

export interface AppWindowSet {
  /** Window whose native handle is passed to mpv as `--wid`. */
  readonly videoHost: BrowserWindow
  /** Window containing the preload and React renderer. */
  readonly uiOverlay: BrowserWindow
  readonly coordinator: AppWindowCoordinator
  readonly controlsFor: (window: BrowserWindow | null) => WindowControlTarget | null
  /** Subscribes to deduplicated native fullscreen transitions. */
  readonly onFullscreenChanged: (listener: (fullscreen: boolean) => void) => () => void
  readonly activate: () => void
  readonly close: () => void
}

export type BrowserWindowFactory = (options: BrowserWindowConstructorOptions) => BrowserWindow

export interface CreateAppWindowSetOptions {
  preloadPath: string
  platform?: NodeJS.Platform
  createWindow?: BrowserWindowFactory
  closeGuard?: (event: WindowCloseEvent) => boolean
  setTimeoutFn?: WindowPairSetTimeout
  clearTimeoutFn?: WindowPairClearTimeout
}

export type WindowPairSetTimeout = (callback: () => void, delayMs: number) => unknown
export type WindowPairClearTimeout = (handle: unknown) => void

interface AppWindowCoordinatorOptions {
  paired?: boolean
  closeGuard?: (event: WindowCloseEvent) => boolean
  setTimeoutFn?: WindowPairSetTimeout
  clearTimeoutFn?: WindowPairClearTimeout
}

// Avoid native writes that would generate redundant geometry events.
function sameBounds(left: WindowBounds, right: WindowBounds): boolean {
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  )
}

// Linux drag/resize originates in the overlay; native fullscreen belongs to the host.
class AppWindowCoordinator implements WindowControlTarget {
  private readonly videoHost: ManagedWindow
  private readonly uiOverlay: ManagedWindow
  private readonly paired: boolean
  private readonly setTimeoutFn: WindowPairSetTimeout
  private readonly clearTimeoutFn: WindowPairClearTimeout
  private readonly fullscreenListeners = new Set<(fullscreen: boolean) => void>()
  private readonly closePair: (force?: boolean) => void
  private syncScheduled = false
  private syncTimer: unknown
  private syncing = false
  private pendingBoundsSource: ManagedWindow | undefined
  private readonly expectedProgrammaticBounds = new WeakMap<ManagedWindow, WindowBounds>()
  private preFullscreenBounds: WindowBounds | undefined
  private fullscreenExitRequested = false
  private reenterAfterFullscreenLeave = false
  private lastFullscreenNotification: boolean | undefined
  private overlayIndependent = false

  constructor(
    videoHost: ManagedWindow,
    uiOverlay: ManagedWindow,
    {
      paired = videoHost !== uiOverlay,
      closeGuard,
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
    this.closePair = attachPairCloseHandlers(videoHost, uiOverlay, closeGuard)

    if (paired) {
      videoHost.on('move', this.queueHostBoundsSync)
      videoHost.on('resize', this.queueHostBoundsSync)
      // Overlay drag/resize must update the host, not snap back to its old bounds.
      uiOverlay.on('move', this.queueOverlayBoundsSync)
      uiOverlay.on('resize', this.queueOverlayBoundsSync)
    }

    // Only the host owns native fullscreen; child events would duplicate transitions.
    videoHost.on('enter-full-screen', () => this.handleFullscreenChanged(true))
    videoHost.on('leave-full-screen', () => this.handleFullscreenChanged(false))
  }

  getBounds(): WindowBounds {
    const primary = this.isFullScreen() ? this.videoHost : this.uiOverlay
    const fallback = primary === this.videoHost ? this.uiOverlay : this.videoHost
    return this.readBounds(primary) ?? this.readBounds(fallback) ?? emptyBounds()
  }

  setBounds(bounds: WindowBounds): void {
    this.overlayIndependent = false
    this.synchronizePair(bounds)
    this.queueBoundsSync(this.isFullScreen() ? this.videoHost : this.uiOverlay)
  }

  /** Applies compact non-player geometry to the renderer overlay only. */
  setOverlayBounds(bounds: WindowBounds): void {
    if (!this.paired) {
      this.setBounds(bounds)
      return
    }
    this.cancelScheduledSync()
    this.overlayIndependent = true
    this.syncing = true
    try {
      this.setIfDifferent(this.uiOverlay, bounds)
    } finally {
      this.syncing = false
    }
  }

  minimize(): void {
    this.forEachDistinctLive((window) => this.callSafely(window, () => window.minimize()))
  }

  restore(): void {
    this.forEachDistinctLive((window) => {
      this.callSafely(window, () => {
        if (window.isMinimized()) window.restore()
      })
    })
  }

  focus(): void {
    if (this.isLive(this.videoHost)) this.callSafely(this.videoHost, () => this.videoHost.focus())
    if (this.uiOverlay !== this.videoHost && this.isLive(this.uiOverlay)) {
      // Raise the host beside the overlay so the shaped video region cannot expose another app.
      this.moveOverlayDirectlyAboveHost()
      this.callSafely(this.uiOverlay, () => this.uiOverlay.focus())
    }
  }

  activate(): void {
    this.forEachDistinctLive((window) => this.callSafely(window, () => window.show()))
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

  setAlwaysOnTop(flag: boolean): void {
    this.forEachDistinctLive((window) => this.callSafely(window, () => window.setAlwaysOnTop(flag)))
  }

  setShape(rects: WindowShapeRect[]): void {
    if (!this.paired || !this.isLive(this.uiOverlay)) return
    const setShape = this.uiOverlay.setShape
    if (!setShape) return
    this.callSafely(this.uiOverlay, () => setShape.call(this.uiOverlay, rects))
  }

  close(force = false): void {
    this.cancelScheduledSync()
    this.closePair(force)
  }

  isCompletelyDestroyed(): boolean {
    return !this.isLive(this.videoHost) && !this.isLive(this.uiOverlay)
  }

  capturePreFullscreenBounds(): void {
    if (this.isFullScreen() || this.preFullscreenBounds) return
    const bounds = this.readBounds(this.videoHost)
    if (bounds) this.preFullscreenBounds = bounds
  }

  hasPreFullscreenBounds(): boolean {
    return this.preFullscreenBounds !== undefined
  }

  restorePreFullscreenBounds(): void {
    const bounds = this.preFullscreenBounds
    if (!bounds) return
    this.preFullscreenBounds = undefined
    this.synchronizePair(bounds, false)
  }

  onFullscreenChanged(listener: (fullscreen: boolean) => void): () => void {
    this.fullscreenListeners.add(listener)
    return () => this.fullscreenListeners.delete(listener)
  }

  private readonly queueHostBoundsSync = (): void => {
    this.queueBoundsSync(this.videoHost)
  }

  private readonly queueOverlayBoundsSync = (): void => {
    this.queueBoundsSync(this.uiOverlay)
  }

  private queueBoundsSync(source: ManagedWindow): void {
    if (!this.paired || this.syncing || this.overlayIndependent) return
    const current = this.readBounds(source)
    const expected = this.expectedProgrammaticBounds.get(source)
    if (current && expected && sameBounds(current, expected)) return
    if (expected) this.expectedProgrammaticBounds.delete(source)
    // Fullscreen is a native transition owned by the host. Ignore any delayed
    // overlay geometry event from the preceding windowed state during it.
    this.pendingBoundsSource = this.isFullScreen() ? this.videoHost : source
    if (this.syncScheduled) return
    this.syncScheduled = true
    this.syncTimer = this.setTimeoutFn(() => {
      this.syncScheduled = false
      this.syncTimer = undefined
      const pendingSource = this.pendingBoundsSource
      this.pendingBoundsSource = undefined
      if (pendingSource) this.synchronizeFrom(pendingSource)
    }, 0)
  }

  private synchronizeFrom(source: ManagedWindow): void {
    const bounds = this.readBounds(source)
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
    if (schedule) this.queueBoundsSync(this.isFullScreen() ? this.videoHost : this.uiOverlay)
  }

  private setIfDifferent(window: ManagedWindow, bounds: WindowBounds): void {
    const current = this.readBounds(window)
    if (!current || sameBounds(current, bounds) || !this.isLive(window)) return
    // Electron emits delayed setBounds events; ignore them so they cannot overwrite a newer drag.
    this.expectedProgrammaticBounds.set(window, { ...bounds })
    this.callSafely(window, () => window.setBounds(bounds))
  }

  private handleFullscreenChanged(fullscreen: boolean): void {
    if (fullscreen) {
      this.fullscreenExitRequested = false
      this.synchronizeFrom(this.videoHost)
    } else {
      const reenter = this.reenterAfterFullscreenLeave
      this.reenterAfterFullscreenLeave = false
      this.fullscreenExitRequested = false
      if (reenter) {
        // Keep fullscreen geometry during re-entry; restore windowed bounds on the eventual leave.
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
        // A failed renderer notification must not interrupt other listeners or native handling.
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

  private moveOverlayDirectlyAboveHost(): void {
    if (!this.paired || !this.isLive(this.videoHost) || !this.isLive(this.uiOverlay)) return
    this.callSafely(this.uiOverlay, () =>
      this.uiOverlay.moveAbove(this.videoHost.getMediaSourceId())
    )
  }

  private cancelScheduledSync(): void {
    if (!this.syncScheduled) return
    this.clearTimeoutFn(this.syncTimer)
    this.syncScheduled = false
    this.syncTimer = undefined
    this.pendingBoundsSource = undefined
  }
}

function emptyBounds(): WindowBounds {
  return { x: 0, y: 0, width: 0, height: 0 }
}

export function createAppWindowSet({
  preloadPath,
  platform = process.platform,
  createWindow = (options) => new BrowserWindow(options),
  closeGuard,
  setTimeoutFn,
  clearTimeoutFn
}: CreateAppWindowSetOptions): AppWindowSet {
  if (platform !== 'linux') {
    const window = createWindow(getMainWindowOptions(preloadPath))
    const coordinator = new AppWindowCoordinator(window, window, {
      paired: false,
      closeGuard,
      setTimeoutFn,
      clearTimeoutFn
    })
    return {
      videoHost: window,
      uiOverlay: window,
      coordinator,
      controlsFor: (candidate) =>
        candidate === window && !coordinator.isCompletelyDestroyed() ? coordinator : null,
      onFullscreenChanged: (listener) => coordinator.onFullscreenChanged(listener),
      activate: () => coordinator.activate(),
      close: () => coordinator.close(true)
    }
  }

  const videoHost = createWindow(getLinuxVideoHostOptions())
  const uiOverlay = createWindow(getLinuxUiOverlayOptions(preloadPath, videoHost))
  syncInitialWindowBounds(videoHost, uiOverlay)
  const coordinator = new AppWindowCoordinator(videoHost, uiOverlay, {
    paired: true,
    closeGuard,
    setTimeoutFn,
    clearTimeoutFn
  })

  return {
    videoHost,
    uiOverlay,
    coordinator,
    controlsFor: (candidate) =>
      (candidate === videoHost || candidate === uiOverlay) && !coordinator.isCompletelyDestroyed()
        ? coordinator
        : null,
    onFullscreenChanged: (listener) => coordinator.onFullscreenChanged(listener),
    activate: () => coordinator.activate(),
    close: () => coordinator.close(true)
  }
}

export interface ContentBoundsWindow {
  getContentBounds(): WindowBounds
  setContentBounds(bounds: WindowBounds): void
}

function syncInitialWindowBounds(
  videoHost: ContentBoundsWindow,
  uiOverlay: ContentBoundsWindow
): void {
  uiOverlay.setContentBounds(videoHost.getContentBounds())
}

export function preparePlayerAppWindowSet(windows: Pick<AppWindowSet, 'videoHost'>): void {
  if (windows.videoHost.isDestroyed()) return
  windows.videoHost.show()
}

export function showOverlayAppWindowSet(
  windows: Pick<AppWindowSet, 'videoHost' | 'uiOverlay'>
): void {
  if (windows.uiOverlay.isDestroyed()) return
  if (windows.videoHost !== windows.uiOverlay && !windows.videoHost.isDestroyed()) {
    windows.videoHost.hide()
  }
  windows.uiOverlay.show()
  windows.uiOverlay.focus()
}

interface CloseableWindow {
  on(event: 'close' | 'closed', listener: (event?: WindowCloseEvent) => void): unknown
  close(): void
  isDestroyed(): boolean
}

// A local guard prevents recursive pair closes without suppressing app shutdown events.
// App-owned forced closes bypass the user-close guard.
function attachPairCloseHandlers(
  videoHost: CloseableWindow,
  uiOverlay: CloseableWindow,
  closeGuard?: (event: WindowCloseEvent) => boolean
): (force?: boolean) => void {
  let closing = false

  const closePair = (
    initiator?: CloseableWindow,
    event?: WindowCloseEvent,
    force = false,
    checkGuard = false
  ): void => {
    if (closing) return
    if (!force && checkGuard && closeGuard) {
      const allowClose = closeGuard(event ?? { preventDefault: () => {} })
      if (!allowClose) {
        event?.preventDefault()
        return
      }
    }
    closing = true
    if (initiator !== uiOverlay && !uiOverlay.isDestroyed()) uiOverlay.close()
    if (initiator !== videoHost && !videoHost.isDestroyed()) videoHost.close()
  }

  videoHost.on('close', (event) => closePair(videoHost, event, false, true))
  uiOverlay.on('close', (event) => closePair(uiOverlay, event, false, true))
  videoHost.on('closed', () => closePair(videoHost))
  uiOverlay.on('closed', () => closePair(uiOverlay))

  return (force = true) => closePair(undefined, undefined, force, true)
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

const PRESENT_FALLBACK_MS = 2000

// Keep the Linux video host hidden until the player runtime starts.
export function presentOverlayAppWindowSet(
  windows: AppWindowSet,
  onRendererReady: (callback: () => void) => void = (callback) => {
    windows.uiOverlay.once('ready-to-show', callback)
    windows.uiOverlay.webContents.once('did-finish-load', callback)
  },
  setTimeoutFn: WindowPairSetTimeout = (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeoutFn: WindowPairClearTimeout = (handle) =>
    clearTimeout(handle as ReturnType<typeof setTimeout>)
): void {
  let presented = false
  let fallbackTimer: unknown
  let fallbackTimerPending = false

  const present = (): void => {
    if (presented || windows.uiOverlay.isDestroyed()) return
    presented = true
    if (fallbackTimerPending) {
      fallbackTimerPending = false
      clearTimeoutFn(fallbackTimer)
      fallbackTimer = undefined
    }
    showOverlayAppWindowSet(windows)
  }

  fallbackTimerPending = true
  fallbackTimer = setTimeoutFn(() => {
    fallbackTimerPending = false
    fallbackTimer = undefined
    present()
  }, PRESENT_FALLBACK_MS)
  onRendererReady(present)
}

// Linux transparent windows may never emit ready-to-show; use did-finish-load and a timeout.
export function presentAppWindowSet(
  windows: AppWindowSet,
  onRendererReady: (callback: () => void) => void = (callback) => {
    windows.uiOverlay.once('ready-to-show', callback)
    windows.uiOverlay.webContents.once('did-finish-load', callback)
  },
  setTimeoutFn: WindowPairSetTimeout = (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeoutFn: WindowPairClearTimeout = (handle) =>
    clearTimeout(handle as ReturnType<typeof setTimeout>)
): void {
  if (windows.videoHost === windows.uiOverlay) return

  let presented = false
  let fallbackTimer: unknown
  let fallbackTimerPending = false

  const present = (): void => {
    if (presented || windows.uiOverlay.isDestroyed() || windows.videoHost.isDestroyed()) return
    presented = true
    if (fallbackTimerPending) {
      fallbackTimerPending = false
      clearTimeoutFn(fallbackTimer)
      fallbackTimer = undefined
    }
    windows.videoHost.show()
    // Raise the host without stealing focus, then place the shaped overlay immediately above it.
    // Raising only the overlay can expose unrelated windows through its hole on X11.
    windows.videoHost.moveTop()
    windows.uiOverlay.show()
    windows.uiOverlay.moveAbove(windows.videoHost.getMediaSourceId())
    windows.uiOverlay.focus()
  }

  fallbackTimerPending = true
  fallbackTimer = setTimeoutFn(() => {
    fallbackTimerPending = false
    fallbackTimer = undefined
    present()
  }, PRESENT_FALLBACK_MS)
  onRendererReady(present)
}
