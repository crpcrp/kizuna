import { AUTO_AUDIO_DEVICE } from './audioDevice'

/** High-level player action a keyboard shortcut maps to. */
export type PlayerKeyAction =
  | 'togglePause'
  | 'toggleFullscreen'
  | 'exitFullscreen'
  | 'skipBack'
  | 'skipForward'
  | 'speedDown'
  | 'speedUp'
  | 'speedReset'
  | 'replayLine'
  | 'prevLine'
  | 'nextLine'
  | 'loopLine'
  | 'abLoop'
  | 'frameStep'
  | 'frameBack'
  | 'prevFile'
  | 'nextFile'
  | 'prevChapter'
  | 'nextChapter'
  | 'screenshot'
  | 'miniPlayer'

/**
 * Left-side modifier keys a binding may be prefixed with. Only the left-hand
 * Ctrl/Shift are bindable: a `KeyboardEvent` for a non-modifier key reports
 * only *that* Ctrl/Shift is down, never which one, so the side is knowable
 * solely by tracking the modifier's own keydown/keyup (see
 * `createModifierTracker` in the renderer's `keyBindings` module).
 */
export const MODIFIER_CODES = ['ControlLeft', 'ShiftLeft'] as const

export type KeyModifier = (typeof MODIFIER_CODES)[number]

export function isKeyModifier(code: string): code is KeyModifier {
  return (MODIFIER_CODES as readonly string[]).includes(code)
}

/**
 * A key a player action is bound to: a `KeyboardEvent.code`, optionally
 * prefixed with one modifier code — `Space`, `ControlLeft+ArrowUp`,
 * `ShiftLeft+KeyR`. Matching is exact, so a bare `ArrowLeft` binding does *not*
 * fire on Ctrl+ArrowLeft (which is what lets the two be bound separately).
 */
export type KeyBinding = string

/** The binding each action is triggered by. */
export type KeyBindings = Record<PlayerKeyAction, KeyBinding>

export const DEFAULT_KEY_BINDINGS: KeyBindings = {
  togglePause: 'Space',
  toggleFullscreen: 'KeyF',
  exitFullscreen: 'Escape',
  skipBack: 'ArrowLeft',
  skipForward: 'ArrowRight',
  speedDown: 'ControlLeft+ArrowDown',
  speedUp: 'ControlLeft+ArrowUp',
  speedReset: 'Backspace',
  replayLine: 'KeyR',
  prevLine: 'Comma',
  nextLine: 'Period',
  loopLine: 'KeyL',
  abLoop: 'ShiftLeft+KeyL',
  frameStep: 'ShiftLeft+Period',
  frameBack: 'ShiftLeft+Comma',
  prevFile: 'KeyP',
  nextFile: 'KeyN',
  prevChapter: 'ControlLeft+ArrowLeft',
  nextChapter: 'ControlLeft+ArrowRight',
  screenshot: 'KeyS',
  miniPlayer: 'ControlLeft+KeyM'
}

/**
 * Validates one stored binding: a non-empty `code`, or `modifier+code` with a
 * bindable modifier. Returns null for anything else — a non-string, an empty
 * or multi-modifier chord, or a modifier bound on its own (which could never
 * fire, since a lone modifier press produces no binding).
 */
export function normalizeKeyBinding(raw: unknown): KeyBinding | null {
  if (typeof raw !== 'string') return null
  const parts = raw.split('+')
  if (parts.length > 2) return null
  const code = parts[parts.length - 1]
  if (code === '' || isKeyModifier(code)) return null
  if (parts.length === 2 && !isKeyModifier(parts[0])) return null
  return raw
}

/** UI color-scheme preference; 'system' follows the OS via prefers-color-scheme. */
export type Appearance = 'system' | 'light' | 'dark'

export const DEFAULT_APPEARANCE: Appearance = 'system'

/** Validates a stored appearance value, falling back for malformed input. */
export function normalizeAppearance(raw: unknown, fallback: Appearance): Appearance {
  return raw === 'system' || raw === 'light' || raw === 'dark' ? raw : fallback
}

/** Knowledge levels with configurable subtitle/report colors. For the four
 * ordinary levels, an absent key uses the theme color; for `wellKnown`, it
 * means no subtitle underline and a white report swatch. */
export type UnderlineLevel = 'unknown' | 'inDeck' | 'learning' | 'known' | 'wellKnown'

export const UNDERLINE_LEVELS: readonly UnderlineLevel[] = [
  'unknown',
  'inDeck',
  'learning',
  'known',
  'wellKnown'
]

