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
  type PlayerSettings
} from '../../shared/playerSettings'
import { defaultAnkiSettings, mergeAnkiSettings, type AnkiSettings } from '../../shared/anki'
import {
  mediaPathKey,
  normalizeMediaPath,
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
import { isRecord, isPositiveSafeInteger } from '../../shared/guards'

const asRecord = (raw: unknown): Record<string, unknown> => (isRecord(raw) ? raw : {})
const boolOr = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback
const stringOr = (value: unknown, fallback: string): string =>
  typeof value === 'string' ? value : fallback

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
  jimaku: defaultJimakuSettings
}

/**
 * Merges arbitrary/untrusted `raw` (parsed JSON, possibly from an older
 * version or corrupted file) into a valid `Settings`, falling back to
 * `defaultSettings` fields for anything missing or malformed. Never throws.
 *
 * `options` forwards path-normalization rules (platform, cwd) to Jimaku folder
 * hints. Playback history lives in its own store (see mediaHistoryStore.ts);
 * a legacy `mediaHistory` key is dropped here. It defaults to the runtime platform, which is what
 * production wants; tests pass a platform explicitly so both variants are
 * covered on either host.
 */
export function mergeSettings(raw: unknown, options: PathNormalizationOptions = {}): Settings {
  const obj = asRecord(raw)

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
    jimaku: mergeJimakuSettings(obj.jimaku, options)
  }
}

function mergeJimakuSettings(raw: unknown, options: PathNormalizationOptions): JimakuSettings {
  const obj = asRecord(raw)
  return {
    apiKeyEnc: stringOr(obj.apiKeyEnc, defaultJimakuSettings.apiKeyEnc),
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

function mergeTranslationSettings(raw: unknown): TranslationSettings {
  const obj = asRecord(raw)
  return {
    azureSubscriptionKeyEnc: stringOr(
      obj.azureSubscriptionKeyEnc,
      defaultTranslationSettings.azureSubscriptionKeyEnc
    ),
    azureRegion: stringOr(obj.azureRegion, defaultTranslationSettings.azureRegion).trim()
  }
}

function mergeGameOcrSettings(raw: unknown): GameOcrSettings {
  const obj = asRecord(raw)
  return {
    captureShortcut: normalizeGameOcrShortcut(obj.captureShortcut)
  }
}

function mergeUpdateSettings(raw: unknown): UpdateSettings {
  const obj = asRecord(raw)
  return {
    checkAutomatically: boolOr(obj.checkAutomatically, defaultUpdateSettings.checkAutomatically)
  }
}

/** Deep-merges `raw.player` against `DEFAULT_PLAYER_SETTINGS`; never throws. */
function mergePlayerSettings(raw: unknown): PlayerSettings {
  const obj = asRecord(raw)

  return {
    startupBehavior: normalizeStartupBehavior(obj.startupBehavior),
    keyBindings: normalizeKeyBindings(obj.keyBindings),
    skipSeconds: positiveNumberOr(obj.skipSeconds, DEFAULT_PLAYER_SETTINGS.skipSeconds),
    popupSettings: normalizePopupSettings(obj.popupSettings, DEFAULT_PLAYER_SETTINGS.popupSettings),
    subtitleStyle: normalizeSubtitleStyle(obj.subtitleStyle, DEFAULT_PLAYER_SETTINGS.subtitleStyle),
    subtitleDragEnabled: boolOr(
      obj.subtitleDragEnabled,
      DEFAULT_PLAYER_SETTINGS.subtitleDragEnabled
    ),
    rightClickTogglePause: boolOr(
      obj.rightClickTogglePause,
      DEFAULT_PLAYER_SETTINGS.rightClickTogglePause
    ),
    autoPlayNext: boolOr(obj.autoPlayNext, DEFAULT_PLAYER_SETTINGS.autoPlayNext),
    subtitleAutoPauseTiming: normalizeSubtitleAutoPauseTiming(obj.subtitleAutoPauseTiming),
    subtitleAutoPauseScope: normalizeSubtitleAutoPauseScope(obj.subtitleAutoPauseScope),
    subtitleOffsets: mergeOffsetMap(obj.subtitleOffsets),
    folderSubtitleOffsets: mergeOffsetMap(obj.folderSubtitleOffsets),
    audioDelays: mergeOffsetMap(obj.audioDelays),
    appearance: normalizeAppearance(obj.appearance, DEFAULT_PLAYER_SETTINGS.appearance),
    sidebarOpen: boolOr(obj.sidebarOpen, DEFAULT_PLAYER_SETTINGS.sidebarOpen),
    playlistOpen: boolOr(obj.playlistOpen, DEFAULT_PLAYER_SETTINGS.playlistOpen),
    translationEnabled: boolOr(obj.translationEnabled, DEFAULT_PLAYER_SETTINGS.translationEnabled),
    levelColors: normalizeLevelColors(obj.levelColors),
    screenshotFolder:
      typeof obj.screenshotFolder === 'string' && obj.screenshotFolder.trim() !== ''
        ? obj.screenshotFolder
        : DEFAULT_PLAYER_SETTINGS.screenshotFolder,
    mpvUserConfig: boolOr(obj.mpvUserConfig, DEFAULT_PLAYER_SETTINGS.mpvUserConfig),
    mpvExtraArgs: normalizeMpvExtraArgs(obj.mpvExtraArgs),
    videoAdjustments: normalizeVideoAdjustments(
      obj.videoAdjustments,
      DEFAULT_PLAYER_SETTINGS.videoAdjustments
    ),
    audioDevice: normalizeAudioDevice(obj.audioDevice),
    loudnessNormalization: boolOr(
      obj.loudnessNormalization,
      DEFAULT_PLAYER_SETTINGS.loudnessNormalization
    )
  }
}

/** Deep-merges `raw` into an offset map (`Record<string, number>`, ms);
 * non-numeric/non-finite entries are dropped rather than falling back
 * wholesale, so one corrupted entry doesn't discard every other file's stored
 * offset. Serves `subtitleOffsets`, `folderSubtitleOffsets`, and `audioDelays`. */
function mergeOffsetMap(raw: unknown): Record<string, number> {
  if (!isRecord(raw)) return {}
  const result: Record<string, number> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'number' && Number.isFinite(value)) result[key] = value
  }
  return result
}

