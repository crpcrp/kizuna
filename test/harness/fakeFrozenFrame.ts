// A fake of the native BrowserWindow surface the frozen-frame owners bind to.
// Shared by the controller, Electron-construction, and IPC suites.

import { vi } from 'vitest'
import type { GameOcrConstructedWindow } from '@src/main/services/gameOcr/frozenFrameElectron'
import type { GameOcrNativeWindow } from '@src/main/services/gameOcr/frozenFrameController'

type Listener = (...args: unknown[]) => void

export interface FakeNativeWindow {
  window: GameOcrConstructedWindow
  fireWindow(event: 'closed' | 'hide'): void
  fireRenderer(
    event: 'did-finish-load' | 'render-process-gone' | 'did-fail-load',
    ...args: unknown[]
  ): void
}

export function fakeNativeWindow(): FakeNativeWindow {
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
    hide: vi.fn(() => {
      visible = false
    }),
    focus: vi.fn(),
    moveTop: vi.fn(),
    setAlwaysOnTop: vi.fn(),
    close: vi.fn(),
    setBounds: vi.fn(),
    setContentProtection: vi.fn(),
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
      openDevTools: vi.fn()
    }
  } as unknown as GameOcrConstructedWindow

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

/** How many listeners the controller attached for a native window event. */
export function windowListenerCount(window: GameOcrNativeWindow, event: 'closed' | 'hide'): number {
  const on = window.on as unknown as ReturnType<typeof vi.fn>
  return on.mock.calls.filter((call) => call[0] === event).length
}