/** Overrides for subtitle underline/report colors; see `UnderlineLevel` for
 * the different meaning of an absent `wellKnown` override. */
export type LevelColors = Partial<Record<UnderlineLevel, string>>

/** Validates a stored level→#rrggbb map; invalid entries are dropped. */
export function normalizeLevelColors(raw: unknown): LevelColors {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {}
  const parsed = raw as Record<string, unknown>
  const result: LevelColors = {}
  for (const level of UNDERLINE_LEVELS) {
    const value = parsed[level]
    if (typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value)) {
      result[level] = value.toLowerCase()
    }
  }
  return result
}

/** Sort direction for frequency-sorted dictionary results. */
export type PopupSortOrder = 'auto' | 'rank-based' | 'occurrence-based'

export interface PopupSettings {
  frequencyDictId: number | null
  sortOrder: PopupSortOrder
  maxEntries: number
  maxMeanings: number
}

export const DEFAULT_POPUP_SETTINGS: PopupSettings = {
  frequencyDictId: null,
  sortOrder: 'auto',
  maxEntries: 5,
  maxMeanings: 3
}

export interface SubtitleStyleSettings {
  fontScale: number
  xPct: number
  yPct: number
  backgroundEnabled: boolean
}

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyleSettings = {
  fontScale: 1,
  xPct: 50,
  yPct: 82,
  backgroundEnabled: true
}

/** mpv equalizer properties, each an integer −100…100 (0 = neutral). */
export const VIDEO_EQ_PROPERTIES = ['brightness', 'contrast', 'saturation', 'gamma', 'hue'] as const

export type VideoEqProperty = (typeof VIDEO_EQ_PROPERTIES)[number]

/** The four rotations mpv's `video-rotate` accepts (degrees clockwise). */
export const VIDEO_ROTATE_VALUES = [0, 90, 180, 270] as const

export type VideoRotate = (typeof VIDEO_ROTATE_VALUES)[number]

/** Bounds of every equalizer slider (mpv clamps identically). */
export const VIDEO_EQ_MIN = -100
export const VIDEO_EQ_MAX = 100

/**
 * App-wide (not per-file) picture adjustments: the five mpv equalizer values,
 * a rotation, and a deinterlace toggle. Re-applied after every load and mpv
 * (re)start, since mpv resets these per process/file.
 */
export interface VideoAdjustments {
  brightness: number
  contrast: number
  saturation: number
  gamma: number
  hue: number
  rotate: VideoRotate
  deinterlace: boolean
}

export const DEFAULT_VIDEO_ADJUSTMENTS: VideoAdjustments = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  gamma: 0,
  hue: 0,
  rotate: 0,
  deinterlace: false
}

/** True when `value` is one of mpv's four accepted `video-rotate` degrees. */
export function isVideoRotate(value: unknown): value is VideoRotate {
  return (VIDEO_ROTATE_VALUES as readonly unknown[]).includes(value)
}

/**
 * Validates a stored `videoAdjustments` value field-by-field: each equalizer
 * value is a finite integer clamped to −100…100 (a malformed one drops to 0,
 * matching the neutral default), `rotate` must be one of the four accepted
 * degrees, and `deinterlace` must be a boolean — anything else falls back to
 * the corresponding default. Never trusts stored JSON.
 */
export function normalizeVideoAdjustments(
  raw: unknown,
  defaults: VideoAdjustments = DEFAULT_VIDEO_ADJUSTMENTS
): VideoAdjustments {
  const parsed = (raw ?? {}) as Partial<Record<keyof VideoAdjustments, unknown>>
  const clampEq = (value: unknown): number => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 0
    return Math.max(VIDEO_EQ_MIN, Math.min(VIDEO_EQ_MAX, Math.round(value)))
  }
  return {
    brightness: clampEq(parsed.brightness),
    contrast: clampEq(parsed.contrast),
    saturation: clampEq(parsed.saturation),
    gamma: clampEq(parsed.gamma),
    hue: clampEq(parsed.hue),
    rotate: isVideoRotate(parsed.rotate) ? parsed.rotate : defaults.rotate,
    deinterlace: typeof parsed.deinterlace === 'boolean' ? parsed.deinterlace : defaults.deinterlace
  }
}

export const SPEED_MIN = 0.25
export const SPEED_MAX = 3
export const SPEED_STEP = 0.25

/** Default skip amount for transport buttons and keyboard shortcuts. */
export const DEFAULT_SKIP_SECONDS = 5

