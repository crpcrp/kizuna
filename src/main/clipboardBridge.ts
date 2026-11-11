import { CLIPBOARD_CHANNELS } from '../shared/ipcChannels'
import { isString } from '../shared/guards'
import type { IpcMainHandleLike } from './ipc'
import { expect } from './ipcValidation'

/** The narrow Electron clipboard surface used by the renderer bridge. */
export interface ClipboardWriter {
  writeText(text: string): void
}

/** Registers the renderer's text-only clipboard command. */
export function registerClipboardBridge<E>(
  ipc: IpcMainHandleLike<E>,
  clipboard: ClipboardWriter
): void {
  const textArg = expect(isString, CLIPBOARD_CHANNELS.writeText)
  ipc.handle(CLIPBOARD_CHANNELS.writeText, (_event, text) => clipboard.writeText(textArg(text)))
}
