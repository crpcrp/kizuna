// Construction options + window-control IPC wiring for the app's single
// transparent frameless window (spike-validated; see docs/architecture-plan.md,
// "Window model — SINGLE transparent window").

import type { BrowserWindowConstructorOptions } from 'electron'
import { PRODUCT_NAME } from '../shared/appIdentity'
import { WINDOW_CONTROL_CHANNELS } from '../shared/ipcChannels'
import {
  isWindowBounds,
  miniPlayerBounds,
  type SetWindowBoundsRequest,
  type WindowBounds
} from '../shared/windowBounds'

export type { WindowBounds } from '../shared/windowBounds'

/**
 * Options for the single main window. Load-bearing facts from the spike:
 * `transparent: true` is REQUIRED — an opaque Chromium window paints its own
 * surface over mpv's embedded child window and hides the video. `frame: false`
 * follows (transparent windows cannot use the OS frame); custom WindowChrome
 * supplies drag/min/close later.
 */
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
      // OS-level Chromium sandbox on: the renderer holds a compromised bug to
      // the IPC surface instead of the user's full privileges. The preload only
      // uses contextBridge/ipcRenderer/webUtils, all of which work sandboxed.
      sandbox: true
    }
  }
}

/**
 * The subset of a window's `webContents` the navigation guards touch: a
 * `will-navigate` listener registration, the current URL (to tell a same-page
 * reload apart from a real navigation away), and the window-open handler.
 * Injected so the guards are exercised with a fake instead of live Electron.
 */
export interface NavigationGuardTarget {
  on(
    event: 'will-navigate',
    listener: (event: { preventDefault(): void }, url: string) => void
  ): unknown
  getURL(): string
  setWindowOpenHandler(handler: () => { action: 'deny' } | { action: 'allow' }): unknown
}

/**
 * Locks the renderer to its bundled origin (Electron security checklist
 * #12/#13): denies any top-level navigation away from the currently-loaded URL
 * and refuses every `window.open`/`target=_blank` child window. The app renders
 * links from untrusted subtitle/dictionary content as inert spans, but nothing
 * at the `webContents` level enforced that until now — this is the enforcement.
 * External links, if ever needed, must go through `shell.openExternal` after an
 * explicit allowlist/scheme check, not through in-page navigation.
 */
export function applyNavigationGuards(webContents: NavigationGuardTarget): void {
  webContents.on('will-navigate', (event, url) => {
    if (url !== webContents.getURL()) event.preventDefault()
  })
  webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
}

/** The subset of a window's `webContents` the reload guard touches: a
 * `before-input-event` listener registration, matching `applyNavigationGuards`. */
export interface InputGuardTarget {
  on(
    event: 'before-input-event',
    listener: (event: { preventDefault(): void }, input: BeforeInputEventInput) => void
  ): unknown
}

/** The subset of Electron's `Input` (from `before-input-event`) the reload guard reads. */
export interface BeforeInputEventInput {
  type: string
  key: string
  control: boolean
  meta: boolean
}

/**
 * Chromium ships a built-in Ctrl+R / Cmd+R "reload this page" shortcut that
 * fires ahead of any renderer keydown listener, wiping the current app
 * session (playback position, sync state) with no warning. `before-input-event`
 * is the only boundary that can intercept it before Chromium's own handling,
 * so this is wired at window creation next to `applyNavigationGuards`. Only
 * the Ctrl/Cmd+R chord is swallowed: Electron reports the same `control` flag
 * for left and right Ctrl, so the right-Control chord is covered for free. A
 * bare `R` keydown is untouched and still reaches the renderer's Replay Line
 * binding (`src/shared/playerSettings.ts`), and every other modified shortcut
 * passes through unaffected.
 */
export function applyReloadGuard(webContents: InputGuardTarget): void {
  webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    if (input.key.toLowerCase() !== 'r') return
    if (!input.control && !input.meta) return
    event.preventDefault()
  })
}

/** The subset of a window's `webContents` a safe send needs. */
export interface SendableWebContents {
  isDestroyed(): boolean
  send(channel: string, ...args: unknown[]): void
}

/** The subset of BrowserWindow a safe send needs: just enough to check
 * liveness and reach its `webContents`. Deliberately not the full Electron
 * `BrowserWindow` type, so tests exercise this with a plain fake object. */
export interface SendTarget {
  isDestroyed(): boolean
  webContents: SendableWebContents
}

/**
 * Sends `channel` (with `args`) to `win`'s renderer, but only if both the
 * window and its `webContents` are still alive. Electron's `webContents.send`
 * throws/misbehaves once either side has been destroyed (e.g. the window
 * closed mid-async-operation), so this function centralizes the
 * `isDestroyed()` guard. No-ops
 * silently on a missing or destroyed window; never sends more than once.
 */
export function sendToWindow(
  win: SendTarget | null | undefined,
  channel: string,
  ...args: unknown[]
): void {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return
  win.webContents.send(channel, ...args)
}

/** The subset of BrowserWindow the window-control channels act on. */
export interface WindowControlTarget {
  minimize(): void
  close(): void
  focus(): void
  setFullScreen(flag: boolean): void
  isFullScreen(): boolean
  getBounds(): WindowBounds
  setBounds(bounds: WindowBounds): void
  setAlwaysOnTop(flag: boolean): void
}