/** Persisted Options-menu settings. */
export interface PlayerSettings {
  keyBindings: KeyBindings
  skipSeconds: number
  popupSettings: PopupSettings
  subtitleStyle: SubtitleStyleSettings
  subtitleDragEnabled: boolean
  rightClickTogglePause: boolean
  /** Whether EOF automatically opens the next video file in the folder. */
  autoPlayNext: boolean
  subtitleOffsets: Record<string, number>
  /** Per-folder subtitle offsets (ms), keyed by `subtitleOffsetFolderKey`. Used
   * for any file in that folder without its own `subtitleOffsets` entry — see
   * `subtitleOffsetForFile`. */
  folderSubtitleOffsets: Record<string, number>
  /** Per-file audio delay (ms), keyed by `subtitleOffsetKey` (a generic lexical
   * path canonicalizer despite its name — reused here on purpose). Positive
   * delays audio; see `MpvController.setAudioDelay`. */
  audioDelays: Record<string, number>
  /** UI theme: light, dark, or follow the OS ('system'). */
  appearance: Appearance
  /** Whether the subtitle sidebar was open when the app last ran. */
  sidebarOpen: boolean
  /** Whether the playlist side panel was open when the app last ran. */
  playlistOpen: boolean
  /** Whether right-clicked subtitle text may be sent to the experimental online translator. */
  translationEnabled: boolean
  /** User overrides for the subtitle/report color of each knowledge level. An
   * absent ordinary level keeps the theme default; absent wellKnown means no
   * underline and a white report swatch. Overrides apply to both themes. */
  levelColors: LevelColors
  /** Folder screenshots are saved to. null = `<Pictures>/Kizuna`, resolved main-side. */
  screenshotFolder: string | null
  /** When true, mpv reads Kizuna's own config dir (`<userData>/mpv`: mpv.conf,
   * input.conf, scripts/, shaders/). When false (default), mpv runs with
   * `--no-config`. Changing it needs an mpv relaunch. */
  mpvUserConfig: boolean
  /** Advanced escape-hatch: extra mpv command-line args, one per entry. Applied
   * before the forced embedding args; sanitized at launch (see
   * `sanitizeExtraMpvArgs`). Changing it needs an mpv relaunch. */
  mpvExtraArgs: string[]
  /** App-wide picture adjustments (equalizer, rotate, deinterlace). Re-applied
   * after every load and mpv (re)start — see `MpvController.setVideoAdjustment`. */
  videoAdjustments: VideoAdjustments
  /** Preferred mpv output device name (`audio-device`); `'auto'` follows the OS
   * default. Re-applied after mpv start; falls back to `'auto'` for the session
   * if the stored device is no longer present (see `effectiveAudioDevice`). */
  audioDevice: string
  /** When true mpv runs the dynaudnorm loudness-normalization filter; re-applied
   * after mpv start — see `MpvController.setLoudnessNormalization`. */
  loudnessNormalization: boolean
}

export const DEFAULT_PLAYER_SETTINGS: PlayerSettings = {
  keyBindings: DEFAULT_KEY_BINDINGS,
  skipSeconds: DEFAULT_SKIP_SECONDS,
  popupSettings: DEFAULT_POPUP_SETTINGS,
  subtitleStyle: DEFAULT_SUBTITLE_STYLE,
  subtitleDragEnabled: true,
  rightClickTogglePause: true,
  autoPlayNext: false,
  subtitleOffsets: {},
  folderSubtitleOffsets: {},
  audioDelays: {},
  appearance: DEFAULT_APPEARANCE,
  sidebarOpen: false,
  playlistOpen: false,
  translationEnabled: false,
  levelColors: {},
  screenshotFolder: null,
  mpvUserConfig: false,
  mpvExtraArgs: [],
  videoAdjustments: DEFAULT_VIDEO_ADJUSTMENTS,
  audioDevice: AUTO_AUDIO_DEVICE,
  loudnessNormalization: false
}

/** Max length of a stored `audioDevice` name; a longer value is untrusted junk. */
export const AUDIO_DEVICE_NAME_MAX_LENGTH = 256

/**
 * Validates a stored `audioDevice`: a non-empty string ≤`AUDIO_DEVICE_NAME_MAX_LENGTH`
 * chars, used verbatim (mpv device names are opaque and case-sensitive — no
 * trimming or folding). Anything else falls back to `'auto'`. Whether the device
 * still exists is decided at apply time by `effectiveAudioDevice`, not here.
 */
