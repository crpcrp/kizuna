// Fake ipcMain for main-process bridge tests. Every bridge test previously
// declared its own byte-identical copy of this recorder; keeping one here means
// a change to the ipcMain surface is made once rather than per bridge.

import type { IpcMainHandleLike, IpcMainOnLike } from '@src/main/ipc'

/** Stand-in invoke event. Bridges that only read the sender's identity need no more. */
export type FakeEvent = { senderId: number }

// `any[]` mirrors `IpcMainHandleLike`, whose per-channel argument lists
// `unknown[]` would reject contravariantly.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type FakeHandleFn<E> = (event: E, ...args: any[]) => unknown

export type FakeOnFn<E> = (event: E, ...args: unknown[]) => void

export interface FakeIpc<E> {
  /** Satisfies both ipcMain shapes, so a bridge taking either accepts it. */
  ipc: IpcMainHandleLike<E> & IpcMainOnLike<E>
  /** Handlers registered through `handle`, keyed by channel. */
  handlers: Map<string, FakeHandleFn<E>>
  /** Listeners registered through `on`, keyed by channel. */
  listeners: Map<string, FakeOnFn<E>>
  /** Calls a registered handler with the default event. Throws if unregistered. */
  invoke(channel: string, ...args: unknown[]): unknown
  /** Calls a registered listener with the default event. No-op if unregistered. */
  send(channel: string, ...args: unknown[]): void
}

/**
 * Records the handlers and listeners a bridge registers so a test can assert on
 * the channel set and drive each one directly. `event` is only the default that
 * `invoke`/`send` pass; tests that care about the sender call through
 * `handlers`/`listeners` with an event of their own.
 */
export function fakeIpc<E = FakeEvent>(event: E = { senderId: 1 } as E): FakeIpc<E> {
  const handlers = new Map<string, FakeHandleFn<E>>()
  const listeners = new Map<string, FakeOnFn<E>>()
  return {
    ipc: {
      handle: (channel, listener) => handlers.set(channel, listener),
      on: (channel, listener) => listeners.set(channel, listener)
    },
    handlers,
    listeners,
    invoke: (channel, ...args) => handlers.get(channel)!(event, ...args),
    send: (channel, ...args) => listeners.get(channel)?.(event, ...args)
  }
}
