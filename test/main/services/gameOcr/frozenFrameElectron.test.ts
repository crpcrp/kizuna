import { describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import {
  createGameOcrWindow,
  getGameOcrWindowOptions
} from '@src/main/services/gameOcr/frozenFrameElectron'
import { fakeNativeWindow } from '@test/harness/fakeFrozenFrame'

describe('getGameOcrWindowOptions', () => {
  it('creates an opaque, never-focused, always-on-top full-display window', () => {
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
      // Never focusable: Windows refuses a cross-process foreground steal, and a
      // window it has not activated spends the user's first press on activation
      // instead of delivering it to the page.
      focusable: false,
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

describe('createGameOcrWindow', () => {
  it('re-asserts the display bounds Windows clamps away at construction', () => {
    const fake = fakeNativeWindow()
    const displayBounds = { x: 0, y: 0, width: 2560, height: 1440 }
    const createWindow = vi.fn(() => fake.window as unknown as BrowserWindow)

    createGameOcrWindow({
      platform: 'win32',
      preloadPath: '/fake/preload.js',
      displayBounds,
      packagedHtmlPath: '/fake/gameOcr.html',
      createWindow
    })

    expect(createWindow).toHaveBeenCalledWith(expect.objectContaining(displayBounds))
    // Windows shrinks the *initial* size of a window to the display's work
    // area. Without this second assignment the frozen frame comes up a taskbar
    // short and leaves a live strip of the game showing below the screenshot.
    expect(fake.window.setBounds).toHaveBeenCalledWith(displayBounds)
    expect(fake.window.setContentProtection).toHaveBeenCalledWith(true)
    expect(fake.window.loadFile).toHaveBeenCalledWith('/fake/gameOcr.html', {})
  })

  it('asks the renderer to trace its input only when tracing is on', () => {
    const off = fakeNativeWindow()
    createGameOcrWindow({
      platform: 'win32',
      preloadPath: '/fake/preload.js',
      displayBounds: { x: 0, y: 0, width: 800, height: 600 },
      packagedHtmlPath: '/fake/gameOcr.html',
      createWindow: () => off.window as unknown as BrowserWindow
    })
    expect(off.window.loadFile).toHaveBeenCalledWith('/fake/gameOcr.html', {})
    expect(off.window.webContents.openDevTools).not.toHaveBeenCalled()

    const on = fakeNativeWindow()
    createGameOcrWindow({
      platform: 'win32',
      preloadPath: '/fake/preload.js',
      displayBounds: { x: 0, y: 0, width: 800, height: 600 },
      packagedHtmlPath: '/fake/gameOcr.html',
      createWindow: () => on.window as unknown as BrowserWindow,
      traceInput: true
    })
    // Detached, because the frame covers the display it would otherwise share.
    expect(on.window.loadFile).toHaveBeenCalledWith('/fake/gameOcr.html', {
      query: { trace: 'input' }
    })
    expect(on.window.webContents.openDevTools).toHaveBeenCalledWith({ mode: 'detach' })
  })

  it('closes the frame when the displays change, and then stops listening', async () => {
    const fake = fakeNativeWindow()
    const listeners = new Map<string, () => void>()
    const displayEvents = {
      on: vi.fn((event: string, listener: () => void) => listeners.set(event, listener)),
      removeListener: vi.fn()
    }

    createGameOcrWindow({
      platform: 'win32',
      preloadPath: '/fake/preload.js',
      displayBounds: { x: 0, y: 0, width: 800, height: 600 },
      packagedHtmlPath: '/fake/gameOcr.html',
      createWindow: () => fake.window as unknown as BrowserWindow,
      displayEvents
    })

    // The screenshot was taken on a geometry that no longer exists.
    listeners.get('display-metrics-changed')!()
    expect(fake.window.close).toHaveBeenCalledOnce()

    fake.fireWindow('closed')
    await Promise.resolve()
    expect(displayEvents.removeListener).toHaveBeenCalledTimes(2)
  })

  it('answers with an inert window on platforms without frozen-frame support', async () => {
    const createWindow = vi.fn()
    const window = createGameOcrWindow({
      platform: 'linux',
      preloadPath: '/fake/preload.js',
      displayBounds: { x: 0, y: 0, width: 800, height: 600 },
      packagedHtmlPath: '/fake/gameOcr.html',
      createWindow
    })

    expect(createWindow).not.toHaveBeenCalled()
    expect(window.isVisible()).toBe(false)
    await expect(
      window.freeze({
        sessionId: 1,
        captureId: 1,
        sourceId: 'screen:0:0',
        targetKind: 'display',
        imageSize: { width: 800, height: 600 }
      })
    ).rejects.toThrow('only supported on Windows')
  })
})
