import { describe, expect, it, vi } from 'vitest'
import type { BrowserWindow } from 'electron'
import {
  createGameOcrWindow,
  createGameOcrWindowController,
  getGameOcrWindowOptions,
  registerGameOcrIpc,
  type GameOcrNativeWindow,
  type GameOcrWindow
} from '@src/main/services/gameOcr/frozenFrameWindow'
import { GAME_OCR_CHANNELS } from '@src/shared/ipcChannels'
import type { GameOcrFreezeRequest } from '@src/shared/gameOcr'

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
    moveTop: vi.fn(),
    setAlwaysOnTop: vi.fn(),
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
      openDevTools: vi.fn(),
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

const freezeRequest: GameOcrFreezeRequest = {
  sessionId: 1,
  captureId: 1,
  sourceId: 'screen:0:0',
  imageSize: { width: 1920, height: 1080 },
  requireFreshFrame: false
}

/** Drives one freeze the way the renderer would: draw, report, then encode. */
async function freezeWith(
  controller: GameOcrWindow,
  request: GameOcrFreezeRequest = freezeRequest,
  imageBase64 = 'iVBORw0KGgo='
): Promise<void> {
  const freezing = controller.freeze(request)
  await Promise.resolve()
  controller.reportFrozen({
    sessionId: request.sessionId,
    captureId: request.captureId,
    imageSize: request.imageSize
  })
  await freezing
  controller.reportCaptureBytes({
    sessionId: request.sessionId,
    captureId: request.captureId,
    imageBase64,
    imageMediaType: 'image/png',
    imageSize: request.imageSize
  })
}

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
    expect(fake.window.loadFile).toHaveBeenCalledWith('/fake/gameOcr.html', {})
  })

  it('asks the renderer to trace its input only when tracing is on', () => {
    const off = fakeWindow()
    createGameOcrWindow({
      platform: 'win32',
      preloadPath: '/fake/preload.js',
      displayBounds: { x: 0, y: 0, width: 800, height: 600 },
      packagedHtmlPath: '/fake/gameOcr.html',
      createWindow: () => off.window as unknown as BrowserWindow
    })
    expect(off.window.loadFile).toHaveBeenCalledWith('/fake/gameOcr.html', {})
    expect(off.window.webContents.openDevTools).not.toHaveBeenCalled()

    const on = fakeWindow()
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
})

