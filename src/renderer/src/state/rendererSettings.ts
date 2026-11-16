import type { PlayerSettings } from '../../../shared/playerSettings'

const SYNCED_SETTING_KEYS = [
  'keyBindings',
  'startupBehavior',
  'skipSeconds',
  'popupSettings',
  'subtitleStyle',
  'subtitleDragEnabled',
  'rightClickTogglePause',
  'autoPlayNext',
  'subtitleAutoPauseTiming',
  'subtitleAutoPauseScope',
  'appearance',
  'levelColors',
  'screenshotFolder',
  'mpvUserConfig',
  'mpvExtraArgs',
  'videoAdjustments',
  'audioDevice',
  'loudnessNormalization'
] as const satisfies readonly (keyof PlayerSettings)[]

// Per-file maps and panel visibility are persisted by usePlaybackWindow.
// translationEnabled is persisted directly by the Options dialog.

export type SyncedSettingKey = (typeof SYNCED_SETTING_KEYS)[number]

export type RendererSettings = Pick<PlayerSettings, SyncedSettingKey>

// The reducer hydrates translationEnabled, but the Options dialog owns its writes.
export type LoadedRendererSettings = RendererSettings & Pick<PlayerSettings, 'translationEnabled'>

export function selectRendererSettings(source: RendererSettings): RendererSettings {
  const selected: Partial<RendererSettings> = {}
  for (const key of SYNCED_SETTING_KEYS) {
    copySetting(selected, source, key)
  }
  return selected as RendererSettings
}

export function selectLoadedRendererSettings(settings: PlayerSettings): LoadedRendererSettings {
  return {
    ...selectRendererSettings(settings),
    translationEnabled: settings.translationEnabled
  }
}

// Parsed settings have fresh object identities; compare content to avoid rewriting unchanged values.
function settingsFieldChanged<T>(previous: T, next: T): boolean {
  return previous !== next && JSON.stringify(previous) !== JSON.stringify(next)
}

export function rendererSettingsPatch(
  next: RendererSettings,
  previous: RendererSettings
): Partial<RendererSettings> {
  const patch: Partial<RendererSettings> = {}
  for (const key of SYNCED_SETTING_KEYS) {
    if (settingsFieldChanged(previous[key], next[key])) {
      copySetting(patch, next, key)
    }
  }
  return patch
}

function copySetting<K extends SyncedSettingKey>(
  target: Partial<RendererSettings>,
  source: RendererSettings,
  key: K
): void {
  target[key] = source[key]
}
