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

export interface GameOcrConstructedWindow extends GameOcrNativeWindow {
  setContentProtection(enable: boolean): void
  loadURL(url: string): Promise<unknown> | unknown
  loadFile(path: string): Promise<unknown> | unknown
  webContents: GameOcrNativeWindow['webContents'] & NavigationGuardTarget & InputGuardTarget
}

export interface GameOcrDisplayEvents {
  on(event: 'display-metrics-changed' | 'display-removed', listener: () => void): unknown
  removeListener(
    event: 'display-metrics-changed' | 'display-removed',
    listener: () => void
  ): unknown
}

// Foreground games may poll clicks despite page handlers. Keep mouse activation enabled
// because Windows can refuse the controller's programmatic focus request.
function getGameOcrWindowOptions(
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
      // Keep background throttling enabled: disabling it suppresses Chromium's hidden-to-shown
      // transition and may leave a drawn frame unable to take clicks.
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

export function createGameOcrWindow(options: CreateGameOcrWindowOptions): GameOcrWindow {
  const window = options.createWindow(
    getGameOcrWindowOptions(options.preloadPath, options.displayBounds)
  ) as unknown as GameOcrConstructedWindow
  // Windows clamps initial bounds to the work area; reapply while hidden to cover the taskbar strip.
  window.setBounds({ ...options.displayBounds })
  // WDA_EXCLUDEFROMCAPTURE keeps the old overlay out of recaptured desktop frames.
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
