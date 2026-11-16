import { AUTO_AUDIO_DEVICE } from './audioDevice'
import { isRecord } from './guards'

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
  | 'subtitleFontScaleUp'
  | 'subtitleFontScaleDown'

/** Only modifier key events reveal left/right identity; ordinary key events report aggregate Ctrl/Shift state. */
const MODIFIER_CODES = ['ControlLeft', 'ShiftLeft'] as const

export type KeyModifier = (typeof MODIFIER_CODES)[number]

export function isKeyModifier(code: string): code is KeyModifier {
  return (MODIFIER_CODES as readonly string[]).includes(code)
}

/** Bindings match exactly, including modifiers; MouseWheelUp/Down are synthetic key codes. */
export type KeyBinding = string

/** Pseudo-codes used by the editable, direction-aware mouse-wheel bindings. */
export const MOUSE_WHEEL_UP_BINDING_CODE = 'MouseWheelUp'
export const MOUSE_WHEEL_DOWN_BINDING_CODE = 'MouseWheelDown'

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
  miniPlayer: 'ControlLeft+KeyM',
  subtitleFontScaleUp: 'ShiftLeft+MouseWheelUp',
  subtitleFontScaleDown: 'ShiftLeft+MouseWheelDown'
}

/** Lone modifiers cannot fire a binding; only one modifier prefix is supported. */
function normalizeKeyBinding(raw: unknown): KeyBinding | null {
  if (typeof raw !== 'string') return null
  const parts = raw.split('+')
  if (parts.length > 2) return null
  const code = parts[parts.length - 1]
  if (code === '' || isKeyModifier(code)) return null
  if (parts.length === 2 && !isKeyModifier(parts[0])) return null
  return raw
}

export function normalizeKeyBindings(raw: unknown): KeyBindings {
  const stored = isRecord(raw) ? raw : {}
  const bindings = { ...DEFAULT_KEY_BINDINGS }
  for (const action of Object.keys(bindings) as PlayerKeyAction[]) {
    const binding = normalizeKeyBinding(stored[action])
    if (binding) bindings[action] = binding
  }
  return bindings
}

/** UI color-scheme preference; 'system' follows the OS via prefers-color-scheme. */
export type Appearance = 'system' | 'light' | 'dark'

export const DEFAULT_APPEARANCE: Appearance = 'system'

/** Validates a stored appearance value, falling back for malformed input. */
export function normalizeAppearance(raw: unknown, fallback: Appearance): Appearance {
  return raw === 'system' || raw === 'light' || raw === 'dark' ? raw : fallback
}

/** Absent ordinary colors use the theme; absent wellKnown means no underline and a white report swatch. */
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
  if (!isRecord(raw)) return {}
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
  outlineSizePx: number
  xPct: number
  yPct: number
  backgroundEnabled: boolean
}

export type SubtitleAutoPauseTiming = 'off' | 'before' | 'after'

const DEFAULT_SUBTITLE_AUTO_PAUSE_TIMING: SubtitleAutoPauseTiming = 'off'

export function normalizeSubtitleAutoPauseTiming(raw: unknown): SubtitleAutoPauseTiming {
  return raw === 'off' || raw === 'before' || raw === 'after'
    ? raw
    : DEFAULT_SUBTITLE_AUTO_PAUSE_TIMING
}

export type SubtitleAutoPauseScope = 'all' | 'unknown'

const DEFAULT_SUBTITLE_AUTO_PAUSE_SCOPE: SubtitleAutoPauseScope = 'all'

export function normalizeSubtitleAutoPauseScope(raw: unknown): SubtitleAutoPauseScope {
  return raw === 'all' || raw === 'unknown' ? raw : DEFAULT_SUBTITLE_AUTO_PAUSE_SCOPE
}

/** Shared bounds and UI step for the persisted subtitle font scale. */
export const SUBTITLE_FONT_SCALE_MIN = 0.5
export const SUBTITLE_FONT_SCALE_MAX = 3
export const SUBTITLE_FONT_SCALE_STEP = 0.1
export const SUBTITLE_OUTLINE_SIZE_MIN = 0
export const SUBTITLE_OUTLINE_SIZE_MAX = 10
export const SUBTITLE_OUTLINE_SIZE_STEP = 1

