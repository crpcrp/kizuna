import { describe, it, expect, vi } from 'vitest'
import {
  allowPermissionRequest,
  applyNavigationGuards,
  applyReloadGuard,
  registerWindowControls,
  sendToWindow,
  type WindowControlTarget,
  type WindowBounds,
  type BeforeInputEventInput,
  type SendTarget
} from '@src/main/windowOptions'
import { WINDOW_CONTROL_CHANNELS } from '@src/shared/ipcChannels'

describe('applyNavigationGuards', () => {
  const currentUrl = 'file:///app/renderer/index.html'

  /** Fake webContents: records the will-navigate listener and window-open
   * handler; reports a fixed current URL. */
  function fakeWebContents() {
    let navListener: ((event: { preventDefault(): void }, url: string) => void) | undefined
    let openHandler: (() => { action: 'deny' } | { action: 'allow' }) | undefined
    return {
      on: (
        _event: 'will-navigate',
        listener: (event: { preventDefault(): void }, url: string) => void
      ) => {
        navListener = listener
      },
      getURL: () => currentUrl,
      setWindowOpenHandler: (handler: () => { action: 'deny' } | { action: 'allow' }) => {
        openHandler = handler
      },
      fireNavigate(url: string) {
        const event = { preventDefault: vi.fn() }
        navListener!(event, url)
        return event
      },
      get openHandler() {
        return openHandler
      }
    }
  }

  it('prevents navigation to a different URL (off-origin or file://)', () => {
    const wc = fakeWebContents()
    applyNavigationGuards(wc)

    expect(wc.fireNavigate('https://evil.example/phish').preventDefault).toHaveBeenCalledTimes(1)
    expect(wc.fireNavigate('file:///etc/passwd').preventDefault).toHaveBeenCalledTimes(1)
  })

  it('allows an in-place reload of the current URL', () => {
    const wc = fakeWebContents()
    applyNavigationGuards(wc)

    expect(wc.fireNavigate(currentUrl).preventDefault).not.toHaveBeenCalled()
  })

  it('denies every window.open / new-window request', () => {
    const wc = fakeWebContents()
    applyNavigationGuards(wc)

    expect(wc.openHandler!()).toEqual({ action: 'deny' })
  })
})

describe('allowPermissionRequest', () => {
  it('allows video-only media capture for Game OCR', () => {
    expect(allowPermissionRequest('media', ['video'])).toBe(true)
    expect(allowPermissionRequest('media', [])).toBe(true)
  })

  it('denies microphone access and every other permission', () => {
    expect(allowPermissionRequest('media', ['audio', 'video'])).toBe(false)
    expect(allowPermissionRequest('notifications', undefined)).toBe(false)
    expect(allowPermissionRequest('geolocation', undefined)).toBe(false)
    expect(allowPermissionRequest('openExternal', undefined)).toBe(false)
  })
})

describe('applyReloadGuard', () => {
  /** Fake webContents: records the before-input-event listener and lets tests
   * fire arbitrary Input payloads at it. */
  function fakeWebContents() {
    let listener:
      ((event: { preventDefault(): void }, input: BeforeInputEventInput) => void) | undefined
    return {
      on: (
        _event: 'before-input-event',
        l: (event: { preventDefault(): void }, input: BeforeInputEventInput) => void
      ) => {
        listener = l
      },
      fireInput(input: BeforeInputEventInput) {
        const event = { preventDefault: vi.fn() }
        listener!(event, input)
        return event
      }
    }
  }

  function keyDown(overrides: Partial<BeforeInputEventInput> = {}): BeforeInputEventInput {
    return { type: 'keyDown', key: 'r', control: false, meta: false, ...overrides }
  }

  it.each([
    ['Ctrl+R', { control: true }, true],
    ['right-Control uppercase R', { key: 'R', control: true }, true],
    ['Cmd+R', { meta: true }, true],
    ['bare R', {}, false],
    ['Ctrl+S', { key: 's', control: true }, false],
    ['Ctrl+I', { key: 'i', control: true }, false],
    ['Ctrl+R keyUp', { type: 'keyUp', control: true }, false]
  ] satisfies [string, Partial<BeforeInputEventInput>, boolean][])(
    '%s is blocked only for reload chords',
    (_label, input, blocked) => {
      const wc = fakeWebContents()
      applyReloadGuard(wc)
      expect(wc.fireInput(keyDown(input)).preventDefault).toHaveBeenCalledTimes(blocked ? 1 : 0)
    }
  )
})

