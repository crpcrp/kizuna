import { APP_SHELL_CHANNELS } from '../shared/ipcChannels'
import type { AppSurface } from '../shared/appShell'
import type { IpcMainLike } from './ipc'
import type { AppShellCoordinator } from './services/appShell'

export interface AppShellBridgeEvent {
  sender: unknown
}

/** Registers the renderer-facing application-surface commands. */
export function registerAppShellBridge<
  E extends AppShellBridgeEvent,
  I extends AppShellBridgeEvent
>(
  ipc: IpcMainLike<E, I>,
  coordinator: AppShellCoordinator,
  isAllowedSender: (sender: E['sender'] | I['sender']) => boolean
): void {
  const allowed = (sender: E['sender'] | I['sender']): void => {
    if (!isAllowedSender(sender)) throw new Error('App shell request came from an unknown window.')
  }

  ipc.handle(APP_SHELL_CHANNELS.getSurface, (event): AppSurface => {
    allowed(event.sender)
    return coordinator.getSurface()
  })
  ipc.handle(APP_SHELL_CHANNELS.showSplash, (event): Promise<AppSurface> => {
    allowed(event.sender)
    return coordinator.showSplash()
  })
  ipc.handle(APP_SHELL_CHANNELS.showPlayer, (event): Promise<AppSurface> => {
    allowed(event.sender)
    return coordinator.showPlayer()
  })
  ipc.handle(APP_SHELL_CHANNELS.showOptions, (event): Promise<AppSurface> => {
    allowed(event.sender)
    return coordinator.showOptions()
  })
  ipc.handle(APP_SHELL_CHANNELS.dismissOptions, (event): Promise<AppSurface> => {
    allowed(event.sender)
    return coordinator.dismissOptions()
  })
  ipc.on(APP_SHELL_CHANNELS.quit, (event) => {
    allowed(event.sender)
    coordinator.quit()
  })
}
