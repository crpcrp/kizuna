import { describe, expect, it, vi } from 'vitest'
import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron'
import {
  createAppWindowSet,
  loadRendererWindow,
  preparePlayerAppWindowSet,
  presentAppWindowSet,
  presentOverlayAppWindowSet,
  showOverlayAppWindowSet,
  type WindowCloseEvent
} from '@src/main/windowPair'
import { createSurfacePresentation } from '@src/main/surfacePresentation'

type WindowEvent =
  | 'close'
  | 'closed'
  | 'ready-to-show'
  | 'did-finish-load'
  | 'move'
  | 'resize'
  | 'enter-full-screen'
  | 'leave-full-screen'

class FakeWindow {
  readonly listeners = new Map<WindowEvent, Set<(event?: WindowCloseEvent) => void>>()
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
  readonly hide = vi.fn()
  readonly show = vi.fn()
  readonly moveTop = vi.fn()
  readonly moveAbove = vi.fn()
  readonly getMediaSourceId = vi.fn(() => 'window:fake:0')
  readonly focus = vi.fn()
  readonly setFullScreen = vi.fn((value: boolean) => {
    this.fullscreen = value
    this.emit(value ? 'enter-full-screen' : 'leave-full-screen')
  })
  readonly setAlwaysOnTop = vi.fn()
  readonly setShape = vi.fn()
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
  readonly webContentsListeners = new Set<() => void>()
  readonly webContents = {
    on: vi.fn((_event: 'did-finish-load', listener: () => void) => {
      this.webContentsListeners.add(listener)
    }),
    once: vi.fn((_event: 'did-finish-load', listener: () => void) => {
      const onceListener = (): void => {
        this.webContentsListeners.delete(onceListener)
        listener()
      }
      this.webContentsListeners.add(onceListener)
    })
  }
  destroyed = false
  minimized = false
  fullscreen = false
  bounds = { x: 30, y: 40, width: 1280, height: 720 }
  contentBounds = { x: 30, y: 40, width: 1280, height: 720 }

  constructor(readonly options: BrowserWindowConstructorOptions) {}

