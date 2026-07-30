// Shared ipcMain-like test seams: the narrow structural slices of Electron's
// ipcMain that bridges depend on instead of importing Electron directly, so
// tests exercise bridge registration with fakes instead of a live Electron
// process. This is the single home for these types — bridges must not
// redeclare them.

/** The subset of Electron's ipcMain we need, generic over the event type. */
export interface IpcMainHandleLike<E> {
  // `any[]` mirrors Electron's own `ipcMain.handle` signature: each channel
  // below passes a differently-typed argument list, which `unknown[]` would
  // reject contravariantly.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handle(channel: string, listener: (event: E, ...args: any[]) => unknown): unknown
}

/** The subset of Electron's ipcMain we need for a fire-and-forget (send) channel. */
export interface IpcMainOnLike<E> {
  on(channel: string, listener: (event: E, ...args: unknown[]) => void): unknown
}

/** The subset of Electron's ipcMain we need. Fire-and-forget commands use
 * `on`; commands that return a value go through `handle` (invoke/handle).
 * Electron types the two callbacks' events differently (`IpcMainEvent` vs
 * `IpcMainInvokeEvent`), so the event type is generic per method. */
export interface IpcMainLike<E, I> {
  on(channel: string, listener: (event: E, ...args: unknown[]) => void): unknown
  handle(channel: string, listener: (event: I, ...args: unknown[]) => unknown): unknown
}
