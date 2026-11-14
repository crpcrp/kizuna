import * as fs from 'node:fs'
import type { BrowserWindow, IpcMain } from 'electron'
import type { SecretCodec } from '../services/secrets'
import type { SettingsStore } from '../services/settings'
import type { AppPaths } from './paths'

/** Pushes an event to the renderer-owning window, if one is alive. */
export type SendToMain = (channel: string, value: unknown) => void

/** What every feature bootstrap module may depend on. */
export interface BootstrapDeps {
  ipcMain: IpcMain
  settings: SettingsStore
  secrets: SecretCodec
  paths: AppPaths
  sendToMain: SendToMain
}

/**
 * The renderer-owning window. On Linux this is the transparent child overlay;
 * the opaque video host is kept separate and is passed only to mpv. It is
 * `undefined` before the window exists and after it closes, so bridges
 * registered earlier read it lazily through this reference.
 */
export interface MainWindowRef {
  current: BrowserWindow | undefined
}

/** Read-then-delete adapters for the short-lived files under `app.getPath('temp')`. */
export const tempFileFs = {
  readBase64: async (path: string): Promise<string> =>
    (await fs.promises.readFile(path)).toString('base64'),
  remove: (path: string): Promise<void> => fs.promises.rm(path, { force: true })
}
