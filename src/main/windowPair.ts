import { BrowserWindow, type BrowserWindowConstructorOptions } from 'electron'
import { join } from 'node:path'
import {
  getLinuxUiOverlayOptions,
  getLinuxVideoHostOptions,
  getMainWindowOptions,
  type WindowBounds
} from './windowOptions'

export interface AppWindowSet {
  /** Window whose native handle is passed to mpv as `--wid`. */
  readonly videoHost: BrowserWindow
  /** Window containing the preload and React renderer. */
  readonly uiOverlay: BrowserWindow
  /** True only when Linux has two distinct BrowserWindows. */
  readonly paired: boolean
  /** Closes both Linux windows with recursion protection; closes the one Windows window otherwise. */
  readonly close: () => void
}

export type BrowserWindowFactory = (options: BrowserWindowConstructorOptions) => BrowserWindow

export interface CreateAppWindowSetOptions {
  preloadPath: string
  platform?: NodeJS.Platform
  createWindow?: BrowserWindowFactory
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
  createWindow = (options) => new BrowserWindow(options)
}: CreateAppWindowSetOptions): AppWindowSet {
  if (platform !== 'linux') {
    const window = createWindow(getMainWindowOptions(preloadPath))
    return {
      videoHost: window,
      uiOverlay: window,
      paired: false,
      close: () => window.close()
    }
  }

  const videoHost = createWindow(getLinuxVideoHostOptions())
  const uiOverlay = createWindow(getLinuxUiOverlayOptions(preloadPath, videoHost))
  syncInitialWindowBounds(videoHost, uiOverlay)
  const close = attachPairCloseHandlers(videoHost, uiOverlay)

  return { videoHost, uiOverlay, paired: true, close }
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
