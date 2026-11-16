import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron'
import type { IpcMainLike } from './ipc'
import { PRODUCT_NAME } from '../shared/appIdentity'
import { WINDOW_CONTROL_CHANNELS } from '../shared/ipcChannels'
import { isFiniteNumber } from '../shared/guards'
import {
  isWindowBounds,
  miniPlayerBounds,
  type SetWindowBoundsRequest,
  type WindowBounds
} from '../shared/windowBounds'
import { normalizeWindowShapeRects, type WindowShapeRect } from '../shared/windowShape'

export type { WindowBounds } from '../shared/windowBounds'

// Transparency keeps Chromium from covering embedded mpv; transparent windows need a custom frame.
export function getMainWindowOptions(preloadPath: string): BrowserWindowConstructorOptions {
  return {
    width: 1280,
    height: 720,
    title: PRODUCT_NAME,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000', // fully transparent, never paints an opaque surface
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      // Keep compromised renderers confined to IPC; the preload APIs work sandboxed.
      sandbox: true
    }
  }
}

// The bare X11 --wid host stays hidden until the overlay loads; black supplies letterboxing.
export function getLinuxVideoHostOptions(): BrowserWindowConstructorOptions {
  return {
    width: 1280,
    height: 720,
    title: PRODUCT_NAME,
    frame: false,
    transparent: false,
    backgroundColor: '#000000',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  }
}

// Parent ownership maintains stacking; skipTaskbar avoids a second taskbar entry.
export function getLinuxUiOverlayOptions(
  preloadPath: string,
  parent: BrowserWindow
): BrowserWindowConstructorOptions {
  return {
    width: 1280,
    height: 720,
    title: PRODUCT_NAME,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    show: false,
    parent,
    skipTaskbar: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  }
}

export interface NavigationGuardTarget {
  on(
    event: 'will-navigate',
    listener: (event: { preventDefault(): void }, url: string) => void
  ): unknown
  getURL(): string
  setWindowOpenHandler(handler: () => { action: 'deny' } | { action: 'allow' }): unknown
}

// Untrusted subtitle/dictionary content must not navigate or open windows.
// External links require shell.openExternal with an explicit scheme/allowlist check.
export function applyNavigationGuards(webContents: NavigationGuardTarget): void {
  webContents.on('will-navigate', (event, url) => {
    if (url !== webContents.getURL()) event.preventDefault()
  })
  webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
}

export interface InputGuardTarget {
  on(
    event: 'before-input-event',
    listener: (event: { preventDefault(): void }, input: BeforeInputEventInput) => void
  ): unknown
}

export interface BeforeInputEventInput {
  type: string
  key: string
  control: boolean
  meta: boolean
}

// Chromium handles Ctrl/Cmd+R before renderer keydown, discarding the playback session.
// Intercept it here while leaving bare R available for Replay Line.
export function applyReloadGuard(webContents: InputGuardTarget): void {
  webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    if (input.key.toLowerCase() !== 'r') return
    if (!input.control && !input.meta) return
    event.preventDefault()
  })
}

interface SendableWebContents {
  isDestroyed(): boolean
  send(channel: string, ...args: unknown[]): void
}

export interface SendTarget {
  isDestroyed(): boolean
  webContents: SendableWebContents
}

// Async work may finish after the window closes; Electron cannot send to destroyed contents.
export function sendToWindow(
  win: SendTarget | null | undefined,
  channel: string,
  ...args: unknown[]
): void {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return
  win.webContents.send(channel, ...args)
}

export interface WindowControlTarget {
  minimize(): void
  close(): void
  focus(): void
  setFullScreen(flag: boolean): void
  isFullScreen(): boolean
  getBounds(): WindowBounds
  setBounds(bounds: WindowBounds): void
  setAlwaysOnTop(flag: boolean): void
  setShape?(rects: WindowShapeRect[]): void
  // Windows frameless windows need explicit bounds restoration after fullscreen.
  capturePreFullscreenBounds(): void
  hasPreFullscreenBounds(): boolean
}

