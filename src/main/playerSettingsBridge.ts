// Player-settings IPC bridge: exposes the `player` settings block
// (keybindings, skip amount, popup/subtitle display — the Options menu's
// contents) over IPC so the renderer persists them via settings.json instead
// of localStorage. Mirrors knowledgeBridge.ts's registerXBridge + createXService
// pattern (AGENTS.md law 3).

import { PLAYER_SETTINGS_CHANNELS } from '../shared/ipcChannels'
import type { PlayerSettings } from '../shared/playerSettings'
import type { IpcMainHandleLike } from './ipc'
import type { SettingsStore } from './services/settings'

/** The slice of the player-settings service this bridge needs (fakeable in tests). */
export interface PlayerSettingsServiceLike {
  getSettings(): PlayerSettings
  setSettings(patch: Partial<PlayerSettings>): PlayerSettings
  /** Creates (if needed) and reveals Kizuna's mpv config folder. Resolves the
   * `shell.openPath` result string (empty on success). */
  openMpvConfigDir(): Promise<string>
}

/**
 * Registers the player-settings command channels against the ipcMain-like
 * object, forwarding each call to `service`.
 */
export function registerPlayerSettingsBridge<E>(
  ipc: IpcMainHandleLike<E>,
  service: PlayerSettingsServiceLike
): void {
  ipc.handle(PLAYER_SETTINGS_CHANNELS.getSettings, () => service.getSettings())
  ipc.handle(PLAYER_SETTINGS_CHANNELS.setSettings, (_e, patch) => service.setSettings(patch))
  ipc.handle(PLAYER_SETTINGS_CHANNELS.openMpvConfigDir, () => service.openMpvConfigDir())
}

export interface CreatePlayerSettingsServiceDeps {
  settings: SettingsStore
  /** Creates+reveals the mpv config folder; injected so tests fake the
   * fs/shell side effects (see `createMpvConfigManager`). */
  openMpvConfigDir: () => Promise<string>
}

/** Composes the settings store into a `PlayerSettingsServiceLike`. */
export function createPlayerSettingsService(
  deps: CreatePlayerSettingsServiceDeps
): PlayerSettingsServiceLike {
  return {
    getSettings(): PlayerSettings {
      return deps.settings.get().player
    },
    setSettings(patch: Partial<PlayerSettings>): PlayerSettings {
      const current = deps.settings.get().player
      const updated = deps.settings.set({ player: { ...current, ...patch } })
      return updated.player
    },
    openMpvConfigDir(): Promise<string> {
      return deps.openMpvConfigDir()
    }
  }
}