  on(event: WindowEvent, listener: (event?: WindowCloseEvent) => void): void {
    const listeners = this.listeners.get(event) ?? new Set<(event?: WindowCloseEvent) => void>()
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

  emit(event: WindowEvent, value?: WindowCloseEvent): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) listener(value)
  }

  emitDidFinishLoad(): void {
    for (const listener of [...this.webContentsListeners]) listener()
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

function windowSet(platform: 'linux' | 'win32') {
  const factory = makeWindowFactory()
  const windows = createAppWindowSet({
    platform,
    preloadPath: 'preload.js',
    createWindow: factory.createWindow
  })
  return { factory, windows }
}

describe('createAppWindowSet', () => {
  it('keeps Windows as one transparent renderer/mpv window', () => {
    const { factory, windows } = windowSet('win32')

    expect(factory.created).toHaveLength(1)
    expect(windows.videoHost).toBe(windows.uiOverlay)
    expect(factory.created[0].options).toMatchObject({
      frame: false,
      transparent: true,
      backgroundColor: '#00000000'
    })
    expect(factory.created[0].options.webPreferences).toMatchObject({
      preload: 'preload.js',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    })

    windows.close()
    expect(factory.created[0].close).toHaveBeenCalledTimes(1)
  })

  it('creates a Linux opaque host and transparent child overlay with identical initial bounds', () => {
    const { factory, windows } = windowSet('linux')
    const [host, overlay] = factory.created

    expect(factory.created).toHaveLength(2)
    expect(windows.videoHost).not.toBe(windows.uiOverlay)
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
  it('maps only the video host when preparing the player', () => {
    const { factory, windows } = windowSet('linux')
    const [host, overlay] = factory.created

    preparePlayerAppWindowSet(windows)

    expect(host.show).toHaveBeenCalledOnce()
    expect(overlay.show).not.toHaveBeenCalled()
  })

  it('presents only the Linux renderer overlay for splash', () => {
    const callbacks: Array<() => void> = []
    const { factory, windows } = windowSet('linux')
    const [host, overlay] = factory.created

    presentOverlayAppWindowSet(
      windows,
      (callback) => callbacks.push(callback),
      vi.fn(() => undefined),
      vi.fn()
    )
    expect(host.show).not.toHaveBeenCalled()
    expect(overlay.show).not.toHaveBeenCalled()

    callbacks[0]()

    expect(host.show).not.toHaveBeenCalled()
    expect(overlay.show).toHaveBeenCalledOnce()
    expect(overlay.focus).toHaveBeenCalledOnce()
  })

  it('hides the Linux video host when showing a non-player surface', () => {
    const { factory, windows } = windowSet('linux')
    const [host, overlay] = factory.created

    showOverlayAppWindowSet(windows)

    expect(host.hide).toHaveBeenCalledOnce()
    expect(overlay.show).toHaveBeenCalledOnce()
    expect(overlay.focus).toHaveBeenCalledOnce()
  })

  it('keeps the hidden host at player bounds while compacting the splash overlay', async () => {
    const { factory, windows } = windowSet('linux')
    const [host, overlay] = factory.created
    const original = { ...host.bounds }
    const presentation = createSurfacePresentation(windows, {
      getDisplayMatching: vi.fn(() => ({
        workArea: { x: -1920, y: 40, width: 1920, height: 1040 }
      }))
    })

    await presentation.presentSplash(vi.fn())

    expect(host.bounds).toEqual(original)
    expect(overlay.bounds).toEqual({ x: -1280, y: 380, width: 640, height: 360 })

    presentation.restorePlayerBounds()
    expect(host.bounds).toEqual(original)
    expect(overlay.bounds).toEqual(original)

    const movedPlayer = { x: 300, y: 260, width: 1100, height: 700 }
    windows.coordinator.setBounds(movedPlayer)
    await presentation.presentSplash(vi.fn())
    presentation.restorePlayerBounds()
    expect(host.bounds).toEqual(movedPlayer)
    expect(overlay.bounds).toEqual(movedPlayer)
  })

  it('restores normal bounds before showing standalone Options', async () => {
    const { factory, windows } = windowSet('linux')
    const [host, overlay] = factory.created
    const original = { ...host.bounds }
    const order: string[] = []
    overlay.setBounds.mockImplementation((bounds) => {
      order.push('set-bounds')
      overlay.bounds = { ...bounds }
    })
    overlay.show.mockImplementation(() => order.push('show'))
    overlay.focus.mockImplementation(() => order.push('focus'))
    const presentation = createSurfacePresentation(windows, {
      getDisplayMatching: vi.fn(() => ({
        workArea: { x: -1920, y: 40, width: 1920, height: 1040 }
      }))
    })

    await presentation.presentSplash(vi.fn())
    order.length = 0
    await presentation.presentOptions(() => showOverlayAppWindowSet(windows))

    expect(host.bounds).toEqual(original)
    expect(overlay.bounds).toEqual(original)
    expect(host.hide).toHaveBeenCalledOnce()
    expect(order).toEqual(['set-bounds', 'show', 'focus'])
  })

  it('uses centered normal fallback bounds for first-launch Options', async () => {
    const { factory, windows } = windowSet('win32')
    const window = factory.created[0]
    const presentation = createSurfacePresentation(windows, {
      getDisplayMatching: vi.fn(() => ({
        workArea: { x: -1920, y: 40, width: 1920, height: 1040 }
      }))
    })

    await presentation.presentOptions(vi.fn())

    expect(window.bounds).toEqual({ x: -1600, y: 200, width: 1280, height: 720 })
  })

  it('leaves fullscreen before applying first-launch Options bounds', async () => {
    const { factory, windows } = windowSet('win32')
    const window = factory.created[0]
    windows.coordinator.setFullScreen(true)
    const presentation = createSurfacePresentation(windows, {
      getDisplayMatching: vi.fn(() => ({
        workArea: { x: 0, y: 0, width: 1920, height: 1080 }
      }))
    })

    await presentation.presentOptions(vi.fn())

    expect(window.fullscreen).toBe(false)
    expect(window.bounds).toEqual({ x: 320, y: 180, width: 1280, height: 720 })
  })

  it('leaves fullscreen before applying compact splash bounds', async () => {
    const { factory, windows } = windowSet('win32')
    const window = factory.created[0]
    windows.coordinator.setFullScreen(true)
    const presentation = createSurfacePresentation(windows, {
      getDisplayMatching: vi.fn(() => ({
        workArea: { x: 0, y: 0, width: 1920, height: 1080 }
      }))
    })

    await presentation.presentSplash(vi.fn())

    expect(window.fullscreen).toBe(false)
    expect(window.bounds).toEqual({ x: 640, y: 360, width: 640, height: 360 })
  })

  it('keeps the Windows single-window surface visible', () => {
    const { factory, windows } = windowSet('win32')

    showOverlayAppWindowSet(windows)

    expect(factory.created[0].hide).not.toHaveBeenCalled()
    expect(factory.created[0].show).toHaveBeenCalledOnce()
  })

  it('keeps Windows operations on its single BrowserWindow', () => {
    const { factory, windows } = windowSet('win32')
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
    const { factory, windows } = windowSet('linux')
    const [host, overlay] = factory.created
    const bounds = { x: 100, y: 120, width: 1024, height: 768 }

    windows.coordinator.setBounds(bounds)

    expect(host.setBounds).toHaveBeenCalledWith(bounds)
    expect(overlay.setBounds).toHaveBeenCalledWith(bounds)
    expect(host.bounds).toEqual(bounds)
    expect(overlay.bounds).toEqual(bounds)
  })

  it('shapes only the Linux renderer overlay', () => {
    const { factory, windows } = windowSet('linux')
    const [host, overlay] = factory.created
    const rects = [{ x: 0, y: 0, width: 1280, height: 64 }]

    windows.coordinator.setShape(rects)

    expect(overlay.setShape).toHaveBeenCalledWith(rects)
    expect(host.setShape).not.toHaveBeenCalled()
  })

  it('does not shape the proven single-window Windows composition', () => {
    const { factory, windows } = windowSet('win32')

    windows.coordinator.setShape([{ x: 0, y: 0, width: 100, height: 100 }])

    expect(factory.created[0].setShape).not.toHaveBeenCalled()
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

  it('moves the host when the interactive overlay is dragged', () => {
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
    overlay.bounds = { x: 240, y: 260, width: 1280, height: 720 }

    overlay.emit('move')
    callbacks[0]()

    expect(host.bounds).toEqual(overlay.bounds)
    expect(host.setBounds).toHaveBeenCalledTimes(1)
    expect(callbacks).toHaveLength(1)
  })

  it('resizes the host when the interactive overlay is edge-resized', () => {
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
    overlay.bounds = { x: 30, y: 40, width: 1040, height: 680 }

    overlay.emit('resize')
    callbacks[0]()

    expect(host.bounds).toEqual(overlay.bounds)
    expect(host.setBounds).toHaveBeenCalledTimes(1)
    expect(callbacks).toHaveLength(1)
  })

  it('ignores a delayed host event from the previous overlay synchronization', () => {
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
    overlay.bounds = { x: 100, y: 120, width: 1280, height: 720 }
    overlay.emit('move')
    callbacks[0]()

    overlay.bounds = { x: 300, y: 320, width: 1280, height: 720 }
    overlay.emit('move')
    // Electron can deliver the host event caused by the first synchronization
    // after the next user-driven overlay event has already been queued.
    host.emit('move')
    callbacks[1]()

    expect(host.bounds).toEqual(overlay.bounds)
    expect(host.setBounds).toHaveBeenCalledTimes(2)
    expect(callbacks).toHaveLength(2)
  })

  it('resolves renderer IPC to the pair and tolerates either side being destroyed', () => {
    const { factory, windows } = windowSet('linux')
    const [host, overlay] = factory.created

    expect(windows.controlsFor(overlay as unknown as BrowserWindow)).toBe(windows.coordinator)
    expect(windows.controlsFor(null)).toBeNull()

    host.destroyed = true
    expect(() => windows.coordinator.setBounds({ x: 1, y: 2, width: 3, height: 4 })).not.toThrow()
    overlay.destroyed = true
    expect(() => windows.coordinator.setBounds({ x: 5, y: 6, width: 7, height: 8 })).not.toThrow()
  })

  it('minimizes, restores, and focuses the pair as one app', () => {
    const { factory, windows } = windowSet('linux')
    const [host, overlay] = factory.created

    windows.coordinator.minimize()
    windows.activate()

    expect(host.minimize).toHaveBeenCalledTimes(1)
    expect(overlay.minimize).toHaveBeenCalledTimes(1)
    expect(host.restore).toHaveBeenCalledTimes(1)
    expect(overlay.restore).toHaveBeenCalledTimes(1)
    expect(host.show).toHaveBeenCalledTimes(1)
    expect(overlay.show).toHaveBeenCalledTimes(1)
    expect(host.focus).toHaveBeenCalledTimes(1)
    expect(overlay.moveAbove).toHaveBeenCalledWith(host.getMediaSourceId())
    expect(overlay.focus).toHaveBeenCalledTimes(1)
  })

  it('lets a close guard keep an armed app window in the background', () => {
    const factory = makeWindowFactory()
    const guard = vi.fn(() => false)
    createAppWindowSet({
      platform: 'linux',
      preloadPath: 'preload.js',
      createWindow: factory.createWindow,
      closeGuard: guard
    })
    const [videoHost, uiOverlay] = factory.created
    const event = { preventDefault: vi.fn() }

    videoHost.emit('close', event)

    expect(guard).toHaveBeenCalledWith(event)
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(videoHost.close).not.toHaveBeenCalled()
    expect(uiOverlay.close).not.toHaveBeenCalled()
  })

  it('guards renderer close requests but lets app shutdown force the window closed', () => {
    const factory = makeWindowFactory()
    const guard = vi.fn(() => false)
    const windows = createAppWindowSet({
      platform: 'win32',
      preloadPath: 'preload.js',
      createWindow: factory.createWindow,
      closeGuard: guard
    })
    const window = factory.created[0]

    windows.coordinator.close()
    expect(guard).toHaveBeenCalledOnce()
    expect(window.close).not.toHaveBeenCalled()

    windows.close()
    expect(window.close).toHaveBeenCalledOnce()
  })

  it('coordinates fullscreen on the host and restores the paired rectangle once', () => {
    const { factory, windows } = windowSet('linux')
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

  it('keeps the host authoritative for geometry events during fullscreen', () => {
    const callbacks: Array<() => void> = []
    const factory = makeWindowFactory()
    const windows = createAppWindowSet({
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
    windows.coordinator.setFullScreen(true)
    host.bounds = { x: 0, y: 0, width: 1920, height: 1080 }
    overlay.bounds = { x: 30, y: 40, width: 1280, height: 720 }

    overlay.emit('resize')
    callbacks[0]()

    expect(overlay.bounds).toEqual(host.bounds)
  })

  it('keeps the original bounds across a rapid fullscreen exit and re-entry', () => {
    const { factory, windows } = windowSet('linux')
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
    const { factory, windows } = windowSet('linux')
    const [host, overlay] = factory.created
    const bounds = { x: 1400, y: 700, width: 520, height: 362 }

    windows.coordinator.setBounds(bounds)
    windows.coordinator.setAlwaysOnTop(true)

    expect(host.bounds).toEqual(bounds)
    expect(overlay.bounds).toEqual(bounds)
    expect(host.setAlwaysOnTop).toHaveBeenCalledWith(true)
    expect(overlay.setAlwaysOnTop).toHaveBeenCalledWith(true)
  })

  it('raises the host, places the overlay directly above it, and focuses it last', () => {
    const { factory, windows } = windowSet('linux')
    const order: string[] = []
    const overlay = factory.created[1]
    const host = factory.created[0]
    host.show.mockImplementation(() => order.push('host-show'))
    host.moveTop.mockImplementation(() => order.push('host-move-top'))
    overlay.show.mockImplementation(() => order.push('overlay-show'))
    overlay.moveAbove.mockImplementation(() => order.push('overlay-move-above-host'))
    overlay.focus.mockImplementation(() => order.push('overlay-focus'))
    presentAppWindowSet(windows)
    expect(order).toEqual([])

    overlay.emit('ready-to-show')

    expect(order).toEqual([
      'host-show',
      'host-move-top',
      'overlay-show',
      'overlay-move-above-host',
      'overlay-focus'
    ])
    expect(overlay.moveAbove).toHaveBeenCalledWith(host.getMediaSourceId())
  })

  it.each(['ready-to-show', 'did-finish-load', 'timeout'] as const)(
    'presents once when %s wins, ignoring all later readiness triggers',
    (trigger) => {
      const { factory, windows } = windowSet('linux')
      const [host, overlay] = factory.created
      const callbacks: Array<() => void> = []
      const timerHandle = {}
      const clearTimeoutFn = vi.fn()
      presentAppWindowSet(
        windows,
        undefined,
        (callback, delayMs) => {
          expect(delayMs).toBe(2000)
          callbacks.push(callback)
          return timerHandle
        },
        clearTimeoutFn
      )
      expect(callbacks).toHaveLength(1)
      expect(host.show).not.toHaveBeenCalled()
      expect(overlay.show).not.toHaveBeenCalled()

      if (trigger === 'ready-to-show') overlay.emit('ready-to-show')
      else if (trigger === 'did-finish-load') overlay.emitDidFinishLoad()
      else callbacks[0]()

      expect(host.show).toHaveBeenCalledOnce()
      expect(overlay.show).toHaveBeenCalledOnce()
      if (trigger === 'timeout') expect(clearTimeoutFn).not.toHaveBeenCalled()
      else expect(clearTimeoutFn).toHaveBeenCalledExactlyOnceWith(timerHandle)

      overlay.emit('ready-to-show')
      overlay.emitDidFinishLoad()
      callbacks[0]()
      expect(host.show).toHaveBeenCalledOnce()
      expect(overlay.show).toHaveBeenCalledOnce()
      expect(host.moveTop).toHaveBeenCalledOnce()
      expect(overlay.moveAbove).toHaveBeenCalledExactlyOnceWith(host.getMediaSourceId())
      expect(overlay.focus).toHaveBeenCalledOnce()
    }
  )

  it('does not show either window when both are already destroyed', () => {
    const callbacks: Array<() => void> = []
    const { factory, windows } = windowSet('linux')
    const [host, overlay] = factory.created
    host.destroyed = true
    overlay.destroyed = true

    presentAppWindowSet(
      windows,
      undefined,
      (callback) => {
        callbacks.push(callback)
        return callback
      },
      vi.fn()
    )

    overlay.emit('ready-to-show')
    callbacks[0]()

    expect(host.show).not.toHaveBeenCalled()
    expect(overlay.show).not.toHaveBeenCalled()
  })

  it('keeps Windows presentation a no-op without scheduling a timer', () => {
    const { factory, windows } = windowSet('win32')
    const setTimeoutFn = vi.fn((_callback: () => void, _delayMs: number) => undefined)

    presentAppWindowSet(windows, undefined, setTimeoutFn, vi.fn())

    expect(setTimeoutFn).not.toHaveBeenCalled()
    expect(factory.created[0].show).not.toHaveBeenCalled()
  })

  it.each(['host', 'overlay', 'pair'] as const)(
    'closes both windows exactly once through %s',
    (initiator) => {
      const { factory, windows } = windowSet('linux')
      const [host, overlay] = factory.created
      const target = { host, overlay, pair: windows }[initiator]
      target.close()
      expect(host.close).toHaveBeenCalledOnce()
      expect(overlay.close).toHaveBeenCalledOnce()
    }
  )

  it('closes an orphaned overlay when the host is destroyed unexpectedly', () => {
    const { factory } = windowSet('linux')
    const [host, overlay] = factory.created

    host.destroyed = true
    host.emit('closed')

    expect(overlay.close).toHaveBeenCalledTimes(1)
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
