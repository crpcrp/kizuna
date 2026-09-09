import { JIMAKU_CHANNELS } from '../shared/ipcChannels'
import type { JimakuSettingsStatus } from '../shared/jimaku'
import type { IpcMainHandleLike } from './ipc'

export interface JimakuSettingsServiceLike {
  getStatus(): JimakuSettingsStatus
  setApiKey(value: string): JimakuSettingsStatus
  clearApiKey(): JimakuSettingsStatus
  testConnection(): Promise<JimakuSettingsStatus>
}

const INVALID_API_KEY = 'Invalid Jimaku API key.'

function parseApiKey(value: unknown): string {
  if (typeof value !== 'string') throw new Error(INVALID_API_KEY)
  return value
}

/** Registers only the renderer-facing Jimaku credential operations. */
export function registerJimakuSettingsBridge<E>(
  ipc: IpcMainHandleLike<E>,
  service: JimakuSettingsServiceLike
): void {
  ipc.handle(JIMAKU_CHANNELS.getStatus, () => service.getStatus())
  ipc.handle(JIMAKU_CHANNELS.setApiKey, (_event, value) => service.setApiKey(parseApiKey(value)))
  ipc.handle(JIMAKU_CHANNELS.clearApiKey, () => service.clearApiKey())
  ipc.handle(JIMAKU_CHANNELS.testConnection, () => service.testConnection())
}