/** Deep-merges `raw.knowledge` against `defaultKnowledgeSettings`; never throws. */
function mergeKnowledgeSettings(raw: unknown): KnowledgeSettings {
  const obj = asRecord(raw)

  return {
    wanikaniTokenEnc: stringOr(obj.wanikaniTokenEnc, defaultKnowledgeSettings.wanikaniTokenEnc),
    ankiKnownDecks:
      Array.isArray(obj.ankiKnownDecks) && obj.ankiKnownDecks.every((d) => typeof d === 'string')
        ? (obj.ankiKnownDecks as string[])
        : defaultKnowledgeSettings.ankiKnownDecks,
    ankiKnownField: stringOr(obj.ankiKnownField, defaultKnowledgeSettings.ankiKnownField),
    knownIntervalDays: positiveNumberOr(
      obj.knownIntervalDays,
      defaultKnowledgeSettings.knownIntervalDays
    ),
    wellKnownIntervalDays: positiveNumberOr(
      obj.wellKnownIntervalDays,
      defaultKnowledgeSettings.wellKnownIntervalDays
    ),
    coloringEnabled: boolOr(obj.coloringEnabled, defaultKnowledgeSettings.coloringEnabled),
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
  /**
   * Merges `patch` into memory and tries to persist it. Never throws: a failed
   * write is reported through `onWriteError` and retried on the next `set` or
   * `flush`.
   */
  set(patch: Partial<Settings>): Settings
  /** Retries a pending failed write. Returns true when nothing is left unsaved. */
  flush(): boolean
  /** True while the in-memory settings differ from the last successful write. */
  hasPendingWrite(): boolean
}

export interface SettingsStoreOptions extends PathNormalizationOptions {
  /** Called once per run of consecutive write failures. Defaults to `console.warn`. */
  onWriteError?: (error: unknown) => void
}

function defaultOnWriteError(error: unknown): void {
  console.warn('[kizuna] failed to save settings; will retry', error)
}

/**
 * Creates a settings store backed by the injected `io`. Reads+merges once at
 * construction (so a missing/garbage file never throws); every `set` persists
 * the full merged settings via `io.write(JSON.stringify(...))`.
 */
export function createSettingsStore(
  io: SettingsIO,
  options: SettingsStoreOptions = {}
): SettingsStore {
  const { onWriteError = defaultOnWriteError, ...pathOptions } = options
  let current: Settings = mergeSettings(safeParse(io.read()), pathOptions)
  let pending = false
  let failureReported = false

  function write(): boolean {
    try {
      io.write(JSON.stringify(current))
      pending = false
      failureReported = false
      return true
    } catch (error) {
      pending = true
      if (!failureReported) {
        failureReported = true
        try {
          onWriteError(error)
        } catch {
          // Reporting must never turn a failed write back into a throw.
        }
      }
      return false
    }
  }

  return {
    get(): Settings {
      return current
    },
    set(patch: Partial<Settings>): Settings {
      current = mergeSettings({ ...current, ...patch }, pathOptions)
      write()
      return current
    },
    flush(): boolean {
      return pending ? write() : true
    },
    hasPendingWrite(): boolean {
      return pending
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
