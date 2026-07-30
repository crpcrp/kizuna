// URL-subtitle IPC bridge (yt-dlp): wires the UrlSubtitleService's enumerate/
// acquire/cancel surface to ipcMain channels. Pure injectable wiring — the
// ipcMain-like object and the service are injected so tests exercise this with
// fakes instead of live Electron/yt-dlp (AGENTS.md law 3). Every untrusted
// payload is validated here, in main, before it reaches the service.

import { URL_SUBTITLE_CHANNELS } from '../shared/ipcChannels'
import { isUrlSubtitleDescriptor } from '../shared/urlSubtitles'
import type { UrlSubtitleAsset, UrlSubtitleInventory } from '../shared/urlSubtitles'
import type { IpcMainHandleLike, IpcMainOnLike } from './ipc'

/** The slice of the URL-subtitle service this bridge needs (fakeable in tests). */
export interface UrlSubtitleServiceLike {
  enumerate(url: string): Promise<UrlSubtitleInventory>
  acquire(descriptor: { url: string; selectionId: string }): Promise<UrlSubtitleAsset>
  cancel(): void
}

/**
 * Registers the URL-subtitle channels. `enumerate` rejects a non-string URL;
 * `acquire` rejects any payload that isn't a well-formed descriptor — both
 * before the service (and yt-dlp) can run. `cancel` is fire-and-forget.
 */
export function registerUrlSubtitleBridge<E>(
  ipc: IpcMainHandleLike<E> & IpcMainOnLike<E>,
  service: UrlSubtitleServiceLike
): void {
  ipc.handle(URL_SUBTITLE_CHANNELS.enumerate, (_e, url: unknown) => {
    if (typeof url !== 'string' || url === '') throw new Error('Invalid URL.')
    return service.enumerate(url)
  })

  ipc.handle(URL_SUBTITLE_CHANNELS.acquire, (_e, descriptor: unknown) => {
    if (!isUrlSubtitleDescriptor(descriptor)) throw new Error('Invalid subtitle selection.')
    return service.acquire(descriptor)
  })

  ipc.on(URL_SUBTITLE_CHANNELS.cancel, () => service.cancel())
}
