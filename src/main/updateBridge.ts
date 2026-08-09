import { UPDATE_CHANNELS } from '../shared/ipcChannels'
import type { UpdateCheckOrigin, UpdateSettings, UpdateState } from '../shared/update'
import type { IpcMainHandleLike } from './ipc'
import type { UpdateService } from './updateService'
import type { SettingsStore } from './services/settings'

export interface UpdateBridgeEvent {
  sender: unknown
}

function origin(value: unknown): UpdateCheckOrigin {
  if (value === 'automatic' || value === 'manual') return value
  throw new Error('Invalid update check origin.')
}

/** Registers only updater commands sent by the renderer-owning webContents. */
export function registerUpdateBridge<E extends UpdateBridgeEvent>(
  ipc: IpcMainHandleLike<E>,
  service: UpdateService,
  settings: SettingsStore,
  isAllowedSender: (sender: E['sender']) => boolean
): void {
  const allowed = (event: E): void => {
    if (!isAllowedSender(event.sender))
      throw new Error('Update request came from an unknown window.')
  }
  ipc.handle(UPDATE_CHANNELS.getState, (event): UpdateState => {
    allowed(event)
    return service.getState()
  })
  ipc.handle(UPDATE_CHANNELS.getSettings, (event): UpdateSettings => {
    allowed(event)
    return settings.get().updates
  })
  ipc.handle(UPDATE_CHANNELS.setSettings, (event, value): UpdateSettings => {
    allowed(event)
    const patch = value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
    const current = settings.get().updates
    return settings.set({
      updates: {
        checkAutomatically:
          typeof patch.checkAutomatically === 'boolean'
            ? patch.checkAutomatically
            : current.checkAutomatically
      }
    }).updates
  })
  ipc.handle(UPDATE_CHANNELS.check, (event, value) => {
    allowed(event)
    return service.check(origin(value))
  })
  ipc.handle(UPDATE_CHANNELS.download, (event) => {
    allowed(event)
    return service.download()
  })
  ipc.handle(UPDATE_CHANNELS.install, (event) => {
    allowed(event)
    return service.install()
  })
}
