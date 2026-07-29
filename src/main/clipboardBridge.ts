import { CLIPBOARD_CHANNELS } from '../shared/ipcChannels'
import type { IpcMainHandleLike } from './playerBridge'

/** The narrow Electron clipboard surface used by the renderer bridge. */
export interface ClipboardWriter {
  writeText(text: string): void
}

/** Registers the renderer's text-only clipboard command. */
export function registerClipboardBridge<E>(
  ipc: IpcMainHandleLike<E>,
  clipboard: ClipboardWriter
): void {
  ipc.handle(CLIPBOARD_CHANNELS.writeText, (_event, text: string) => clipboard.writeText(text))
}
