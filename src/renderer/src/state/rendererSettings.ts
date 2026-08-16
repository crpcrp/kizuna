// The single source of truth for which persisted settings the renderer's
// reducer owns and `useSettingsLifecycle` loads and saves automatically, plus
// the pure select/diff helpers that path is built from. Adding a reducer-backed
// setting means adding its key to `SYNCED_SETTING_KEYS` here — nothing else in
// the renderer repeats the list.

import type { PlayerSettings } from '../../../shared/playerSettings'

/**
 * The `PlayerSettings` fields that live in `PlayerState` and are hydrated on
 * mount and written back whenever the reducer changes them. Every key must also
 * be a `PlayerState` field of the same type, which `useSettingsLifecycle`'s
 * `settings` input enforces at the call site in `App.tsx`.
 */
export const SYNCED_SETTING_KEYS = [
  'keyBindings',
  'startupBehavior',
  'skipSeconds',
  'popupSettings',
  'subtitleStyle',
  'subtitleDragEnabled',
  'rightClickTogglePause',
  'autoPlayNext',
  'subtitleAutoPauseTiming',
  'appearance',
  'levelColors',
  'screenshotFolder',
  'mpvUserConfig',
  'mpvExtraArgs',
  'videoAdjustments',
  'audioDevice',
  'loudnessNormalization'
] as const satisfies readonly (keyof PlayerSettings)[]

/**
 * The persisted settings deliberately kept out of the automatic path, and who
 * writes each one instead:
 *
 * - `subtitleOffsets`, `folderSubtitleOffsets`, `audioDelays`: per-file maps
 *   held in refs (not the reducer) and scheduled by `usePlaybackWindow` when
 *   the current file's value changes.
 * - `sidebarOpen`, `playlistOpen`: panel visibility held in `App.tsx`
 *   `useState` and scheduled by `usePlaybackWindow`'s toggles.
 * - `translationEnabled`: reducer-backed, but scheduled by the Options row in
 *   `optionsMenuProps.ts` so the toggle writes on the spot.
 *
 * Listed so every `PlayerSettings` field has one named owner; the settings
 * test asserts the two lists together cover the whole type.
 */
export const EXTERNALLY_PERSISTED_SETTING_KEYS = [
  'subtitleOffsets',
  'folderSubtitleOffsets',
  'audioDelays',
  'sidebarOpen',
  'playlistOpen',
  'translationEnabled'
] as const satisfies readonly (keyof PlayerSettings)[]

export type SyncedSettingKey = (typeof SYNCED_SETTING_KEYS)[number]

/** The automatically synchronized slice of `PlayerSettings`. `PlayerState`
 * satisfies it structurally, so the lifecycle can select from either. */
export type RendererSettings = Pick<PlayerSettings, SyncedSettingKey>

/** What `loadSettings` applies to the reducer: the synchronized slice plus
 * `translationEnabled`, which the reducer holds even though the Options row
 * owns its writes. */
export type LoadedRendererSettings = RendererSettings & Pick<PlayerSettings, 'translationEnabled'>

/** Copies just the synchronized fields out of a `PlayerState` or a loaded
 * `PlayerSettings`, so a snapshot can never carry an unrelated field. */
export function selectRendererSettings(source: RendererSettings): RendererSettings {
  const selected: Partial<RendererSettings> = {}
  for (const key of SYNCED_SETTING_KEYS) {
    // Per-key the value and the target field share a type, but the loop widens
    // both to unions TypeScript cannot pair up again.
    ;(selected as Record<string, unknown>)[key] = source[key]
  }
  return selected as RendererSettings
}

/** The reducer payload for a freshly-loaded `settings.json`. */
export function selectLoadedRendererSettings(settings: PlayerSettings): LoadedRendererSettings {
  return {
    ...selectRendererSettings(settings),
    translationEnabled: settings.translationEnabled
  }
}

/** True when two settings values differ by content, not just by reference — a
 * freshly-parsed `settings.json` never shares object/array identity with the
 * in-memory defaults it happens to match (e.g. both an empty `levelColors`), so
 * a plain `!==` would wrongly treat "just loaded, nothing the user touched" as
 * a change worth re-saving. */
export function settingsFieldChanged<T>(previous: T, next: T): boolean {
  return previous !== next && JSON.stringify(previous) !== JSON.stringify(next)
}

/** The patch to persist for `next`, holding only the synchronized fields whose
 * content changed since `previous`. Empty when nothing did. */
export function rendererSettingsPatch(
  next: RendererSettings,
  previous: RendererSettings
): Partial<RendererSettings> {
  const patch: Partial<RendererSettings> = {}
  for (const key of SYNCED_SETTING_KEYS) {
    if (settingsFieldChanged(previous[key], next[key])) {
      ;(patch as Record<string, unknown>)[key] = next[key]
    }
  }
  return patch
}