describe('registerWindowControls', () => {
  type FakeEvent = { senderId: number }

  const primaryWorkArea = { x: 0, y: 0, width: 1920, height: 1040 }

  /** Fake ipcMain: records `on` listeners and `handle` handlers per channel;
   * resolver returns `target`. A fake `screen` resolves whichever display
   * `getDisplayMatching` is told to return (defaults to the primary). */
  function setup(
    target: WindowControlTarget | null,
    beforeClose?: () => void,
    screen: { getDisplayMatching: (rect: unknown) => { workArea: typeof primaryWorkArea } } = {
      getDisplayMatching: () => ({ workArea: primaryWorkArea })
    }
  ) {
    const listeners = new Map<string, (event: FakeEvent, ...args: unknown[]) => void>()
    const handlers = new Map<string, (event: FakeEvent, ...args: unknown[]) => unknown>()
    const ipc = {
      on: (channel: string, listener: (event: FakeEvent, ...args: unknown[]) => void) => {
        listeners.set(channel, listener)
      },
      handle: (channel: string, handler: (event: FakeEvent, ...args: unknown[]) => unknown) => {
        handlers.set(channel, handler)
      }
    }
    const resolver = vi.fn((_event: FakeEvent) => target)
    registerWindowControls(ipc, resolver, screen, beforeClose)
    return { listeners, handlers, resolver }
  }

  /** A full fake window target (minimize/close/fullscreen/bounds). */
  function fakeTarget(
    fullscreen = false,
    bounds: WindowBounds = { x: 10, y: 20, width: 800, height: 600 },
    hasSavedBounds = false
  ) {
    return {
      capturePreFullscreenBounds: vi.fn(),
      hasPreFullscreenBounds: () => hasSavedBounds,
      minimize: vi.fn(),
      close: vi.fn(),
      focus: vi.fn(),
      setFullScreen: vi.fn(),
      isFullScreen: () => fullscreen,
      getBounds: vi.fn(() => bounds),
      setBounds: vi.fn(),
      setAlwaysOnTop: vi.fn(),
      setShape: vi.fn()
    }
  }

  it('minimizes the window resolved from the sending event', () => {
    const target = fakeTarget()
    const { listeners, resolver } = setup(target)
    const event = { senderId: 7 }

    listeners.get(WINDOW_CONTROL_CHANNELS.minimize)!(event)

    expect(resolver).toHaveBeenCalledWith(event)
    expect(target.minimize).toHaveBeenCalledTimes(1)
    expect(target.close).not.toHaveBeenCalled()
  })

  it('closes the window resolved from the sending event', () => {
    const target = fakeTarget()
    const { listeners } = setup(target)

    listeners.get(WINDOW_CONTROL_CHANNELS.close)!({ senderId: 7 })

    expect(target.close).toHaveBeenCalledTimes(1)
    expect(target.minimize).not.toHaveBeenCalled()
  })

  it('runs the main-owned pre-close callback before closing the window', () => {
    const calls: string[] = []
    const target = fakeTarget()
    target.close.mockImplementation(() => calls.push('close'))
    const { listeners } = setup(target, () => calls.push('flush-history'))

    listeners.get(WINDOW_CONTROL_CHANNELS.close)!({ senderId: 7 })

    expect(calls).toEqual(['flush-history', 'close'])
  })

  it('is a no-op when no window resolves (e.g. already destroyed)', () => {
    const beforeClose = vi.fn()
    const { listeners } = setup(null, beforeClose)
    expect(() => listeners.get(WINDOW_CONTROL_CHANNELS.close)!({ senderId: 7 })).not.toThrow()
    expect(() => listeners.get(WINDOW_CONTROL_CHANNELS.minimize)!({ senderId: 7 })).not.toThrow()
    expect(() =>
      listeners.get(WINDOW_CONTROL_CHANNELS.toggleFullscreen)!({ senderId: 7 })
    ).not.toThrow()
    expect(beforeClose).not.toHaveBeenCalled()
  })

  it.each([
    [WINDOW_CONTROL_CHANNELS.setFullscreen, false, false, true, true, true],
    [WINDOW_CONTROL_CHANNELS.setFullscreen, true, false, false, false, false],
    [WINDOW_CONTROL_CHANNELS.setFullscreen, false, false, false, false, false],
    [WINDOW_CONTROL_CHANNELS.toggleFullscreen, false, false, undefined, true, true],
    [WINDOW_CONTROL_CHANNELS.toggleFullscreen, true, false, undefined, false, false],
    [WINDOW_CONTROL_CHANNELS.toggleFullscreen, false, true, undefined, false, false]
  ] as const)(
    '%s from fullscreen=%s, saved=%s, request=%s',
    (channel, fullscreen, saved, request, next, captures) => {
      const target = fakeTarget(fullscreen, undefined, saved)
      const { listeners } = setup(target)
      listeners.get(channel)!({ senderId: 7 }, request)
      expect(target.setFullScreen).toHaveBeenCalledExactlyOnceWith(next)
      expect(target.capturePreFullscreenBounds).toHaveBeenCalledTimes(captures ? 1 : 0)
      if (captures) {
        expect(target.capturePreFullscreenBounds.mock.invocationCallOrder[0]).toBeLessThan(
          target.setFullScreen.mock.invocationCallOrder[0]
        )
      }
    }
  )

  it('setSize resizes the window, keeping its current position', () => {
    const target = fakeTarget(false, { x: 10, y: 20, width: 800, height: 600 })
    const { listeners } = setup(target)

    listeners.get(WINDOW_CONTROL_CHANNELS.setSize)!({ senderId: 7 }, 1920, 1080)

    expect(target.setBounds).toHaveBeenCalledWith({ x: 10, y: 20, width: 1920, height: 1080 })
  })

  it('setSize rounds fractional dimensions', () => {
    const target = fakeTarget(false, { x: 0, y: 0, width: 800, height: 600 })
    const { listeners } = setup(target)

    listeners.get(WINDOW_CONTROL_CHANNELS.setSize)!({ senderId: 7 }, 960.4, 540.6)

    expect(target.setBounds).toHaveBeenCalledWith({ x: 0, y: 0, width: 960, height: 541 })
  })

  it('setSize is a no-op with a non-numeric payload', () => {
    const target = fakeTarget()
    const { listeners } = setup(target)

    listeners.get(WINDOW_CONTROL_CHANNELS.setSize)!({ senderId: 7 }, 'nope', undefined)

    expect(target.setBounds).not.toHaveBeenCalled()
  })

  it('setAlwaysOnTop forwards the boolean payload', () => {
    const target = fakeTarget()
    const { listeners } = setup(target)

    listeners.get(WINDOW_CONTROL_CHANNELS.setAlwaysOnTop)!({ senderId: 7 }, true)
    expect(target.setAlwaysOnTop).toHaveBeenCalledWith(true)

    listeners.get(WINDOW_CONTROL_CHANNELS.setAlwaysOnTop)!({ senderId: 7 }, false)
    expect(target.setAlwaysOnTop).toHaveBeenCalledWith(false)
  })

  it('validates, clips, and forwards Linux overlay shape rectangles', () => {
    const target = fakeTarget(false, { x: 10, y: 20, width: 800, height: 600 })
    const { listeners } = setup(target)

    listeners.get(WINDOW_CONTROL_CHANNELS.setShape)!({ senderId: 7 }, [
      { x: -2.4, y: 10.2, width: 100.1, height: 40.2 },
      { x: 790, y: 590, width: 30, height: 30 }
    ])

    expect(target.setShape).toHaveBeenCalledWith([
      { x: 0, y: 10, width: 98, height: 41 },
      { x: 790, y: 590, width: 10, height: 10 }
    ])
  })

  it('rejects a malformed overlay shape payload', () => {
    const target = fakeTarget()
    const { listeners } = setup(target)

    listeners.get(WINDOW_CONTROL_CHANNELS.setShape)!({ senderId: 7 }, [
      { x: 0, y: 0, width: -1, height: 10 }
    ])

    expect(target.setShape).not.toHaveBeenCalled()
  })

  it('setSize/setAlwaysOnTop are no-ops when no window resolves', () => {
    const { listeners } = setup(null)
    expect(() =>
      listeners.get(WINDOW_CONTROL_CHANNELS.setSize)!({ senderId: 7 }, 100, 100)
    ).not.toThrow()
    expect(() =>
      listeners.get(WINDOW_CONTROL_CHANNELS.setAlwaysOnTop)!({ senderId: 7 }, true)
    ).not.toThrow()
  })

  it('getBounds returns the resolved window bounds', () => {
    const bounds: WindowBounds = { x: 10, y: 20, width: 800, height: 600 }
    const target = fakeTarget(false, bounds)
    const { handlers } = setup(target)

    expect(handlers.get(WINDOW_CONTROL_CHANNELS.getBounds)!({ senderId: 7 })).toEqual(bounds)
  })

  it('getBounds returns null when no window resolves', () => {
    const { handlers } = setup(null)
    expect(handlers.get(WINDOW_CONTROL_CHANNELS.getBounds)!({ senderId: 7 })).toBeNull()
  })

  it('setBounds applies an explicit rectangle verbatim (rounded)', () => {
    const target = fakeTarget(false, { x: 0, y: 0, width: 100, height: 100 })
    const { handlers } = setup(target)

    const result = handlers.get(WINDOW_CONTROL_CHANNELS.setBounds)!(
      { senderId: 7 },
      {
        mode: 'explicit',
        bounds: { x: 5.4, y: 6.6, width: 1024, height: 768 }
      }
    )

    expect(target.setBounds).toHaveBeenCalledWith({ x: 5, y: 7, width: 1024, height: 768 })
    expect(result).toEqual({ x: 5, y: 7, width: 1024, height: 768 })
  })

  it('setBounds mini-player lands in the display the window occupies, not the primary', () => {
    // Window lives on a secondary monitor to the right whose work area starts
    // at x=1920; getDisplayMatching returns *that* display, not the primary.
    const secondaryWorkArea = { x: 1920, y: 0, width: 2560, height: 1400 }
    const target = fakeTarget(false, { x: 2000, y: 100, width: 1280, height: 720 })
    const screen = { getDisplayMatching: vi.fn(() => ({ workArea: secondaryWorkArea })) }
    const { handlers } = setup(target, undefined, screen)

    const result = handlers.get(WINDOW_CONTROL_CHANNELS.setBounds)!(
      { senderId: 7 },
      {
        mode: 'miniPlayer',
        topBarHeight: 32,
        bottomBarHeight: 60
      }
    ) as WindowBounds

    expect(screen.getDisplayMatching).toHaveBeenCalledWith(target.getBounds())
    // Bottom-right corner of the *secondary* display's work area.
    expect(result.width).toBe(480)
    expect(result.height).toBe(362)
    expect(result.x + result.width).toBe(secondaryWorkArea.x + secondaryWorkArea.width)
    expect(result.y + result.height).toBe(secondaryWorkArea.y + secondaryWorkArea.height)
    // And it is genuinely within the secondary display, not the primary (x < 1920).
    expect(result.x).toBeGreaterThanOrEqual(secondaryWorkArea.x)
    expect(target.setBounds).toHaveBeenCalledWith(result)
    expect(target.focus).toHaveBeenCalledOnce()
    expect(target.setBounds.mock.invocationCallOrder[0]).toBeLessThan(
      target.focus.mock.invocationCallOrder[0]
    )
  })

  it('setBounds is a no-op returning null for a malformed request or no window', () => {
    const target = fakeTarget()
    const { handlers } = setup(target)
    expect(
      handlers.get(WINDOW_CONTROL_CHANNELS.setBounds)!({ senderId: 7 }, { mode: 'nope' })
    ).toBeNull()
    expect(handlers.get(WINDOW_CONTROL_CHANNELS.setBounds)!({ senderId: 7 }, undefined)).toBeNull()
    expect(target.setBounds).not.toHaveBeenCalled()

    const { handlers: none } = setup(null)
    expect(
      none.get(WINDOW_CONTROL_CHANNELS.setBounds)!(
        { senderId: 7 },
        {
          mode: 'explicit',
          bounds: { x: 0, y: 0, width: 1, height: 1 }
        }
      )
    ).toBeNull()
  })
})

