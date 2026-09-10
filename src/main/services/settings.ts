// JSON settings store. Pure merge/select logic is split from I/O so it's
// unit-testable without touching real disk; the store is handed an
// injected `{ read, write }` boundary, mirroring the Exec-injection pattern
// used by mecab/runner.ts.

import {
  DEFAULT_PLAYER_SETTINGS,
  normalizeAppearance,
  normalizeAudioDevice,
  normalizeKeyBindings,
  normalizeLevelColors,
  normalizeMpvExtraArgs,
  normalizePopupSettings,
  normalizeStartupBehavior,
  normalizeSubtitleAutoPauseScope,
  normalizeSubtitleAutoPauseTiming,
  normalizeSubtitleStyle,
  normalizeVideoAdjustments,
  subtitleOffsetKey,
  type PlayerSettings
} from '../../shared/playerSettings'
import { defaultAnkiSettings, mergeAnkiSettings, type AnkiSettings } from '../../shared/anki'
import {
  normalizeMediaHistory,
  mediaPathKey,
  normalizeMediaPath,
  type MediaHistory,
  type PathNormalizationOptions
} from '../../shared/mediaHistory'
import {
  MAX_JIMAKU_FOLDER_HINTS,
  type JimakuFolderHint,
  type JimakuFolderHintInput
} from '../../shared/jimaku'
import { DEFAULT_KNOWLEDGE_TUNING, type KnowledgeTuning } from '../../shared/knowledge'
import type { UpdateSettings } from '../../shared/update'
import {
  DEFAULT_GAME_OCR_SETTINGS,
  normalizeGameOcrShortcut,
  type GameOcrSettings
} from '../../shared/gameOcrSettings'
import { pathApiFor } from '../platformPath'

export interface KnowledgeSettings extends KnowledgeTuning {
  wanikaniTokenEnc: string
}

export interface TranslationSettings {
  azureSubscriptionKeyEnc: string
  azureRegion: string
}

export interface JimakuSettings {
  apiKeyEnc: string
  folderHints: Record<string, JimakuFolderHint>
}

export interface Settings {
  mecabDictId: 'ipadic' | 'unidic'
  dictOrder: number[]
  anki: AnkiSettings
  knowledge: KnowledgeSettings
  updates: UpdateSettings
  player: PlayerSettings
  gameOcr: GameOcrSettings
  translation: TranslationSettings
  jimaku: JimakuSettings
  mediaHistory: MediaHistory
}

export const defaultKnowledgeSettings: KnowledgeSettings = {
  wanikaniTokenEnc: '',
  ...DEFAULT_KNOWLEDGE_TUNING
}

export const defaultUpdateSettings: UpdateSettings = {
  checkAutomatically: true
}

export const defaultTranslationSettings: TranslationSettings = {
  azureSubscriptionKeyEnc: '',
  azureRegion: ''
}

export const defaultJimakuSettings: JimakuSettings = {
  apiKeyEnc: '',
  folderHints: {}
}

export const defaultSettings: Settings = {
  mecabDictId: 'ipadic',
  dictOrder: [],
  anki: defaultAnkiSettings,
  knowledge: defaultKnowledgeSettings,
  updates: defaultUpdateSettings,
  player: DEFAULT_PLAYER_SETTINGS,
  gameOcr: DEFAULT_GAME_OCR_SETTINGS,
  translation: defaultTranslationSettings,
  jimaku: defaultJimakuSettings,
  mediaHistory: normalizeMediaHistory(undefined)
}

/**
 * Merges arbitrary/untrusted `raw` (parsed JSON, possibly from an older
 * version or corrupted file) into a valid `Settings`, falling back to
 * `defaultSettings` fields for anything missing or malformed. Never throws.
 *
 * `options` forwards path-normalization rules (platform, cwd) to media history
 * and Jimaku folder hints. It defaults to the runtime platform, which is what
 * production wants; tests pass a platform explicitly so both variants are
 * covered on either host.
 */
