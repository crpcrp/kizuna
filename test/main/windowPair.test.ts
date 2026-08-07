import { describe, expect, it, vi } from 'vitest'
import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron'
import {
  createAppWindowSet,
  loadRendererWindow,
  presentAppWindowSet,
  syncInitialWindowBounds
} from '@src/main/windowPair'

type WindowEvent = 'close' | 'closed' | 'ready-to-show'

class FakeWindow {
  readonly listeners = new Map<WindowEvent, () => void>()
  readonly close = vi.fn(() => {
    this.emit('close')
    this.destroyed = true
    this.emit('closed')
  })
  readonly show = vi.fn()
  readonly focus = vi.fn()
  readonly setContentBounds = vi.fn(
    (bounds: { x: number; y: number; width: number; height: number }) => {
      this.contentBounds = bounds
    }
  )
  readonly webContents = {
    on: vi.fn(),
    once: vi.fn()
  }
  destroyed = false
  contentBounds = { x: 30, y: 40, width: 1280, height: 720 }

  constructor(readonly options: BrowserWindowConstructorOptions) {}

  on(event: WindowEvent, listener: () => void): void {
    this.listeners.set(event, listener)
  }

  once(event: WindowEvent, listener: () => void): void {
    this.on(event, listener)
  }

  emit(event: WindowEvent): void {
    this.listeners.get(event)?.()
  }

  isDestroyed(): boolean {
    return this.destroyed
  }

  getContentBounds(): { x: number; y: number; width: number; height: number } {
    return this.contentBounds
  }
}

function makeWindowFactory(): {
  created: FakeWindow[]
  createWindow: (options: BrowserWindowConstructorOptions) => BrowserWindow
} {
  const created: FakeWindow[] = []
  return {
    created,
    createWindow: (options) => {
      const window = new FakeWindow(options)
      created.push(window)
      return window as unknown as BrowserWindow
    }
  }
}

describe('createAppWindowSet', () => {
  it('keeps Windows as one transparent renderer/mpv window', () => {
    const factory = makeWindowFactory()

    const windows = createAppWindowSet({
      platform: 'win32',
      preloadPath: 'preload.js',
      createWindow: factory.createWindow
    })

    expect(factory.created).toHaveLength(1)
    expect(windows.videoHost).toBe(windows.uiOverlay)
    expect(windows.paired).toBe(false)
    expect(factory.created[0].options).toMatchObject({
      frame: false,
      transparent: true,
      backgroundColor: '#00000000'
    })
    expect(factory.created[0].options.webPreferences?.preload).toBe('preload.js')

    windows.close()
    expect(factory.created[0].close).toHaveBeenCalledTimes(1)
  })

  it('creates a Linux opaque host and transparent child overlay with identical initial bounds', () => {
    const factory = makeWindowFactory()

    const windows = createAppWindowSet({
      platform: 'linux',
      preloadPath: 'preload.js',
      createWindow: factory.createWindow
    })
    const [host, overlay] = factory.created

    expect(factory.created).toHaveLength(2)
    expect(windows.videoHost).not.toBe(windows.uiOverlay)
    expect(windows.paired).toBe(true)
    expect(host.options).toMatchObject({
      frame: false,
      transparent: false,
      backgroundColor: '#000000',
      show: false
    })
    expect(host.options.webPreferences?.preload).toBeUndefined()
    expect(overlay.options).toMatchObject({
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      show: false,
      parent: host,
      skipTaskbar: true
    })
    expect(overlay.options.webPreferences?.preload).toBe('preload.js')
    expect(overlay.setContentBounds).toHaveBeenCalledWith(host.contentBounds)
  })
})

describe('Linux window pair presentation and shutdown', () => {
  it('presents the overlay before the host and does not require global always-on-top', () => {
    const factory = makeWindowFactory()
    const windows = createAppWindowSet({
      platform: 'linux',
      preloadPath: 'preload.js',
      createWindow: factory.createWindow
    })
    const order: string[] = []
    const overlay = factory.created[1]
    const host = factory.created[0]
    overlay.show.mockImplementation(() => order.push('overlay-show'))
    host.show.mockImplementation(() => order.push('host-show'))
    overlay.focus.mockImplementation(() => order.push('overlay-focus'))
    presentAppWindowSet(windows)
    expect(order).toEqual([])

    overlay.emit('ready-to-show')

    expect(order).toEqual(['overlay-show', 'host-show', 'overlay-focus'])
  })

  it('closes the other window exactly once when either side closes', () => {
    const factory = makeWindowFactory()
    void createAppWindowSet({
      platform: 'linux',
      preloadPath: 'preload.js',
      createWindow: factory.createWindow
    })
    const [host, overlay] = factory.created

    overlay.close()

    expect(host.close).toHaveBeenCalledTimes(1)
    expect(overlay.close).toHaveBeenCalledTimes(1)
  })

  it('closes both windows through the bounded pair close operation', () => {
    const factory = makeWindowFactory()
    const windows = createAppWindowSet({
      platform: 'linux',
      preloadPath: 'preload.js',
      createWindow: factory.createWindow
    })
    const [host, overlay] = factory.created

    windows.close()

    expect(host.close).toHaveBeenCalledTimes(1)
    expect(overlay.close).toHaveBeenCalledTimes(1)
  })

  it('closes an orphaned overlay when the host is destroyed unexpectedly', () => {
    const factory = makeWindowFactory()
    void createAppWindowSet({
      platform: 'linux',
      preloadPath: 'preload.js',
      createWindow: factory.createWindow
    })
    const [host, overlay] = factory.created

    host.destroyed = true
    host.emit('closed')

    expect(overlay.close).toHaveBeenCalledTimes(1)
  })

  it('copies content bounds directly between windows', () => {
    const host = {
      getContentBounds: vi.fn(() => ({ x: 1, y: 2, width: 3, height: 4 })),
      setContentBounds: vi.fn()
    }
    const overlay = { setContentBounds: vi.fn(), getContentBounds: vi.fn() }

    syncInitialWindowBounds(host, overlay)

    expect(host.getContentBounds).toHaveBeenCalledTimes(1)
    expect(overlay.setContentBounds).toHaveBeenCalledWith({ x: 1, y: 2, width: 3, height: 4 })
  })
})

describe('loadRendererWindow', () => {
  it('loads the renderer only into the overlay target', () => {
    const overlayLoadURL = vi.fn()
    const overlayLoadFile = vi.fn()
    const overlay = {
      webContents: { on: vi.fn() },
      loadURL: overlayLoadURL,
      loadFile: overlayLoadFile
    }

    loadRendererWindow(overlay, {
      devUrl: 'http://localhost:5173',
      packagedHtmlPath: 'index.html'
    })

    expect(overlayLoadURL).toHaveBeenCalledWith('http://localhost:5173')
    expect(overlayLoadFile).not.toHaveBeenCalled()
  })

  it('uses the packaged renderer path when no dev URL is present', () => {
    const overlayLoadFile = vi.fn()
    const overlay = {
      webContents: { on: vi.fn() },
      loadURL: vi.fn(),
      loadFile: overlayLoadFile
    }

    loadRendererWindow(overlay, { packagedHtmlPath: '/app/renderer/index.html' })

    expect(overlayLoadFile).toHaveBeenCalledWith('/app/renderer/index.html')
  })
})
