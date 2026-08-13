import { createRequire } from 'node:module'
import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron'
import type { OcrDisplayBounds } from '../../../shared/ocr'
import {
  applyNavigationGuards,
  applyReloadGuard,
  type NavigationGuardTarget,
  type InputGuardTarget
} from '../../windowOptions'
import {
  createGameOcrWindowController,
  type GameOcrNativeWindow,
  type GameOcrWindow
} from './frozenFrameController'
import { registerGameOcrIpc, type GameOcrIpcMain } from './frozenFrameIpc'

/** Options needed to construct the Windows-only frozen-frame window. */
export interface GameOcrWindowConstructionOptions {
  preloadPath: string
  displayBounds: OcrDisplayBounds
}

/** The construction-time surface: what the controller needs, plus loading. */
export interface GameOcrConstructedWindow extends GameOcrNativeWindow {
  /** Excludes this overlay from Windows desktop capture. */
  setContentProtection(enable: boolean): void
  loadURL(url: string): Promise<unknown> | unknown
  loadFile(path: string, options?: { query?: Record<string, string> }): Promise<unknown> | unknown
  webContents: GameOcrNativeWindow['webContents'] &
    NavigationGuardTarget &
    InputGuardTarget & {
      openDevTools?(options?: { mode?: string }): void
    }
}

/** Display events that invalidate an active frozen frame's placement. */
export interface GameOcrDisplayEvents {
  on(event: 'display-metrics-changed' | 'display-removed', listener: () => void): unknown
  removeListener(
    event: 'display-metrics-changed' | 'display-removed',
    listener: () => void
  ): unknown
}

/**
 * The dedicated window is opaque and deliberately sits above the game. Its
 * bounds are logical desktop coordinates, so negative secondary-monitor
 * origins are preserved exactly.
 *
 * It is deliberately **not focusable**. Windows refuses a cross-process
 * foreground steal — measured: an external application keeps the real
 * foreground window for the whole time this window is shown, while Electron's
 * own `isFocused()` reports true and does not say so — and the cost of that is
 * paid by the user: the first mouse press on a window the system has not
 * activated is spent activating it rather than reaching the page, so
 * dismissing the frame took two presses. A window that never activates has no
 * activation click to spend, and the game keeps the foreground, which also
 * means it keeps rendering behind the frozen frame instead of stalling until
 * the user clicks it back.
 *
 * The cost is that the page has no keyboard focus, so Escape and Ctrl+C cannot
 * arrive as page events. The coordinator registers those as global shortcuts
 * for exactly as long as a frame is visible.
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
    focusable: false,
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
      // `backgroundThrottling: false` deliberately absent. Electron implements
      // it by setting Chromium's `disable_hidden_`, so the widget never makes
      // the hidden→shown transition this window makes on every frame, and
      // nothing on the capture path is throttled anyway: opening a stream and
      // encoding a canvas are promises, not timers. It bought nothing and is
      // the prime suspect for a frame that draws but does not take clicks.
    }
  }
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
  ) as unknown as GameOcrConstructedWindow
  // Windows clamps a window's *initial* size to the display's work area, so a
  // window constructed at the full display bounds comes up short by the
  // taskbar and leaves a live strip of the game uncovered below the frozen
  // frame. Re-asserting the same rectangle is not clamped, and applying it
  // while the window is still hidden means the first frame is already exact.
  window.setBounds({ ...options.displayBounds })
  // This is the capture-safety invariant. On Windows Electron maps it to
  // WDA_EXCLUDEFROMCAPTURE, so desktopCapturer receives the game beneath this
  // overlay even while the old frozen frame and its boxes remain visible.
  window.setContentProtection(true)
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

function unsupportedWindow(): GameOcrWindow {
  return {
    freeze: async () => {
      throw new Error('Game OCR frozen-frame presentation is only supported on Windows.')
    },
    captureBytes: async () => {
      throw new Error('Game OCR frozen-frame presentation is only supported on Windows.')
    },
    reportFrozen: () => {},
    reportCaptureBytes: () => {},
    reportRegionsRendered: () => {},
    setRecognizing: () => {},
    setRegions: () => {},
    rendererReady: () => {},
    copySelection: () => {},
    moveTo: () => {},
    discard: async () => {},
    dismiss: async () => {},
    close: async () => {},
    isVisible: () => false,
    onDismissed: () => () => {},
    onClosed: () => () => {},
    onRegionsRendered: () => () => {}
  }
}