export function mergeSettings(raw: unknown, options: PathNormalizationOptions = {}): Settings {
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
    updates: mergeUpdateSettings(obj.updates),
    player: mergePlayerSettings(obj.player),
    gameOcr: mergeGameOcrSettings(obj.gameOcr),
    translation: mergeTranslationSettings(obj.translation),
    jimaku: mergeJimakuSettings(obj.jimaku, options),
    mediaHistory: normalizeMediaHistory(obj.mediaHistory, options)
  }
}

function mergeJimakuSettings(raw: unknown, options: PathNormalizationOptions): JimakuSettings {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return {
    apiKeyEnc: typeof obj.apiKeyEnc === 'string' ? obj.apiKeyEnc : defaultJimakuSettings.apiKeyEnc,
    folderHints: normalizeJimakuFolderHints(obj.folderHints, options)
  }
}

const JIMAKU_FOLDER_HINT_KEY_SEPARATOR = '\u0000'
const JIMAKU_FOLDER_HINT_MAX_STRING_LENGTH = 512
const JIMAKU_FOLDER_HINT_MAX_SEASON = 999
const JIMAKU_FOLDER_HINT_MAX_TIMESTAMP = 8_640_000_000_000_000
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/u

/** Returns the canonical key for the media file's immediate parent folder. */
export function jimakuFolderHintKey(
  mediaPath: unknown,
  season: number | undefined,
  options: PathNormalizationOptions = {}
): string | undefined {
  if (!isJimakuSeason(season)) return undefined
  const normalizedPath = normalizeMediaPath(mediaPath, options)
  if (!normalizedPath) return undefined
  const platform =
    options.platform === 'win32'
      ? 'win32'
      : options.platform === 'posix'
        ? 'linux'
        : process.platform
  const folderKey = mediaPathKey(pathApiFor(platform).dirname(normalizedPath), options)
  if (!folderKey) return undefined
  return season === undefined
    ? folderKey
    : `${folderKey}${JIMAKU_FOLDER_HINT_KEY_SEPARATOR}${season}`
}

/** Normalizes persisted folder hints; each malformed record is dropped alone. */
export function normalizeJimakuFolderHints(
  raw: unknown,
  options: PathNormalizationOptions = {}
): Record<string, JimakuFolderHint> {
  if (!isRecord(raw)) return {}
  const hints: Record<string, JimakuFolderHint> = {}
  for (const [rawKey, value] of Object.entries(raw)) {
    const key = parseJimakuFolderHintKey(rawKey, options)
    const hint = normalizeJimakuFolderHint(value)
    if (!key || !hint || hint.season !== key.season) continue
    hints[key.key] = hint
  }
  return pruneJimakuFolderHints(hints)
}

export function normalizeJimakuFolderHint(value: unknown): JimakuFolderHint | undefined {
  if (!isRecord(value)) return undefined
  if (!isPositiveSafeInteger(value.entryId)) return undefined
  const name = normalizeJimakuHintString(value.name)
  if (!name) return undefined
  const englishName = optionalJimakuHintString(value.englishName)
  const japaneseName = optionalJimakuHintString(value.japaneseName)
  if (
    (value.englishName !== undefined && !englishName) ||
    (value.japaneseName !== undefined && !japaneseName) ||
    !isJimakuFolderHintCategory(value.category) ||
    !isJimakuSeason(value.season) ||
    !isJimakuTimestamp(value.updatedAt)
  )
    return undefined

  return {
    entryId: value.entryId,
    name,
    ...(englishName ? { englishName } : {}),
    ...(japaneseName ? { japaneseName } : {}),
    category: value.category,
    ...(value.season === undefined ? {} : { season: value.season }),
    updatedAt: value.updatedAt
  }
}

function parseJimakuFolderHintKey(
  rawKey: string,
  options: PathNormalizationOptions
): { key: string; season?: number } | undefined {
  const separator = rawKey.lastIndexOf(JIMAKU_FOLDER_HINT_KEY_SEPARATOR)
  const folder = separator < 0 ? rawKey : rawKey.slice(0, separator)
  const seasonText = separator < 0 ? undefined : rawKey.slice(separator + 1)
  const season =
    seasonText === undefined
      ? undefined
      : /^(?:0|[1-9]\d{0,2})$/u.test(seasonText)
        ? Number(seasonText)
        : undefined
  if (seasonText !== undefined && season === undefined) return undefined
  const folderKey = mediaPathKey(folder, options)
  if (!folderKey) return undefined
  return {
    key:
      season === undefined ? folderKey : `${folderKey}${JIMAKU_FOLDER_HINT_KEY_SEPARATOR}${season}`,
    ...(season === undefined ? {} : { season })
  }
}

