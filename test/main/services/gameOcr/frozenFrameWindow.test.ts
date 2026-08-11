import { describe, expect, it, vi } from 'vitest'
import {
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
  fireWindow(event: 'closed'): void
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
    on: vi.fn((event: 'closed', listener: () => void) => on(windowListeners, event, listener)),
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
      destroyed = true
      fire(windowListeners, event)
    },
    fireRenderer: (event, ...args) => fire(rendererListeners, event, ...args)
  }
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
    expect((fake.window.on as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(2)

    fake.fireWindow('closed')
    await Promise.all([first, second])
    expect(controller.isVisible()).toBe(false)
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

  it('hides after renderer loss and can load a later renderer again', async () => {
    const fake = fakeWindow()
    const controller = createGameOcrWindowController({ window: fake.window, loaded: true })
    await controller.present(presentation)

    fake.fireRenderer('render-process-gone')
    expect(fake.window.hide).toHaveBeenCalledOnce()

    const nextPresentation = { ...presentation, recognizing: false }
    const presenting = controller.present(nextPresentation)
    fake.fireRenderer('did-finish-load')
    controller.rendererReady()
    await presenting

    expect(fake.window.webContents.send).toHaveBeenLastCalledWith(
      GAME_OCR_CHANNELS.present,
      nextPresentation
    )
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
    const close = vi.fn(async () => {})
    const remove = registerGameOcrIpc(ipc, fake.window, { rendererReady, close })

    listeners.get(GAME_OCR_CHANNELS.rendererReady)!({ sender: {} })
    expect(rendererReady).not.toHaveBeenCalled()
    listeners.get(GAME_OCR_CHANNELS.rendererReady)!({ sender: fake.window.webContents })
    listeners.get(GAME_OCR_CHANNELS.close)!({ sender: fake.window.webContents })
    expect(rendererReady).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()

    remove()
    expect(ipc.removeListener).toHaveBeenCalledTimes(2)
  })
})
