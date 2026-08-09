import { APP_INFO_CHANNELS } from '../shared/ipcChannels'
import {
  APP_INFO_LINKS,
  createAppInfo,
  type AppInfo,
  type AppInfoLink,
  type AppInfoMetadata,
  type NoticeOpenResult
} from '../shared/appInfo'
import type { IpcMainHandleLike } from './ipc'

/** Main-side app-information service exposed through the narrow preload API. */
export interface AppInfoServiceLike {
  get(): AppInfo
  /** Accepts unknown at the IPC boundary so runtime validation cannot be skipped. */
  openLink(link: unknown): Promise<void>
  openNotices(): Promise<NoticeOpenResult>
}

export interface CreateAppInfoServiceDeps {
  /** Electron's runtime version; do not replace with a renderer/package constant. */
  getVersion: () => string
  metadata: AppInfoMetadata
  noticesPath: string
  exists: (path: string) => boolean
  openExternal: (url: string) => Promise<void>
  /** Electron's shell.openPath returns an empty string on success. */
  openPath: (path: string) => Promise<string>
}

function urlForLink(link: unknown): string {
  if (typeof link !== 'string' || !Object.prototype.hasOwnProperty.call(APP_INFO_LINKS, link)) {
    throw new Error('Unsupported About-dialog link.')
  }
  return APP_INFO_LINKS[link as AppInfoLink]
}

/** Composes runtime app metadata with the approved shell destinations. */
export function createAppInfoService(deps: CreateAppInfoServiceDeps): AppInfoServiceLike {
  return {
    get(): AppInfo {
      return createAppInfo(deps.getVersion(), deps.metadata)
    },
    async openLink(link: unknown): Promise<void> {
      await deps.openExternal(urlForLink(link))
    },
    async openNotices(): Promise<NoticeOpenResult> {
      if (!deps.exists(deps.noticesPath)) {
        return {
          status: 'unavailable',
          message: 'Third-party notices are not available. Run "npm run notices" first.'
        }
      }
      try {
        const error = await deps.openPath(deps.noticesPath)
        return error === ''
          ? { status: 'opened' }
          : { status: 'error', message: `Could not open third-party notices: ${error}` }
      } catch {
        return { status: 'error', message: 'Could not open third-party notices.' }
      }
    }
  }
}

/** Registers app-information commands against an ipcMain-like object. */
export function registerAppInfoBridge<E>(
  ipc: IpcMainHandleLike<E>,
  service: AppInfoServiceLike
): void {
  ipc.handle(APP_INFO_CHANNELS.get, () => service.get())
  ipc.handle(APP_INFO_CHANNELS.openLink, (_event, link) => service.openLink(link))
  ipc.handle(APP_INFO_CHANNELS.openNotices, () => service.openNotices())
}