interface DisplayLike {
  workArea: WindowBounds
}

export interface ScreenLike {
  getDisplayMatching(rect: WindowBounds): DisplayLike
}

function resolveWindowBounds(
  win: Pick<WindowControlTarget, 'getBounds'>,
  screen: ScreenLike,
  request: unknown
): WindowBounds | null {
  if (!request || typeof request !== 'object') return null
  const req = request as Partial<SetWindowBoundsRequest>
  if (req.mode === 'miniPlayer') {
    const topBarHeight = typeof req.topBarHeight === 'number' ? req.topBarHeight : 0
    const bottomBarHeight = typeof req.bottomBarHeight === 'number' ? req.bottomBarHeight : 0
    const workArea = screen.getDisplayMatching(win.getBounds()).workArea
    return miniPlayerBounds(workArea, topBarHeight, bottomBarHeight)
  }
  if (req.mode === 'explicit' && isWindowBounds(req.bounds)) {
    return {
      x: Math.round(req.bounds.x),
      y: Math.round(req.bounds.y),
      width: Math.round(req.bounds.width),
      height: Math.round(req.bounds.height)
    }
  }
  return null
}

export function registerWindowControls<E, I>(
  ipc: IpcMainLike<E, I>,
  windowFromEvent: (event: E | I) => WindowControlTarget | null,
  screen: ScreenLike,
  beforeClose?: () => void
): void {
  ipc.on(WINDOW_CONTROL_CHANNELS.minimize, (event) => windowFromEvent(event)?.minimize())
  ipc.on(WINDOW_CONTROL_CHANNELS.close, (event) => {
    const win = windowFromEvent(event)
    if (!win) return
    beforeClose?.()
    win.close()
  })
  ipc.on(WINDOW_CONTROL_CHANNELS.setFullscreen, (event, flag) => {
    const win = windowFromEvent(event)
    if (!win) return
    const fullscreen = Boolean(flag)
    if (fullscreen) win.capturePreFullscreenBounds()
    win.setFullScreen(fullscreen)
  })
  ipc.on(WINDOW_CONTROL_CHANNELS.toggleFullscreen, (event) => {
    const win = windowFromEvent(event)
    if (!win) return
    // During a native transition, isFullScreen may be false despite saved windowed bounds.
    // Treat that cycle as an exit to avoid saving fullscreen-sized bounds.
    const next = !win.isFullScreen() && !win.hasPreFullscreenBounds()
    if (next) win.capturePreFullscreenBounds()
    win.setFullScreen(next)
  })
  ipc.on(WINDOW_CONTROL_CHANNELS.setSize, (event, width, height) => {
    const win = windowFromEvent(event)
    if (!win) return
    if (!isPositiveFiniteNumber(width) || !isPositiveFiniteNumber(height)) return
    win.setBounds({ ...win.getBounds(), width: Math.round(width), height: Math.round(height) })
  })
  ipc.on(WINDOW_CONTROL_CHANNELS.setAlwaysOnTop, (event, flag) => {
    windowFromEvent(event)?.setAlwaysOnTop(Boolean(flag))
  })
  ipc.on(WINDOW_CONTROL_CHANNELS.setShape, (event, value) => {
    const win = windowFromEvent(event)
    if (!win?.setShape) return
    const bounds = win.getBounds()
    const rects = normalizeWindowShapeRects(value, bounds.width, bounds.height)
    if (rects) win.setShape(rects)
  })
  ipc.handle(WINDOW_CONTROL_CHANNELS.getBounds, (event) => {
    const win = windowFromEvent(event)
    return win ? win.getBounds() : null
  })
  ipc.handle(WINDOW_CONTROL_CHANNELS.setBounds, (event, request) => {
    const win = windowFromEvent(event)
    if (!win) return null
    const bounds = resolveWindowBounds(win, screen, request)
    if (!bounds) return null
    win.setBounds(bounds)
    win.focus()
    return bounds
  })
}

function isPositiveFiniteNumber(value: unknown): value is number {
  return isFiniteNumber(value) && value > 0
}
