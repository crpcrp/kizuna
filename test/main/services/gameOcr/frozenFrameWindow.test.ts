import { describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import {
  createGameOcrWindow,
  createGameOcrWindowController,
  getGameOcrWindowOptions,
  registerGameOcrIpc,
  type GameOcrNativeWindow
} from '@src/main/services/gameOcr/frozenFrameWindow'
import { GAME_OCR_CHANNELS } from '@src/shared/ipcChannels'
import type { GameOcrPresentation } from '@src/shared/gameOcr'

type Listener = (...args: unknown[]) => void

function fakeWindow(): {
  window: GameOcrNativeWindow
  fireWindow(event: 'closed' | 'hide'): void
  fireRenderer(
    event: 'did-finish-load' | 'render-process-gone' | 'did-fail-load',
    ...args: unknown[]
  ): void
} {
  const windowListeners = new Map<string, Listener[]>()
  const rendererListeners = new Map<string, Listener[]>()
  let visible = false
  let destroyed = false
  const on = (listeners: Map<string, Listener[]>, event: string, listener: Listener): void => {
    const existing = listeners.get(event) ?? []
    existing.push(listener)
    listeners.set(event, existing)
  }
  const fire = (listeners: Map<string, Listener[]>, event: string, ...args: unknown[]): void => {
    for (const listener of listeners.get(event) ?? []) listener(...args)
  }

  const window = {
    isDestroyed: () => destroyed,
    isVisible: () => visible,
    show: vi.fn(() => {
      visible = true
    }),
    hide: vi.fn(),
    focus: vi.fn(),
    close: vi.fn(),
    setBounds: vi.fn(),
    loadURL: vi.fn(async () => undefined),
    loadFile: vi.fn(async () => undefined),
    on: vi.fn((event: 'closed' | 'hide', listener: () => void) =>
      on(windowListeners, event, listener)
    ),
    webContents: {
      isDestroyed: () => destroyed,
      send: vi.fn(),
      on: vi.fn((event: string, listener: Listener) => on(rendererListeners, event, listener)),
      getURL: () => 'file:///gameOcr.html',
      setWindowOpenHandler: vi.fn(),
      fire: (
        event: 'did-finish-load' | 'render-process-gone' | 'did-fail-load',
        ...args: unknown[]
      ) => fire(rendererListeners, event, ...args)
    }
  } as unknown as GameOcrNativeWindow

  return {
    window,
    fireWindow: (event) => {
      visible = false
      if (event === 'closed') destroyed = true
      fire(windowListeners, event)
    },
    fireRenderer: (event, ...args) => fire(rendererListeners, event, ...args)
  }
}

function windowListenerCount(window: GameOcrNativeWindow, event: 'closed' | 'hide'): number {
  const on = window.on as unknown as ReturnType<typeof vi.fn>
  return on.mock.calls.filter((call) => call[0] === event).length
}

const presentation: GameOcrPresentation = {
  imageBase64: 'iVBORw0KGgo=',
  imageSize: { width: 1920, height: 1080 },
  recognizing: true
}

describe('getGameOcrWindowOptions', () => {
  it('creates an opaque, interactive, always-on-top full-display window', () => {
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

describe('createGameOcrWindow', () => {
  it('re-asserts the display bounds Windows clamps away at construction', () => {
    const fake = fakeWindow()
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
    expect(fake.window.loadFile).toHaveBeenCalledWith('/fake/gameOcr.html')
  })
})

describe('createGameOcrWindowController', () => {
  it('waits for the renderer, then presents the exact frame and focuses it', async () => {
    const fake = fakeWindow()
    const controller = createGameOcrWindowController({ window: fake.window })

    const presenting = controller.present(presentation)
    expect(fake.window.show).not.toHaveBeenCalled()

    fake.fireRenderer('did-finish-load')
    controller.rendererReady()
    await presenting

    expect(fake.window.webContents.send).toHaveBeenCalledWith(
      GAME_OCR_CHANNELS.present,
      presentation
    )
    expect(fake.window.show).toHaveBeenCalledOnce()
    expect(fake.window.focus).toHaveBeenCalledOnce()
    expect(controller.isVisible()).toBe(true)
  })

  it('sends accepted regions to the renderer that is showing their screenshot', async () => {
    const fake = fakeWindow()
    const controller = createGameOcrWindowController({ window: fake.window, loaded: true })
    const result = {
      sessionId: 4,
      captureId: 4,
      imageSize: { width: 1920, height: 1080 },
      regions: [
        {
          id: 'one',
          text: '日本語',
          bounds: { x: 10, y: 10, width: 100, height: 30 },
          confidence: 0.9
        }
      ]
    }

    await controller.present(presentation)
    controller.setRegions(result)

    expect(fake.window.webContents.send).toHaveBeenLastCalledWith(GAME_OCR_CHANNELS.regions, result)
  })

  it('drops regions once the frame is gone rather than reviving it', async () => {
    const fake = fakeWindow()
    const controller = createGameOcrWindowController({ window: fake.window, loaded: true })
    await controller.present(presentation)
    fake.fireWindow('closed')

    controller.setRegions({
      sessionId: 5,
      captureId: 5,
      imageSize: { width: 1920, height: 1080 },
      regions: []
    })

    expect(fake.window.webContents.send).not.toHaveBeenCalledWith(
      GAME_OCR_CHANNELS.regions,
      expect.anything()
    )
  })

  it('updates and clears the recognition state through the dedicated channels', async () => {
    const fake = fakeWindow()
    const controller = createGameOcrWindowController({ window: fake.window, loaded: true })

    await controller.present(presentation)
    controller.setRecognizing(false)

    expect(fake.window.webContents.send).toHaveBeenLastCalledWith(
      GAME_OCR_CHANNELS.recognitionState,
      false
    )
  })

  it('answers repeated close requests with one native close', async () => {
    const fake = fakeWindow()
    const controller = createGameOcrWindowController({ window: fake.window, loaded: true })
    await controller.present(presentation)

    // The renderer's close request and a display change can both arrive for
    // the same frame; neither may add another `closed` listener.
    const first = controller.close()
    const second = controller.close()
    expect(fake.window.close).toHaveBeenCalledOnce()
    expect(windowListenerCount(fake.window, 'closed')).toBe(2)

    fake.fireWindow('closed')
    await Promise.all([first, second])
    expect(controller.isVisible()).toBe(false)
  })

  it('keeps the window and its renderer alive across a discard', async () => {
    const fake = fakeWindow()
    const controller = createGameOcrWindowController({ window: fake.window, loaded: true })
    const onClosed = vi.fn()
    controller.onClosed(onClosed)
    await controller.present(presentation)

    const discarding = controller.discard()
    expect(fake.window.webContents.send).toHaveBeenLastCalledWith(GAME_OCR_CHANNELS.discard)
    expect(fake.window.hide).toHaveBeenCalledOnce()
    expect(fake.window.close).not.toHaveBeenCalled()

    let settled = false
    void discarding.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    fake.fireWindow('hide')
    await discarding
    expect(controller.isVisible()).toBe(false)
    expect(onClosed).not.toHaveBeenCalled()

    // The retained renderer is still ready, so the next frame needs no
    // handshake: presenting resolves without a `did-finish-load` round trip.
    const next = { ...presentation, imageBase64: 'bmV4dA==' }
    await controller.present(next)
    expect(fake.window.webContents.send).toHaveBeenLastCalledWith(GAME_OCR_CHANNELS.present, next)
    expect(controller.isVisible()).toBe(true)
  })

  it('serves many discards from one native hide listener', async () => {
    const fake = fakeWindow()
    const controller = createGameOcrWindowController({ window: fake.window, loaded: true })

    for (let frame = 0; frame < 5; frame++) {
      await controller.present(presentation)
      const discarding = controller.discard()
      fake.fireWindow('hide')
      await discarding
    }

    expect(windowListenerCount(fake.window, 'hide')).toBe(1)
  })

  it('moves the retained window onto the next captured display only when it changes', () => {
    const fake = fakeWindow()
    const constructed = { x: 0, y: 0, width: 2560, height: 1440 }
    const controller = createGameOcrWindowController({
      window: fake.window,
      loaded: true,
      displayBounds: constructed
    })

    // Recapturing on the display the window was built for moves nothing.
    controller.moveTo(constructed)
    expect(fake.window.setBounds).not.toHaveBeenCalled()

    const secondary = { x: -1920, y: 40, width: 1920, height: 1080 }
    controller.moveTo(secondary)
    controller.moveTo(secondary)
    expect(fake.window.setBounds).toHaveBeenCalledOnce()
    expect(fake.window.setBounds).toHaveBeenCalledWith(secondary)

    controller.moveTo(constructed)
    expect(fake.window.setBounds).toHaveBeenCalledTimes(2)
  })

  it('notifies dismissal listeners when the renderer asks for the live game back', async () => {
    const fake = fakeWindow()
    const controller = createGameOcrWindowController({ window: fake.window, loaded: true })
    const onDismissed = vi.fn()
    const onClosed = vi.fn()
    controller.onDismissed(onDismissed)
    controller.onClosed(onClosed)
    await controller.present(presentation)

    const dismissing = controller.dismiss()
    expect(onDismissed).toHaveBeenCalledOnce()
    fake.fireWindow('hide')
    await dismissing

    expect(onClosed).not.toHaveBeenCalled()
    expect(fake.window.close).not.toHaveBeenCalled()
    // A coordinator-driven discard is not a dismissal.
    const discarding = controller.discard()
    fake.fireWindow('hide')
    await discarding
    expect(onDismissed).toHaveBeenCalledOnce()
  })

  it('releases a pending discard when the window is destroyed instead', async () => {
    const fake = fakeWindow()
    const controller = createGameOcrWindowController({ window: fake.window, loaded: true })
    await controller.present(presentation)

    const discarding = controller.discard()
    fake.fireWindow('closed')
    await expect(discarding).resolves.toBeUndefined()
  })

  it('closes and notifies listeners without retaining the old presentation', async () => {
    const fake = fakeWindow()
    const controller = createGameOcrWindowController({ window: fake.window, loaded: true })
    const onClosed = vi.fn()
    controller.onClosed(onClosed)

    await controller.present(presentation)
    const closing = controller.close()
    expect(fake.window.webContents.send).toHaveBeenLastCalledWith(GAME_OCR_CHANNELS.discard)
    expect(fake.window.close).toHaveBeenCalledOnce()

    fake.fireWindow('closed')
    await closing

    expect(onClosed).toHaveBeenCalledOnce()
    expect(controller.isVisible()).toBe(false)
    await expect(controller.present(presentation)).resolves.toBeUndefined()
  })

  it('tears the window down when its renderer becomes unusable', async () => {
    const fake = fakeWindow()
    const controller = createGameOcrWindowController({ window: fake.window, loaded: true })
    const onClosed = vi.fn()
    controller.onClosed(onClosed)
    await controller.present(presentation)

    // A retained window whose renderer is gone can never complete another
    // readiness handshake, so it is closed for the coordinator to rebuild.
    fake.fireRenderer('render-process-gone')
    expect(fake.window.close).toHaveBeenCalledOnce()

    fake.fireWindow('closed')
    expect(onClosed).toHaveBeenCalledOnce()
    expect(controller.isVisible()).toBe(false)
  })

  it('tears the window down when its renderer fails to load', async () => {
    const fake = fakeWindow()
    const controller = createGameOcrWindowController({ window: fake.window })

    const presenting = controller.present(presentation)
    fake.fireRenderer('did-fail-load', -6, 'ERR_FILE_NOT_FOUND')

    await expect(presenting).rejects.toThrow('ERR_FILE_NOT_FOUND')
    expect(fake.window.close).toHaveBeenCalledOnce()
  })

  it('rejects malformed presentation data before it reaches the renderer', async () => {
    const fake = fakeWindow()
    const controller = createGameOcrWindowController({ window: fake.window, loaded: true })

    await expect(
      controller.present({
        ...presentation,
        imageSize: { width: 0, height: 1080 }
      })
    ).rejects.toThrow('presentation is invalid')
    expect(fake.window.webContents.send).not.toHaveBeenCalled()
  })

  it('routes only this window renderer events and removes the handlers on cleanup', () => {
    const fake = fakeWindow()
    const listeners = new Map<string, (event: { sender: unknown }) => void>()
    const ipc = {
      on: vi.fn((channel: string, listener: (event: { sender: unknown }) => void) => {
        listeners.set(channel, listener)
      }),
      removeListener: vi.fn()
    }
    const rendererReady = vi.fn()
    // The renderer's close request dismisses the frame; it never destroys the
    // window the next capture is going to reuse.
    const dismiss = vi.fn(async () => {})
    const remove = registerGameOcrIpc(ipc, fake.window, { rendererReady, dismiss })

    listeners.get(GAME_OCR_CHANNELS.rendererReady)!({ sender: {} })
    expect(rendererReady).not.toHaveBeenCalled()
    listeners.get(GAME_OCR_CHANNELS.rendererReady)!({ sender: fake.window.webContents })
    listeners.get(GAME_OCR_CHANNELS.close)!({ sender: fake.window.webContents })
    expect(rendererReady).toHaveBeenCalledOnce()
    expect(dismiss).toHaveBeenCalledOnce()

    remove()
    expect(ipc.removeListener).toHaveBeenCalledTimes(2)
  })
})