function pruneJimakuFolderHints(
  hints: Record<string, JimakuFolderHint>
): Record<string, JimakuFolderHint> {
  const result: Record<string, JimakuFolderHint> = {}
  const recent = Object.entries(hints)
    .sort(([leftKey, left], [rightKey, right]) => {
      if (left.updatedAt !== right.updatedAt) return right.updatedAt - left.updatedAt
      return leftKey < rightKey ? -1 : leftKey > rightKey ? 1 : 0
    })
    .slice(0, MAX_JIMAKU_FOLDER_HINTS)
  for (const [key, hint] of recent) result[key] = hint
  return result
}

function normalizeJimakuHintString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const normalized = value.trim()
  return normalized !== '' &&
    normalized.length <= JIMAKU_FOLDER_HINT_MAX_STRING_LENGTH &&
    !CONTROL_CHARACTERS.test(normalized)
    ? normalized
    : undefined
}

function optionalJimakuHintString(value: unknown): string | undefined {
  return value === undefined ? undefined : normalizeJimakuHintString(value)
}

function isJimakuFolderHintCategory(value: unknown): value is JimakuFolderHintInput['category'] {
  return value === 'anime' || value === 'liveAction'
}

function isJimakuSeason(value: unknown): value is number | undefined {
  return (
    value === undefined ||
    (typeof value === 'number' &&
      Number.isSafeInteger(value) &&
      value >= 0 &&
      value <= JIMAKU_FOLDER_HINT_MAX_SEASON)
  )
}

function isJimakuTimestamp(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 0 &&
    value <= JIMAKU_FOLDER_HINT_MAX_TIMESTAMP
  )
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function mergeTranslationSettings(raw: unknown): TranslationSettings {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return {
    azureSubscriptionKeyEnc:
      typeof obj.azureSubscriptionKeyEnc === 'string'
        ? obj.azureSubscriptionKeyEnc
        : defaultTranslationSettings.azureSubscriptionKeyEnc,
    azureRegion:
      typeof obj.azureRegion === 'string'
        ? obj.azureRegion.trim()
        : defaultTranslationSettings.azureRegion
  }
}

function mergeGameOcrSettings(raw: unknown): GameOcrSettings {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return {
    captureShortcut: normalizeGameOcrShortcut(obj.captureShortcut)
  }
}

function mergeUpdateSettings(raw: unknown): UpdateSettings {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return {
    checkAutomatically:
      typeof obj.checkAutomatically === 'boolean'
        ? obj.checkAutomatically
        : defaultUpdateSettings.checkAutomatically
  }
}

/** Deep-merges `raw.player` against `DEFAULT_PLAYER_SETTINGS`; never throws. */
function mergePlayerSettings(raw: unknown): PlayerSettings {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}

  return {
    startupBehavior: normalizeStartupBehavior(obj.startupBehavior),
    keyBindings: normalizeKeyBindings(obj.keyBindings),
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
    subtitleAutoPauseTiming: normalizeSubtitleAutoPauseTiming(obj.subtitleAutoPauseTiming),
    subtitleAutoPauseScope: normalizeSubtitleAutoPauseScope(obj.subtitleAutoPauseScope),
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
        : DEFAULT_PLAYER_SETTINGS.loudnessNormalization
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
export function createSettingsStore(
  io: SettingsIO,
  options: PathNormalizationOptions = {}
): SettingsStore {
  let current: Settings = mergeSettings(safeParse(io.read()), options)

  return {
    get(): Settings {
      return current
    },
    set(patch: Partial<Settings>): Settings {
      const next = mergeSettings({ ...current, ...patch }, options)
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
