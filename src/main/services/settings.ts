// JSON settings store. Pure merge/select logic is split from I/O so it's
// unit-testable without touching real disk; the store is handed an
// injected `{ read, write }` boundary, mirroring the Exec-injection pattern
// used by mecab/runner.ts.

import {
  DEFAULT_PLAYER_SETTINGS,
  normalizeAppearance,
  normalizeAudioDevice,
  normalizeKeyBinding,
  normalizeLevelColors,
  normalizeMpvExtraArgs,
  normalizePopupSettings,
  normalizePreferredUrlSubtitleLanguage,
  normalizeSubtitleStyle,
  normalizeVideoAdjustments,
  subtitleOffsetKey,
  type KeyBindings,
  type PlayerSettings
} from '../../shared/playerSettings'
import { defaultAnkiSettings, mergeAnkiSettings, type AnkiSettings } from '../../shared/anki'
import { normalizeMediaHistory, type MediaHistory } from '../../shared/mediaHistory'
import { DEFAULT_KNOWLEDGE_TUNING, type KnowledgeTuning } from '../../shared/knowledge'

export interface KnowledgeSettings extends KnowledgeTuning {
  wanikaniTokenEnc: string
}

export interface Settings {
  mecabDictId: 'ipadic' | 'unidic'
  dictOrder: number[]
  anki: AnkiSettings
  knowledge: KnowledgeSettings
  player: PlayerSettings
  mediaHistory: MediaHistory
}

export const defaultKnowledgeSettings: KnowledgeSettings = {
  wanikaniTokenEnc: '',
  ...DEFAULT_KNOWLEDGE_TUNING
}

export const defaultSettings: Settings = {
  mecabDictId: 'ipadic',
  dictOrder: [],
  anki: defaultAnkiSettings,
  knowledge: defaultKnowledgeSettings,
  player: DEFAULT_PLAYER_SETTINGS,
  mediaHistory: normalizeMediaHistory(undefined)
}

/**
 * Merges arbitrary/untrusted `raw` (parsed JSON, possibly from an older
 * version or corrupted file) into a valid `Settings`, falling back to
 * `defaultSettings` fields for anything missing or malformed. Never throws.
 */
export function mergeSettings(raw: unknown): Settings {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}

  const mecabDictId =
    obj.mecabDictId === 'ipadic' || obj.mecabDictId === 'unidic'
      ? obj.mecabDictId
      : defaultSettings.mecabDictId

  const dictOrder =
    Array.isArray(obj.dictOrder) && obj.dictOrder.every((n) => typeof n === 'number')
      ? (obj.dictOrder as number[])
      : defaultSettings.dictOrder

  return {
    mecabDictId,
    dictOrder,
    anki: mergeAnkiSettings(obj.anki),
    knowledge: mergeKnowledgeSettings(obj.knowledge),
    player: mergePlayerSettings(obj.player),
    mediaHistory: normalizeMediaHistory(obj.mediaHistory)
  }
}

/** Deep-merges `raw.player` against `DEFAULT_PLAYER_SETTINGS`; never throws. */
function mergePlayerSettings(raw: unknown): PlayerSettings {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}

  const rawKeyBindings =
    obj.keyBindings && typeof obj.keyBindings === 'object'
      ? (obj.keyBindings as Record<string, unknown>)
      : {}
  const keyBindings = { ...DEFAULT_PLAYER_SETTINGS.keyBindings } as KeyBindings
  for (const action of Object.keys(keyBindings) as (keyof KeyBindings)[]) {
    const binding = normalizeKeyBinding(rawKeyBindings[action])
    if (binding) keyBindings[action] = binding
  }

  return {
    keyBindings,
    skipSeconds: positiveNumberOr(obj.skipSeconds, DEFAULT_PLAYER_SETTINGS.skipSeconds),
    popupSettings: normalizePopupSettings(obj.popupSettings, DEFAULT_PLAYER_SETTINGS.popupSettings),
    subtitleStyle: normalizeSubtitleStyle(obj.subtitleStyle, DEFAULT_PLAYER_SETTINGS.subtitleStyle),
    subtitleDragEnabled:
      typeof obj.subtitleDragEnabled === 'boolean'
        ? obj.subtitleDragEnabled
        : DEFAULT_PLAYER_SETTINGS.subtitleDragEnabled,
    rightClickTogglePause:
      typeof obj.rightClickTogglePause === 'boolean'
        ? obj.rightClickTogglePause
        : DEFAULT_PLAYER_SETTINGS.rightClickTogglePause,
    autoPlayNext:
      typeof obj.autoPlayNext === 'boolean'
        ? obj.autoPlayNext
        : DEFAULT_PLAYER_SETTINGS.autoPlayNext,
    subtitleOffsets: mergeOffsetMap(obj.subtitleOffsets),
    folderSubtitleOffsets: mergeOffsetMap(obj.folderSubtitleOffsets),
    audioDelays: mergeOffsetMap(obj.audioDelays),
    appearance: normalizeAppearance(obj.appearance, DEFAULT_PLAYER_SETTINGS.appearance),
    sidebarOpen:
      typeof obj.sidebarOpen === 'boolean' ? obj.sidebarOpen : DEFAULT_PLAYER_SETTINGS.sidebarOpen,
    playlistOpen:
      typeof obj.playlistOpen === 'boolean'
        ? obj.playlistOpen
        : DEFAULT_PLAYER_SETTINGS.playlistOpen,
    translationEnabled:
      typeof obj.translationEnabled === 'boolean'
        ? obj.translationEnabled
        : DEFAULT_PLAYER_SETTINGS.translationEnabled,
    levelColors: normalizeLevelColors(obj.levelColors),
    screenshotFolder:
      typeof obj.screenshotFolder === 'string' && obj.screenshotFolder.trim() !== ''
        ? obj.screenshotFolder
        : DEFAULT_PLAYER_SETTINGS.screenshotFolder,
    mpvUserConfig:
      typeof obj.mpvUserConfig === 'boolean'
        ? obj.mpvUserConfig
        : DEFAULT_PLAYER_SETTINGS.mpvUserConfig,
    mpvExtraArgs: normalizeMpvExtraArgs(obj.mpvExtraArgs),
    videoAdjustments: normalizeVideoAdjustments(
      obj.videoAdjustments,
      DEFAULT_PLAYER_SETTINGS.videoAdjustments
    ),
    audioDevice: normalizeAudioDevice(obj.audioDevice),
    loudnessNormalization:
      typeof obj.loudnessNormalization === 'boolean'
        ? obj.loudnessNormalization
        : DEFAULT_PLAYER_SETTINGS.loudnessNormalization,
    preferredUrlSubtitleLanguage: normalizePreferredUrlSubtitleLanguage(
      obj.preferredUrlSubtitleLanguage
    )
  }
}

