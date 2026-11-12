import type { Shell } from 'electron'
import { registerJimakuBridge } from '../jimakuBridge'
import { registerJimakuSettingsBridge } from '../jimakuSettingsBridge'
import { showSaveFileDialog } from '../media/mediaPicker'
import { httpFetch } from '../services/http'
import { createJimakuArchiveService } from '../services/jimaku/archive'
import { createJimakuClient } from '../services/jimaku/client'
import { createJimakuDownloadStore } from '../services/jimaku/downloadStore'
import { createJimakuService, type JimakuService } from '../services/jimaku/service'
import {
  createJimakuSettingsService,
  type JimakuSettingsService
} from '../services/jimaku/settings'
import type { MediaHistoryService } from '../services/mediaHistory'
import type { BootstrapDeps } from './deps'

/**
 * Registers the Jimaku settings and search/download bridges and starts a
 * one-off cleanup of cached downloads that history no longer references.
 */
export function startJimaku(
  deps: Pick<BootstrapDeps, 'ipcMain' | 'settings' | 'secrets' | 'paths'> & {
    mediaHistory: MediaHistoryService
    shell: Shell
  }
): JimakuService {
  const { ipcMain, mediaHistory } = deps
  const client = createJimakuClient({
    getApiKey: () => jimakuSettings.getApiKey(),
    fetch: httpFetch
  })
  const jimakuSettings: JimakuSettingsService = createJimakuSettingsService({
    settings: deps.settings,
    secrets: deps.secrets,
    client
  })
  const downloads = createJimakuDownloadStore({
    fetch: httpFetch,
    cacheRoot: deps.paths.jimakuCacheRoot
  })
  const archive = createJimakuArchiveService({ downloads })
  const service = createJimakuService({
    client,
    settings: jimakuSettings,
    downloads,
    archive,
    mediaHistory,
    subtitleExport: { showSaveDialog: showSaveFileDialog },
    openExternal: (url) => deps.shell.openExternal(url)
  })
  registerJimakuSettingsBridge(ipcMain, jimakuSettings)
  registerJimakuBridge(ipcMain, service)
  void downloads.cleanup(mediaHistory.getProtectedJimakuPaths())
  return service
}
