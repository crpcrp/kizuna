import { describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import {
  createGameOcrWindow,
  getGameOcrWindowOptions
} from '@src/main/services/gameOcr/frozenFrameElectron'
import { GAME_OCR_CHANNELS } from '@src/shared/ipcChannels'
import { fakeNativeWindow } from '@test/harness/fakeFrozenFrame'

describe('getGameOcrWindowOptions', () => {
  it('creates an opaque, focusable, always-on-top full-display window', () => {
    const options = getGameOcrWindowOptions('/fake/preload.js', {
      x: -1920,
      y: 40,
      width: 1920,
      height: 1080
    })

    expect(options).toMatchObject({
      x: -1920,
      y: 40,
      width: 1920,
      height: 1080,
      frame: false,
      transparent: false,
      backgroundColor: '#000000',
      show: false,
      skipTaskbar: true,
      // Foreground input must belong to the overlay while inspecting text.
      focusable: true,
      alwaysOnTop: true,
      resizable: false,
      fullscreenable: false
    })
    expect(options.webPreferences).toMatchObject({
      preload: '/fake/preload.js',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    })
  })
})

function setup() {
  const fake = fakeNativeWindow()
  const ipcListeners = new Map<string, (event: { sender: unknown }, value?: unknown) => void>()
  const ipcMain = {
    on: vi.fn((channel: string, listener: (event: { sender: unknown }) => void) => {
      ipcListeners.set(channel, listener)
    }),
    removeListener: vi.fn()
  }
  const displayListeners = new Map<string, () => void>()
  const displayEvents = {
    on: vi.fn((event: string, listener: () => void) => displayListeners.set(event, listener)),
    removeListener: vi.fn()
  }
  const displayBounds = { x: 0, y: 0, width: 2560, height: 1440 }
  const createWindow = vi.fn(() => fake.window as unknown as BrowserWindow)
  const frame = createGameOcrWindow({
    preloadPath: '/fake/preload.js',
    displayBounds,
    packagedHtmlPath: '/fake/gameOcr.html',
    createWindow,
    ipcMain,
    displayEvents
  })
  return {
    fake,
    frame,
    ipcMain,
    ipcListeners,
    displayEvents,
    displayListeners,
    displayBounds,
    createWindow
  }
}

describe('createGameOcrWindow', () => {
  it('re-asserts the display bounds Windows clamps away at construction', () => {
    const { fake, createWindow, displayBounds } = setup()

    expect(createWindow).toHaveBeenCalledWith(expect.objectContaining(displayBounds))
    // Windows shrinks the *initial* size of a window to the display's work
    // area. Without this second assignment the frozen frame comes up a taskbar
    // short and leaves a live strip of the game showing below the screenshot.
    expect(fake.window.setBounds).toHaveBeenCalledWith(displayBounds)
    expect(fake.window.setContentProtection).toHaveBeenCalledWith(true)
    expect(fake.window.loadFile).toHaveBeenCalledWith('/fake/gameOcr.html')
  })

  it('accepts renderer reports only from its own window', () => {
    const { fake, ipcListeners } = setup()
    fake.fireRenderer('did-finish-load')
    fake.window.show()

    // The renderer's close request hides the frame; another renderer's does not.
    ipcListeners.get(GAME_OCR_CHANNELS.close)!({ sender: { id: 'the player window' } })
    expect(fake.window.hide).not.toHaveBeenCalled()

    ipcListeners.get(GAME_OCR_CHANNELS.close)!({ sender: fake.window.webContents })
    expect(fake.window.hide).toHaveBeenCalledOnce()
  })

  it('closes the frame when the displays change, and then stops listening', async () => {
    const { fake, ipcMain, displayEvents, displayListeners } = setup()

    // The screenshot was taken on a geometry that no longer exists.
    displayListeners.get('display-metrics-changed')!()
    expect(fake.window.close).toHaveBeenCalledOnce()

    fake.fireWindow('closed')
    await Promise.resolve()
    expect(displayEvents.removeListener).toHaveBeenCalledTimes(2)
    for (const [channel, listener] of ipcMain.on.mock.calls) {
      expect(ipcMain.removeListener).toHaveBeenCalledWith(channel, listener)
    }
  })
})