describe('sendToWindow', () => {
  /** A fake window/webContents pair, structurally matching `SendTarget`
   * without pulling in real Electron. */
  function fakeWindow(opts: { winDestroyed?: boolean; wcDestroyed?: boolean } = {}) {
    const send = vi.fn<(channel: string, ...args: unknown[]) => void>()
    const win: SendTarget = {
      isDestroyed: () => Boolean(opts.winDestroyed),
      webContents: {
        isDestroyed: () => Boolean(opts.wcDestroyed),
        send
      }
    }
    return { win, send }
  }

  it('sends the channel and args exactly once when the window and webContents are alive', () => {
    const { win, send } = fakeWindow()

    sendToWindow(win, 'launch:openPath', '/tmp/video.mp4', 42)

    expect(send).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledWith('launch:openPath', '/tmp/video.mp4', 42)
  })

  it('does not send when the window itself is destroyed', () => {
    const { win, send } = fakeWindow({ winDestroyed: true })

    sendToWindow(win, 'launch:error', 'boom')

    expect(send).not.toHaveBeenCalled()
  })

  it('does not send when the window is alive but its webContents is destroyed', () => {
    const { win, send } = fakeWindow({ wcDestroyed: true })

    sendToWindow(win, 'launch:error', 'boom')

    expect(send).not.toHaveBeenCalled()
  })

  it('does not send and does not throw when the window is null or undefined', () => {
    expect(() => sendToWindow(null, 'launch:error', 'boom')).not.toThrow()
    expect(() => sendToWindow(undefined, 'launch:error', 'boom')).not.toThrow()
  })
})
