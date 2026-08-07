import { describe, expect, it, vi } from 'vitest'
import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron'
import {
  createAppWindowSet,
  loadRendererWindow,
  presentAppWindowSet,
  syncInitialWindowBounds
} from '@src/main/windowPair'

type WindowEvent =
  | 'close'
  | 'closed'
  | 'ready-to-show'
  | 'move'
  | 'resize'
  | 'enter-full-screen'
  | 'leave-full-screen'

class FakeWindow {
  readonly listeners = new Map<WindowEvent, Set<() => void>>()
  readonly close = vi.fn(() => {
    this.emit('close')
    this.destroyed = true
    this.emit('closed')
  })
  readonly minimize = vi.fn(() => {
    this.minimized = true
  })
  readonly restore = vi.fn(() => {
    this.minimized = false
  })
  readonly show = vi.fn()
  readonly focus = vi.fn()
  readonly setFullScreen = vi.fn((value: boolean) => {
    this.fullscreen = value
    this.emit(value ? 'enter-full-screen' : 'leave-full-screen')
  })
  readonly setAlwaysOnTop = vi.fn()
  readonly setBounds = vi.fn((bounds: { x: number; y: number; width: number; height: number }) => {
    this.bounds = { ...bounds }
    this.emit('move')
    this.emit('resize')
  })
  readonly setContentBounds = vi.fn(
    (bounds: { x: number; y: number; width: number; height: number }) => {
      this.contentBounds = bounds
      this.bounds = { ...bounds }
    }
  )
  readonly webContents = {
    on: vi.fn(),
    once: vi.fn()
  }
  destroyed = false
  minimized = false
  fullscreen = false
  bounds = { x: 30, y: 40, width: 1280, height: 720 }
  contentBounds = { x: 30, y: 40, width: 1280, height: 720 }

  constructor(readonly options: BrowserWindowConstructorOptions) {}

  on(event: WindowEvent, listener: () => void): void {
    const listeners = this.listeners.get(event) ?? new Set<() => void>()
    listeners.add(listener)
    this.listeners.set(event, listeners)
  }

  once(event: WindowEvent, listener: () => void): void {
    const onceListener = (): void => {
      this.listeners.get(event)?.delete(onceListener)
      listener()
    }
    this.on(event, onceListener)
  }

