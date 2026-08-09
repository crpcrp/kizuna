import { UPDATE_CHANNELS } from '../shared/ipcChannels'
import type { UpdateCheckOrigin, UpdateState } from '../shared/update'
import type { IpcMainHandleLike } from './ipc'
import type { UpdateService } from './updateService'

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
