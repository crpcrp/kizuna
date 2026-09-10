import { JIMAKU_CHANNELS } from '../shared/ipcChannels'
import type {
  JimakuFolderHint,
  JimakuFolderHintInput,
  JimakuSettingsStatus
} from '../shared/jimaku'
import type { IpcMainHandleLike } from './ipc'

export interface JimakuSettingsServiceLike {
  getStatus(): JimakuSettingsStatus
  setApiKey(value: string): JimakuSettingsStatus
  clearApiKey(): JimakuSettingsStatus
  testConnection(): Promise<JimakuSettingsStatus>
  getFolderHint(mediaPath: string, season?: number): JimakuFolderHint | undefined
  setFolderHint(mediaPath: string, hint: JimakuFolderHintInput): JimakuFolderHint
  clearFolderHint(mediaPath: string, season?: number): void
}

const INVALID_API_KEY = 'Invalid Jimaku API key.'
const INVALID_MEDIA_PATH = 'Invalid Jimaku media path.'
const INVALID_FOLDER_HINT = 'Invalid Jimaku folder hint.'

function parseApiKey(value: unknown): string {
  if (typeof value !== 'string') throw new Error(INVALID_API_KEY)
  return value
}

function parseMediaPath(value: unknown): string {
  if (typeof value !== 'string' || value.trim() === '') throw new Error(INVALID_MEDIA_PATH)
  return value
}

function parseSeason(value: unknown): number | undefined {
  if (
    value !== undefined &&
    (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 999)
  )
    throw new Error(INVALID_FOLDER_HINT)
  return value as number | undefined
}

function parseFolderHint(value: unknown): JimakuFolderHintInput {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(INVALID_FOLDER_HINT)
  }
  return value as JimakuFolderHintInput
}

/** Registers only the renderer-facing Jimaku settings operations. */
export function registerJimakuSettingsBridge<E>(
  ipc: IpcMainHandleLike<E>,
  service: JimakuSettingsServiceLike
): void {
  ipc.handle(JIMAKU_CHANNELS.getStatus, () => service.getStatus())
  ipc.handle(JIMAKU_CHANNELS.setApiKey, (_event, value) => service.setApiKey(parseApiKey(value)))
  ipc.handle(JIMAKU_CHANNELS.clearApiKey, () => service.clearApiKey())
  ipc.handle(JIMAKU_CHANNELS.testConnection, () => service.testConnection())
  ipc.handle(JIMAKU_CHANNELS.getFolderHint, (_event, mediaPath, season) =>
    service.getFolderHint(parseMediaPath(mediaPath), parseSeason(season))
  )
  ipc.handle(JIMAKU_CHANNELS.setFolderHint, (_event, mediaPath, hint) =>
    service.setFolderHint(parseMediaPath(mediaPath), parseFolderHint(hint))
  )
  ipc.handle(JIMAKU_CHANNELS.clearFolderHint, (_event, mediaPath, season) =>
    service.clearFolderHint(parseMediaPath(mediaPath), parseSeason(season))
  )
}