  emit(event: WindowEvent): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) listener()
  }

  isDestroyed(): boolean {
    return this.destroyed
  }

  getContentBounds(): { x: number; y: number; width: number; height: number } {
    return this.contentBounds
  }

  getBounds(): { x: number; y: number; width: number; height: number } {
    return this.bounds
  }

  isMinimized(): boolean {
    return this.minimized
  }

  isFullScreen(): boolean {
    return this.fullscreen
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
  it('keeps Windows operations on its single BrowserWindow', () => {
    const factory = makeWindowFactory()
    const windows = createAppWindowSet({
      platform: 'win32',
      preloadPath: 'preload.js',
      createWindow: factory.createWindow
    })
    const window = factory.created[0]

    windows.coordinator.setBounds({ x: 50, y: 60, width: 900, height: 700 })
    windows.coordinator.minimize()
    windows.coordinator.focus()
    windows.coordinator.setFullScreen(true)
    windows.coordinator.setAlwaysOnTop(true)

    expect(window.setBounds).toHaveBeenCalledTimes(1)
    expect(window.minimize).toHaveBeenCalledTimes(1)
    expect(window.focus).toHaveBeenCalledTimes(1)
    expect(window.setFullScreen).toHaveBeenCalledTimes(1)
    expect(window.setAlwaysOnTop).toHaveBeenCalledTimes(1)
  })

  it('applies one explicit bounds request to both Linux windows', () => {
    const factory = makeWindowFactory()
    const windows = createAppWindowSet({
      platform: 'linux',
      preloadPath: 'preload.js',
      createWindow: factory.createWindow
    })
    const [host, overlay] = factory.created
    const bounds = { x: 100, y: 120, width: 1024, height: 768 }

    windows.coordinator.setBounds(bounds)

    expect(host.setBounds).toHaveBeenCalledWith(bounds)
    expect(overlay.setBounds).toHaveBeenCalledWith(bounds)
    expect(host.bounds).toEqual(bounds)
    expect(overlay.bounds).toEqual(bounds)
  })

  it('coalesces move and resize events and ends at the latest host bounds', () => {
    const callbacks: Array<() => void> = []
    const factory = makeWindowFactory()
    createAppWindowSet({
      platform: 'linux',
      preloadPath: 'preload.js',
      createWindow: factory.createWindow,
      setTimeoutFn: (callback) => {
        callbacks.push(callback)
        return callback
      },
      clearTimeoutFn: vi.fn()
    })
    const [host, overlay] = factory.created
    host.bounds = { x: 200, y: 210, width: 1100, height: 700 }

    host.emit('move')
    host.emit('resize')
    host.emit('resize')

    expect(callbacks).toHaveLength(1)
    callbacks[0]()

    expect(overlay.bounds).toEqual(host.bounds)
    expect(overlay.setBounds).toHaveBeenCalledTimes(1)
    // The overlay fake emits move/resize synchronously from setBounds. The
    // coordinator's programmatic-sync guard prevents a second queued pass.
    expect(callbacks).toHaveLength(1)
  })

  it('resolves renderer IPC to the pair and tolerates either side being destroyed', () => {
    const factory = makeWindowFactory()
    const windows = createAppWindowSet({
      platform: 'linux',
      preloadPath: 'preload.js',
      createWindow: factory.createWindow
    })
    const [host, overlay] = factory.created

    expect(windows.controlsFor(overlay as unknown as BrowserWindow)).toBe(windows.coordinator)
    expect(windows.controlsFor(null)).toBeNull()

    host.destroyed = true
    expect(() => windows.coordinator.setBounds({ x: 1, y: 2, width: 3, height: 4 })).not.toThrow()
    overlay.destroyed = true
    expect(() => windows.coordinator.setBounds({ x: 5, y: 6, width: 7, height: 8 })).not.toThrow()
  })

  it('minimizes, restores, and focuses the pair as one app', () => {
    const factory = makeWindowFactory()
    const windows = createAppWindowSet({
      platform: 'linux',
      preloadPath: 'preload.js',
      createWindow: factory.createWindow
    })
    const [host, overlay] = factory.created

    windows.coordinator.minimize()
    windows.activate()

    expect(host.minimize).toHaveBeenCalledTimes(1)
    expect(overlay.minimize).toHaveBeenCalledTimes(1)
    expect(host.restore).toHaveBeenCalledTimes(1)
    expect(overlay.restore).toHaveBeenCalledTimes(1)
    expect(host.focus).toHaveBeenCalledTimes(1)
    expect(overlay.focus).toHaveBeenCalledTimes(1)
  })

  it('coordinates fullscreen on the host and restores the paired rectangle once', () => {
    const factory = makeWindowFactory()
    const windows = createAppWindowSet({
      platform: 'linux',
      preloadPath: 'preload.js',
      createWindow: factory.createWindow
    })
    const [host, overlay] = factory.created
    const original = { x: 30, y: 40, width: 1280, height: 720 }
    const changes: boolean[] = []
    windows.onFullscreenChanged((fullscreen) => changes.push(fullscreen))

    windows.coordinator.setFullScreen(true)
    host.bounds = { x: 0, y: 0, width: 1920, height: 1080 }
    overlay.bounds = { ...host.bounds }
    host.setBounds.mockClear()
    overlay.setBounds.mockClear()
    windows.coordinator.setFullScreen(false)
    host.emit('leave-full-screen')

    expect(host.setFullScreen).toHaveBeenCalledTimes(2)
    expect(overlay.setFullScreen).not.toHaveBeenCalled()
    expect(changes).toEqual([true, false])
    expect(host.bounds).toEqual(original)
    expect(overlay.bounds).toEqual(original)
    expect(host.setBounds).toHaveBeenCalledTimes(1)
    expect(overlay.setBounds).toHaveBeenCalledTimes(1)
  })

  it('keeps the original bounds across a rapid fullscreen exit and re-entry', () => {
    const factory = makeWindowFactory()
    const windows = createAppWindowSet({
      platform: 'linux',
      preloadPath: 'preload.js',
      createWindow: factory.createWindow
    })
    const [host, overlay] = factory.created
    const original = { ...host.bounds }
    host.setFullScreen.mockImplementation((value: boolean) => {
      host.fullscreen = value
    })

    windows.coordinator.setFullScreen(true)
    host.bounds = { x: 0, y: 0, width: 1920, height: 1080 }
    windows.coordinator.setFullScreen(false)
    windows.coordinator.setFullScreen(true)

    host.fullscreen = false
    host.emit('leave-full-screen')
    expect(host.bounds).toEqual({ x: 0, y: 0, width: 1920, height: 1080 })
    expect(overlay.bounds).toEqual({ x: 30, y: 40, width: 1280, height: 720 })

    host.fullscreen = false
    host.emit('leave-full-screen')
    expect(host.bounds).toEqual(original)
    expect(overlay.bounds).toEqual(original)
  })

  it('raises both sides for mini-player and never leaves only one side elevated', () => {
    const factory = makeWindowFactory()
    const windows = createAppWindowSet({
      platform: 'linux',
      preloadPath: 'preload.js',
      createWindow: factory.createWindow
    })
    const [host, overlay] = factory.created
    const bounds = { x: 1400, y: 700, width: 520, height: 362 }

    windows.coordinator.setBounds(bounds)
    windows.coordinator.setAlwaysOnTop(true)

    expect(host.bounds).toEqual(bounds)
    expect(overlay.bounds).toEqual(bounds)
    expect(host.setAlwaysOnTop).toHaveBeenCalledWith(true)
    expect(overlay.setAlwaysOnTop).toHaveBeenCalledWith(true)
  })

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

  it('closes the overlay when the host closes first', () => {
    const factory = makeWindowFactory()
    void createAppWindowSet({
      platform: 'linux',
      preloadPath: 'preload.js',
      createWindow: factory.createWindow
    })
    const [host, overlay] = factory.created

    host.close()

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