describe('createGameOcrWindowController', () => {
  it('waits for the renderer, asks it to freeze, and shows it without focusing', async () => {
    const fake = fakeWindow()
    const controller = createGameOcrWindowController({ window: fake.window })

    const freezing = controller.freeze(freezeRequest)
    expect(fake.window.show).not.toHaveBeenCalled()

    fake.fireRenderer('did-finish-load')
    controller.rendererReady()
    await Promise.resolve()

    expect(fake.window.webContents.send).toHaveBeenCalledWith(
      GAME_OCR_CHANNELS.freeze,
      freezeRequest
    )
    // Still hidden while the renderer draws: a window that is not on screen
    // cannot be in the picture it is about to show.
    expect(fake.window.show).not.toHaveBeenCalled()

    controller.reportFrozen({ sessionId: 1, captureId: 1, imageSize: freezeRequest.imageSize })
    await expect(freezing).resolves.toEqual(freezeRequest.imageSize)
    expect(fake.window.show).toHaveBeenCalledOnce()
    // Taking the foreground is what stalls the game behind the frame.
    expect(fake.window.focus).not.toHaveBeenCalled()
    // But it still has to be raised: always-on-top is a band, and inside it a
    // window that never activates loses to a game that is itself topmost, so
    // the frame would be shown behind the game and appear not to open at all.
    expect(fake.window.setAlwaysOnTop).toHaveBeenCalledWith(true, 'screen-saver')
    expect(fake.window.moveTop).toHaveBeenCalledOnce()
    expect(controller.isVisible()).toBe(true)
  })

  it('resolves the encoded screenshot only after the frame is already shown', async () => {
    const fake = fakeWindow()
    const controller = createGameOcrWindowController({ window: fake.window, loaded: true })

    const freezing = controller.freeze(freezeRequest)
    await Promise.resolve()
    controller.reportFrozen({ sessionId: 1, captureId: 1, imageSize: freezeRequest.imageSize })
    await freezing
    expect(fake.window.show).toHaveBeenCalledOnce()

    // The encode runs after the pixels are up, so nothing the user waits for
    // sits behind it.
    const bytes = controller.captureBytes(1)
    controller.reportCaptureBytes({
      sessionId: 1,
      captureId: 1,
      imageBase64: 'iVBORw0KGgo=',
      imageMediaType: 'image/png',
      imageSize: freezeRequest.imageSize
    })
    await expect(bytes).resolves.toBe('iVBORw0KGgo=')
  })

  it('surfaces a renderer that could not freeze or encode the frame', async () => {
    const fake = fakeWindow()
    const controller = createGameOcrWindowController({ window: fake.window, loaded: true })

    const freezing = controller.freeze(freezeRequest)
    await Promise.resolve()
    controller.reportFrozen({
      sessionId: 1,
      captureId: 1,
      imageSize: freezeRequest.imageSize,
      error: 'the display stream ended'
    })
    await expect(freezing).rejects.toThrow('the display stream ended')
    expect(fake.window.show).not.toHaveBeenCalled()

    const bytes = controller.captureBytes(2)
    controller.reportCaptureBytes({
      sessionId: 1,
      captureId: 2,
      imageBase64: '',
      imageMediaType: 'image/png',
      imageSize: freezeRequest.imageSize,
      error: 'the frame could not be encoded'
    })
    await expect(bytes).rejects.toThrow('the frame could not be encoded')
  })

  it('fails a capture still waiting when the renderer goes away', async () => {
    const fake = fakeWindow()
    const controller = createGameOcrWindowController({ window: fake.window, loaded: true })
    const freezing = controller.freeze(freezeRequest)
    const bytes = controller.captureBytes(1)
    await Promise.resolve()

    fake.fireRenderer('render-process-gone')

    await expect(freezing).rejects.toThrow(/renderer stopped/)
    await expect(bytes).rejects.toThrow(/renderer stopped/)
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

    await freezeWith(controller)
    controller.setRegions(result)

    expect(fake.window.webContents.send).toHaveBeenLastCalledWith(GAME_OCR_CHANNELS.regions, result)
  })

  it('drops regions once the frame is gone rather than reviving it', async () => {
    const fake = fakeWindow()
    const controller = createGameOcrWindowController({ window: fake.window, loaded: true })
    await freezeWith(controller)
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

    await freezeWith(controller)
    controller.setRecognizing(false)

    expect(fake.window.webContents.send).toHaveBeenLastCalledWith(
      GAME_OCR_CHANNELS.recognitionState,
      false
    )
  })

  it('answers repeated close requests with one native close', async () => {
    const fake = fakeWindow()
    const controller = createGameOcrWindowController({ window: fake.window, loaded: true })
    await freezeWith(controller)

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
    await freezeWith(controller)

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
    const next = { ...freezeRequest, captureId: 2 }
    await freezeWith(controller, next)
    expect(fake.window.webContents.send).toHaveBeenCalledWith(GAME_OCR_CHANNELS.freeze, next)
    expect(controller.isVisible()).toBe(true)
  })

  it('serves many discards from one native hide listener', async () => {
    const fake = fakeWindow()
    const controller = createGameOcrWindowController({ window: fake.window, loaded: true })

    for (let frame = 0; frame < 5; frame++) {
      await freezeWith(controller)
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
    await freezeWith(controller)

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
    await freezeWith(controller)

    const discarding = controller.discard()
    fake.fireWindow('closed')
    await expect(discarding).resolves.toBeUndefined()
  })

  it('closes and notifies listeners without retaining the old presentation', async () => {
    const fake = fakeWindow()
    const controller = createGameOcrWindowController({ window: fake.window, loaded: true })
    const onClosed = vi.fn()
    controller.onClosed(onClosed)

    await freezeWith(controller)
    const closing = controller.close()
    expect(fake.window.webContents.send).toHaveBeenLastCalledWith(GAME_OCR_CHANNELS.discard)
    expect(fake.window.close).toHaveBeenCalledOnce()

    fake.fireWindow('closed')
    await closing

    expect(onClosed).toHaveBeenCalledOnce()
    expect(controller.isVisible()).toBe(false)
    await expect(controller.freeze(freezeRequest)).rejects.toThrow('frame is gone')
  })

  it('tears the window down when its renderer becomes unusable', async () => {
    const fake = fakeWindow()
    const controller = createGameOcrWindowController({ window: fake.window, loaded: true })
    const onClosed = vi.fn()
    controller.onClosed(onClosed)
    await freezeWith(controller)

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

    const presenting = controller.freeze(freezeRequest)
    fake.fireRenderer('did-fail-load', -6, 'ERR_FILE_NOT_FOUND')

    await expect(presenting).rejects.toThrow('ERR_FILE_NOT_FOUND')
    expect(fake.window.close).toHaveBeenCalledOnce()
  })

  it('hides the window on dismissal even when it reports itself invisible', async () => {
    const fake = fakeWindow()
    const controller = createGameOcrWindowController({ window: fake.window, loaded: true })
    await freezeWith(controller)
    // The one failure this path must not have is a frozen frame left covering
    // the game because `isVisible()` disagreed with what the user can see, so
    // the hide is issued without consulting it.
    vi.spyOn(fake.window, 'isVisible').mockReturnValue(false)

    await controller.dismiss()

    expect(fake.window.hide).toHaveBeenCalledOnce()
  })

  it('rejects a malformed freeze request before it reaches the renderer', async () => {
    const fake = fakeWindow()
    const controller = createGameOcrWindowController({ window: fake.window, loaded: true })

    await expect(
      controller.freeze({ ...freezeRequest, imageSize: { width: 0, height: 1080 } })
    ).rejects.toThrow('freeze request is invalid')
    // Without a source the renderer has no stream to freeze.
    await expect(controller.freeze({ ...freezeRequest, sourceId: '' })).rejects.toThrow(
      'freeze request is invalid'
    )
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
    const remove = registerGameOcrIpc(ipc, fake.window, {
      rendererReady,
      dismiss,
      reportFrozen: vi.fn(),
      reportCaptureBytes: vi.fn()
    })

    listeners.get(GAME_OCR_CHANNELS.rendererReady)!({ sender: {} })
    expect(rendererReady).not.toHaveBeenCalled()
    listeners.get(GAME_OCR_CHANNELS.rendererReady)!({ sender: fake.window.webContents })
    listeners.get(GAME_OCR_CHANNELS.close)!({ sender: fake.window.webContents })
    expect(rendererReady).toHaveBeenCalledOnce()
    expect(dismiss).toHaveBeenCalledOnce()

    remove()
    // Four channels now: ready and close in, plus the frozen and encoded
    // reports the renderer sends back for each capture.
    expect(ipc.removeListener).toHaveBeenCalledTimes(4)
  })
})
