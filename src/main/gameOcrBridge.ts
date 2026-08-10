import { GAME_OCR_CHANNELS } from '../shared/ipcChannels'
import type { GameOcrRuntimeStatus } from '../shared/gameOcr'
import type { GameOcrSettings } from '../shared/gameOcrSettings'
import type { IpcMainHandleLike } from './ipc'
import type { GameOcrRuntimeService } from './services/gameOcr/runtime'

export interface GameOcrBridgeEvent {
  sender: unknown
}

/** Registers the main-window Game OCR commands and status push. */
export function registerGameOcrBridge<E extends GameOcrBridgeEvent>(
  ipc: IpcMainHandleLike<E>,
  service: GameOcrRuntimeService,
  send: (channel: string, value: unknown) => void,
  isAllowedSender: (sender: E['sender']) => boolean
): void {
  const allowed = (event: E): void => {
    if (!isAllowedSender(event.sender))
      throw new Error('Game OCR request came from an unknown window.')
  }

  service.subscribe((status) => send(GAME_OCR_CHANNELS.statusChanged, status))

  ipc.handle(GAME_OCR_CHANNELS.getSettings, (event): GameOcrSettings => {
    allowed(event)
    return service.getSettings()
  })
  ipc.handle(GAME_OCR_CHANNELS.setSettings, (event, value): Promise<GameOcrSettings> => {
    allowed(event)
    return service.setSettings(settingsPatch(value))
  })
  ipc.handle(GAME_OCR_CHANNELS.getStatus, (event): GameOcrRuntimeStatus => {
    allowed(event)
    return service.getStatus()
  })
  ipc.handle(GAME_OCR_CHANNELS.start, (event): Promise<GameOcrRuntimeStatus> => {
    allowed(event)
    return service.start()
  })
  ipc.handle(GAME_OCR_CHANNELS.stop, (event): Promise<GameOcrRuntimeStatus> => {
    allowed(event)
    return service.stop()
  })
  ipc.handle(GAME_OCR_CHANNELS.retry, (event): Promise<GameOcrRuntimeStatus> => {
    allowed(event)
    return service.retry()
  })
}

function settingsPatch(value: unknown): Partial<GameOcrSettings> {
  if (!value || typeof value !== 'object') return {}
  const patch = value as Record<string, unknown>
  return {
    captureShortcut: typeof patch.captureShortcut === 'string' ? patch.captureShortcut : undefined
  }
}
