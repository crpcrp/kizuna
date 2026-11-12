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
  registerGameOcrIpc,
  type GameOcrIpcMain,
  type GameOcrNativeWindow,
  type GameOcrWindow
} from './frozenFrameController'

/** The construction-time surface: what the controller needs, plus loading. */
export interface GameOcrConstructedWindow extends GameOcrNativeWindow {
  /** Excludes this overlay from Windows desktop capture. */
  setContentProtection(enable: boolean): void
  loadURL(url: string): Promise<unknown> | unknown
  loadFile(path: string): Promise<unknown> | unknown
  webContents: GameOcrNativeWindow['webContents'] & NavigationGuardTarget & InputGuardTarget
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
 * It must be focusable: leaving the game in the foreground lets games that
 * poll foreground input observe clicks even when the page handles them.
 * The controller requests focus after the screenshot is drawn. Windows can
 * refuse programmatic activation, so mouse activation must remain enabled too.
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
      // `backgroundThrottling: false` deliberately absent. Electron implements
      // it by setting Chromium's `disable_hidden_`, so the widget never makes
      // the hidden→shown transition this window makes on every frame, and
      // nothing on the capture path is throttled anyway: opening a stream and
      // encoding a canvas are promises, not timers. It bought nothing and is
      // the prime suspect for a frame that draws but does not take clicks.
    }
  }
}

export interface CreateGameOcrWindowOptions {
  preloadPath: string
  displayBounds: OcrDisplayBounds
  devUrl?: string
  packagedHtmlPath: string
  createWindow: (options: BrowserWindowConstructorOptions) => BrowserWindow
  ipcMain: GameOcrIpcMain
  displayEvents: GameOcrDisplayEvents
}

/** Builds the Windows-only frozen-frame window; the bootstrap never calls it elsewhere. */
export function createGameOcrWindow(options: CreateGameOcrWindowOptions): GameOcrWindow {
  const window = options.createWindow(
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

  if (options.devUrl) {
    void window.loadURL(`${options.devUrl.replace(/\/$/, '')}/gameOcr.html`)
  } else {
    void window.loadFile(options.packagedHtmlPath)
  }

  const controller = createGameOcrWindowController({
    window,
    displayBounds: options.displayBounds
  })
  controller.onClosed(registerGameOcrIpc(options.ipcMain, window, controller))
  const { displayEvents } = options
  const closeForDisplayChange = (): void => {
    void controller.close()
  }
  displayEvents.on('display-metrics-changed', closeForDisplayChange)
  displayEvents.on('display-removed', closeForDisplayChange)
  controller.onClosed(() => {
    displayEvents.removeListener('display-metrics-changed', closeForDisplayChange)
    displayEvents.removeListener('display-removed', closeForDisplayChange)
  })
  return controller
}