export const DEFAULT_SUBTITLE_STYLE: SubtitleStyleSettings = {
  fontScale: 1,
  outlineSizePx: 1,
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

/** Reapply app-wide adjustments after each load/restart because mpv resets them per file/process. */
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

/** Persisted behavior selected before the renderer starts. */
export type StartupBehavior = 'splash' | 'game-ocr' | 'video-player'

/** Validates an untrusted startup behavior, defaulting to the chooser. */
export function normalizeStartupBehavior(raw: unknown): StartupBehavior {
  return raw === 'splash' || raw === 'game-ocr' || raw === 'video-player' ? raw : 'splash'
}

/** Persisted Options-menu settings. */
export interface PlayerSettings {
  startupBehavior: StartupBehavior
  keyBindings: KeyBindings
  skipSeconds: number
  popupSettings: PopupSettings
  subtitleStyle: SubtitleStyleSettings
  subtitleDragEnabled: boolean
  rightClickTogglePause: boolean
  /** Whether EOF automatically opens the next video file in the folder. */
  autoPlayNext: boolean
  /** Subtitle auto-pause timing at each cue boundary. */
  subtitleAutoPauseTiming: SubtitleAutoPauseTiming
  /** Whether auto-pause applies to every subtitle line or unknown-word lines only. */
  subtitleAutoPauseScope: SubtitleAutoPauseScope
  subtitleOffsets: Record<string, number>
  /** Folder subtitle offsets apply only when the file has no individual offset. */
  folderSubtitleOffsets: Record<string, number>
  /** Per-file audio delay in milliseconds; positive values delay audio. Keys use `subtitleOffsetKey`. */
  audioDelays: Record<string, number>
  /** UI theme: light, dark, or follow the OS ('system'). */
  appearance: Appearance
  /** Whether the subtitle sidebar was open when the app last ran. */
  sidebarOpen: boolean
  /** Whether the playlist side panel was open when the app last ran. */
  playlistOpen: boolean
  /** Whether right-clicked subtitle text may be sent to the experimental online translator. */
  translationEnabled: boolean
  /** Color overrides apply to both themes. */
  levelColors: LevelColors
  /** Folder screenshots are saved to. null = `<Pictures>/Kizuna`, resolved main-side. */
  screenshotFolder: string | null
  /** Opt into `<userData>/mpv` config/scripts instead of `--no-config`; changes require an mpv relaunch. */
  mpvUserConfig: boolean
  /** Extra arguments are sanitized before forced embedding arguments; changes require an mpv relaunch. */
  mpvExtraArgs: string[]
  /** App-wide picture adjustments (equalizer, rotate, deinterlace). Re-applied
   * after every load and mpv (re)start — see `MpvController.setVideoAdjustment`. */
  videoAdjustments: VideoAdjustments
  /** Preferred mpv device; an unavailable device falls back to 'auto' for the session. */
  audioDevice: string
  /** When true mpv runs the dynaudnorm loudness-normalization filter; re-applied
   * after mpv start — see `MpvController.setLoudnessNormalization`. */
  loudnessNormalization: boolean
}

export const DEFAULT_PLAYER_SETTINGS: PlayerSettings = {
  startupBehavior: 'splash',
  keyBindings: DEFAULT_KEY_BINDINGS,
  skipSeconds: DEFAULT_SKIP_SECONDS,
  popupSettings: DEFAULT_POPUP_SETTINGS,
  subtitleStyle: DEFAULT_SUBTITLE_STYLE,
  subtitleDragEnabled: true,
  rightClickTogglePause: true,
  autoPlayNext: false,
  subtitleAutoPauseTiming: DEFAULT_SUBTITLE_AUTO_PAUSE_TIMING,
  subtitleAutoPauseScope: DEFAULT_SUBTITLE_AUTO_PAUSE_SCOPE,
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
const AUDIO_DEVICE_NAME_MAX_LENGTH = 256

/** mpv device names are opaque and case-sensitive; do not trim or fold them. */
export function normalizeAudioDevice(raw: unknown): string {
  if (typeof raw !== 'string') return AUTO_AUDIO_DEVICE
  if (raw === '' || raw.length > AUDIO_DEVICE_NAME_MAX_LENGTH) return AUTO_AUDIO_DEVICE
  return raw
}

/** Max length of a single stored mpv extra-arg; anything longer is dropped. */
export const MPV_EXTRA_ARG_MAX_LENGTH = 256

/** This only normalizes stored strings; launch-time sanitization still removes unsafe mpv options. */
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

/** Fold Windows separators/case so picker and history paths share offsets; preserve POSIX paths. */
export function subtitleOffsetKey(path: string): string {
  if (!isWindowsStylePath(path)) return path
  return path.replace(/\//g, '\\').toLowerCase()
}

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
    fontScale: inRange(parsed.fontScale, SUBTITLE_FONT_SCALE_MIN, SUBTITLE_FONT_SCALE_MAX)
      ? parsed.fontScale
      : defaults.fontScale,
    outlineSizePx: inRange(
      parsed.outlineSizePx,
      SUBTITLE_OUTLINE_SIZE_MIN,
      SUBTITLE_OUTLINE_SIZE_MAX
    )
      ? parsed.outlineSizePx
      : defaults.outlineSizePx,
    xPct: inRange(parsed.xPct, 0, 100) ? parsed.xPct : defaults.xPct,
    yPct: inRange(parsed.yPct, 0, 100) ? parsed.yPct : defaults.yPct,
    backgroundEnabled:
      typeof parsed.backgroundEnabled === 'boolean'
        ? parsed.backgroundEnabled
        : defaults.backgroundEnabled
  }
}