/** Deep-merges `raw` into a subtitle-offset map (`Record<string, number>`, ms);
 * non-numeric/non-finite entries are dropped rather than falling back
 * wholesale, so one corrupted entry doesn't discard every other file's stored
 * offset. Surviving keys are canonicalized with `subtitleOffsetKey`, which
 * migrates legacy raw-path keys written before canonicalization; two legacy
 * keys that fold to the same canonical key collapse into one entry (last one
 * wins). Serves both `subtitleOffsets` (per-file keys) and
 * `folderSubtitleOffsets` (folder keys — already canonical, since
 * `subtitleOffsetFolderKey` derives them from `subtitleOffsetKey`, so passing
 * them through again is a no-op). Also serves `audioDelays` (per-file ms delays,
 * keyed the same way as `subtitleOffsets`). */
function mergeOffsetMap(raw: unknown): Record<string, number> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const result: Record<string, number> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'number' && Number.isFinite(value)) result[subtitleOffsetKey(key)] = value
  }
  return result
}

/** Deep-merges `raw.knowledge` against `defaultKnowledgeSettings`; never throws. */
function mergeKnowledgeSettings(raw: unknown): KnowledgeSettings {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}

  return {
    wanikaniTokenEnc:
      typeof obj.wanikaniTokenEnc === 'string'
        ? obj.wanikaniTokenEnc
        : defaultKnowledgeSettings.wanikaniTokenEnc,
    ankiKnownDecks:
      Array.isArray(obj.ankiKnownDecks) && obj.ankiKnownDecks.every((d) => typeof d === 'string')
        ? (obj.ankiKnownDecks as string[])
        : defaultKnowledgeSettings.ankiKnownDecks,
    ankiKnownField:
      typeof obj.ankiKnownField === 'string'
        ? obj.ankiKnownField
        : defaultKnowledgeSettings.ankiKnownField,
    knownIntervalDays: positiveNumberOr(
      obj.knownIntervalDays,
      defaultKnowledgeSettings.knownIntervalDays
    ),
    wellKnownIntervalDays: positiveNumberOr(
      obj.wellKnownIntervalDays,
      defaultKnowledgeSettings.wellKnownIntervalDays
    ),
    coloringEnabled:
      typeof obj.coloringEnabled === 'boolean'
        ? obj.coloringEnabled
        : defaultKnowledgeSettings.coloringEnabled,
    staleAfterHours: nonNegativeNumberOr(
      obj.staleAfterHours,
      defaultKnowledgeSettings.staleAfterHours
    )
  }
}

/** Falls back to `fallback` unless `value` is a finite number > 0. */
function positiveNumberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

/** Falls back to `fallback` unless `value` is a finite number >= 0 (0 = "never"). */
function nonNegativeNumberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback
}

/**
 * Pure helper: picks the effective dict id, falling back to `'ipadic'` when
 * `id` isn't among `availableIds` (e.g. UniDic was selected previously but is
 * no longer installed). Kept standalone (not a store method) so it can be
 * reused wherever a dict id needs validating against availability, without
 * needing a store instance.
 */
export function selectDict(id: 'ipadic' | 'unidic', availableIds: string[]): 'ipadic' | 'unidic' {
  return availableIds.includes(id) ? id : 'ipadic'
}

export interface SettingsIO {
  read(): string | undefined
  write(s: string): void
}

export interface SettingsStore {
  get(): Settings
  set(patch: Partial<Settings>): Settings
}

/**
 * Creates a settings store backed by the injected `io`. Reads+merges once at
 * construction (so a missing/garbage file never throws); every `set` persists
 * the full merged settings via `io.write(JSON.stringify(...))`.
 */
export function createSettingsStore(io: SettingsIO): SettingsStore {
  let current: Settings = mergeSettings(safeParse(io.read()))

  return {
    get(): Settings {
      return current
    },
    set(patch: Partial<Settings>): Settings {
      const next = mergeSettings({ ...current, ...patch })
      io.write(JSON.stringify(next))
      current = next
      return next
    }
  }
}

function safeParse(text: string | undefined): unknown {
  if (text === undefined) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}
