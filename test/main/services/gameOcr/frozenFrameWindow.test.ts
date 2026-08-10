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
      if (event === 'hide') visible = false
      if (event === 'closed') {
        visible = false
        destroyed = true
      }
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

  it('updates and clears the recognition state through the dedicated channels', async () => {
    const fake = fakeWindow()
    const controller = createGameOcrWindowController({ window: fake.window, loaded: true })

    await controller.present(presentation)
    controller.setRecognizing(false)

    expect(fake.window.webContents.send).toHaveBeenLastCalledWith(
      GAME_OCR_CHANNELS.recognitionState,
      false
    )

    const discarding = controller.discard()
    expect(fake.window.webContents.send).toHaveBeenLastCalledWith(GAME_OCR_CHANNELS.discard)
    expect(fake.window.hide).toHaveBeenCalledOnce()

    let settled = false
    void discarding.then(() => {
      settled = true
    })
    await Promise.resolve()
    expect(settled).toBe(false)

    fake.fireWindow('hide')
    await discarding
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