export function normalizeAudioDevice(raw: unknown): string {
  if (typeof raw !== 'string') return AUTO_AUDIO_DEVICE
  if (raw === '' || raw.length > AUDIO_DEVICE_NAME_MAX_LENGTH) return AUTO_AUDIO_DEVICE
  return raw
}

/** Max length of a single stored mpv extra-arg; anything longer is dropped. */
export const MPV_EXTRA_ARG_MAX_LENGTH = 256

/**
 * Validates a stored `mpvExtraArgs` value: an array of trimmed, non-empty
 * strings each ≤`MPV_EXTRA_ARG_MAX_LENGTH` chars. Non-array input, or any
 * entry that isn't a usable string, yields `[]` — never trust stored JSON.
 * Individual bad entries are dropped rather than discarding the whole list,
 * so one over-long line doesn't wipe every other arg. Note this only shapes
 * the values; the launch-time `sanitizeExtraMpvArgs` still strips
 * embedding/config-owning options.
 */
export function normalizeMpvExtraArgs(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const result: string[] = []
  for (const entry of raw) {
    if (typeof entry !== 'string') continue
    const trimmed = entry.trim()
    if (trimmed !== '' && trimmed.length <= MPV_EXTRA_ARG_MAX_LENGTH) result.push(trimmed)
  }
  return result
}

/** True when `path` looks like a Windows path (drive letter, UNC, or backslashes). */
function isWindowsStylePath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('\\\\') || path.includes('\\')
}

/**
 * Canonical map key for per-file subtitle offsets. Windows-style paths get
 * `/` → `\` separator folding plus lowercasing (NTFS is case-insensitive), so
 * the same file opened from the picker (`E:\Video\a.mkv`) and from recent files
 * (which store lowercase paths) resolves to one entry; POSIX paths are used
 * as-is. Purely lexical — no filesystem or `process` access, so the renderer
 * can call it.
 */
export function subtitleOffsetKey(path: string): string {
  if (!isWindowsStylePath(path)) return path
  return path.replace(/\//g, '\\').toLowerCase()
}

/**
 * Canonical key of `path`'s parent folder: `subtitleOffsetKey` minus the last
 * separator-delimited segment. Returns `''` when the canonical key holds no
 * separator at all.
 */
export function subtitleOffsetFolderKey(path: string): string {
  const key = subtitleOffsetKey(path)
  const lastSeparator = Math.max(key.lastIndexOf('\\'), key.lastIndexOf('/'))
  return lastSeparator === -1 ? '' : key.slice(0, lastSeparator)
}

/** Validates a stored popup settings value field-by-field. */
export function normalizePopupSettings(raw: unknown, defaults: PopupSettings): PopupSettings {
  const parsed = (raw ?? {}) as Partial<PopupSettings>
  const isFiniteNumberOrNull = (value: unknown): value is number | null =>
    value === null || (typeof value === 'number' && Number.isFinite(value))
  const isPositiveFiniteNumber = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value >= 1
  const isSortOrder = (value: unknown): value is PopupSortOrder =>
    value === 'auto' || value === 'rank-based' || value === 'occurrence-based'

  return {
    frequencyDictId: isFiniteNumberOrNull(parsed.frequencyDictId)
      ? parsed.frequencyDictId
      : defaults.frequencyDictId,
    sortOrder: isSortOrder(parsed.sortOrder) ? parsed.sortOrder : defaults.sortOrder,
    maxEntries: isPositiveFiniteNumber(parsed.maxEntries) ? parsed.maxEntries : defaults.maxEntries,
    maxMeanings: isPositiveFiniteNumber(parsed.maxMeanings)
      ? parsed.maxMeanings
      : defaults.maxMeanings
  }
}

/** Validates a stored subtitle style value field-by-field. */
export function normalizeSubtitleStyle(
  raw: unknown,
  defaults: SubtitleStyleSettings
): SubtitleStyleSettings {
  const parsed = (raw ?? {}) as Partial<SubtitleStyleSettings>
  const inRange = (value: unknown, min: number, max: number): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
  return {
    fontScale: inRange(parsed.fontScale, 0.5, 3) ? parsed.fontScale : defaults.fontScale,
    xPct: inRange(parsed.xPct, 0, 100) ? parsed.xPct : defaults.xPct,
    yPct: inRange(parsed.yPct, 0, 100) ? parsed.yPct : defaults.yPct,
    backgroundEnabled:
      typeof parsed.backgroundEnabled === 'boolean'
        ? parsed.backgroundEnabled
        : defaults.backgroundEnabled
  }
}