/** The subset of Electron's ipcMain we need. The fire-and-forget commands use
 * `on`; `getBounds`/`setBounds` return a value, so they go through `handle`
 * (invoke/handle). Electron types the two callbacks' events differently
 * (`IpcMainEvent` vs `IpcMainInvokeEvent`), so the event type is generic per
 * method — the window resolver only reads the shared `.sender`. */
export interface IpcMainLike<E, I> {
  on(channel: string, listener: (event: E, ...args: unknown[]) => void): unknown
  handle(channel: string, listener: (event: I, ...args: unknown[]) => unknown): unknown
}

/** One display's usable area (`Electron.Display`'s `workArea`). */
export interface DisplayLike {
  workArea: WindowBounds
}

/** The subset of Electron's `screen` module mini-player needs: resolve which
 * display a rectangle mostly sits on, so the mini window lands on the monitor
 * the window currently occupies rather than always the primary. */
export interface ScreenLike {
  getDisplayMatching(rect: WindowBounds): DisplayLike
}

/**
 * Pure resolver for a `window:setBounds` request. An `explicit` request applies
 * its validated rectangle verbatim; a
 * `miniPlayer` request computes the bottom-right corner of the work area of the
 * display the window currently occupies — never the primary — via
 * `screen.getDisplayMatching(win.getBounds())`. Returns null for a malformed or
 * unrecognized request so the handler can no-op.
 */
export function resolveWindowBounds(
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

/**
 * Remembers each window's bounds from just before it entered fullscreen, so
 * they can be restored on the way out. Keyed by window identity (a WeakMap so
 * a closed window's entry is simply garbage-collected, no explicit cleanup
 * needed).
 *
 * This works around a real Electron/Windows gap: for a `frame: false`
 * (frameless) window — which this app requires, see `getMainWindowOptions` —
 * `setFullScreen(false)` does not reliably restore the window's prior size on
 * Windows; it can leave the window at the display's fullscreen bounds
 * instead. Capturing bounds ourselves before entering fullscreen and
 * re-applying them after leaving makes the restore deterministic regardless
 * of that platform quirk.
 */
const preFullscreenBounds = new WeakMap<WindowControlTarget, WindowBounds>()

/**
 * Captures `win`'s current bounds as "the size to return to" — call this
 * right before `setFullScreen(true)`, while the window still holds its
 * windowed-mode bounds. No-ops if `win` is already fullscreen (so toggling
 * fullscreen off then back on via other means can't clobber the original
 * saved bounds with fullscreen-sized ones).
 */
export function capturePreFullscreenBounds(win: WindowControlTarget): void {
  if (win.isFullScreen() || preFullscreenBounds.has(win)) return
  preFullscreenBounds.set(win, win.getBounds())
}

/**
 * Re-applies `win`'s captured pre-fullscreen bounds (if any were captured)
 * and forgets them. Call this after the window has actually left fullscreen
 * (e.g. from the BrowserWindow's `leave-full-screen` event in index.ts) so
 * the restore isn't racing the OS's own fullscreen-exit animation/transition.
 * No-ops if nothing was captured (e.g. the window started fullscreen, or
 * bounds were already consumed by a prior restore).
 */
export function restorePreFullscreenBounds(win: WindowControlTarget): void {
  const bounds = preFullscreenBounds.get(win)
  if (!bounds) return
  preFullscreenBounds.delete(win)
  win.setBounds(bounds)
}

/**
 * Registers the window-control channels ('window:minimize' / 'window:close' /
 * 'window:setFullscreen' / 'window:toggleFullscreen'). Pure wiring: the
 * ipcMain-like object and the event→window resolver are injected so tests
 * exercise this with fakes instead of live Electron. The matching
 * 'window:fullscreenChanged' push (main→renderer) is wired at window creation
 * (index.ts), where the BrowserWindow's enter/leave-full-screen events live —
 * that's also where `restorePreFullscreenBounds` is called, since it must run
 * after the OS-level transition finishes, not right after we ask for it.
 */
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
    if (fullscreen) capturePreFullscreenBounds(win)
    win.setFullScreen(fullscreen)
  })
  ipc.on(WINDOW_CONTROL_CHANNELS.toggleFullscreen, (event) => {
    const win = windowFromEvent(event)
    if (!win) return
    // Electron can transiently report windowed while the fullscreen transition
    // is still active. A saved pre-fullscreen rectangle proves this window is
    // in that cycle, so treat toggle as an exit instead of recapturing the
    // fullscreen-sized bounds and requesting fullscreen again.
    const next = !win.isFullScreen() && !preFullscreenBounds.has(win)
    if (next) capturePreFullscreenBounds(win)
    win.setFullScreen(next)
  })
  ipc.on(WINDOW_CONTROL_CHANNELS.setSize, (event, width, height) => {
    const win = windowFromEvent(event)
    if (!win) return
    if (typeof width !== 'number' || typeof height !== 'number') return
    win.setBounds({ ...win.getBounds(), width: Math.round(width), height: Math.round(height) })
  })
  ipc.on(WINDOW_CONTROL_CHANNELS.setAlwaysOnTop, (event, flag) => {
    windowFromEvent(event)?.setAlwaysOnTop(Boolean(flag))
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
