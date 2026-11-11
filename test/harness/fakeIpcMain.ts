// Fake ipcMain for main-process bridge tests. Every bridge test previously
// declared its own byte-identical copy of this recorder; keeping one here means
// a change to the ipcMain surface is made once rather than per bridge.

import type { IpcMainHandleLike, IpcMainOnLike } from '@src/main/ipc'

/** Stand-in invoke event. Bridges that only read the sender's identity need no more. */
export type FakeEvent = { senderId: number }

export type FakeHandleFn<E> = (event: E, ...args: unknown[]) => unknown

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

/**
 * Invokes `channel` and resolves the rejection it produced. A synchronous throw
 * counts, as Electron turns one into the invoke's rejection. Fails if the
 * handler succeeds.
 */
export async function invokeRejection<E>(
  fake: Pick<FakeIpc<E>, 'invoke'>,
  channel: string,
  ...args: unknown[]
): Promise<unknown> {
  try {
    await fake.invoke(channel, ...args)
  } catch (err) {
    return err
  }
  throw new Error(`${channel} did not reject`)
}

/** Asserts that no method of a vi.fn-backed fake service was called. */
export function expectUntouched(service: object): void {
  for (const [name, fn] of Object.entries(service)) {
    if (typeof fn === 'function' && 'mock' in fn && fn.mock.calls.length > 0) {
      throw new Error(`${name} was called with a malformed request`)
    }
  }
}
