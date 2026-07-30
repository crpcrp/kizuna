import './OptionsMenu.css'
import { useEffect, useState } from 'react'
import { describeKeyBinding, eventKeyBinding } from '../state/keyBindings'
import { APP_NAME } from '../../../shared/appInfo'
import {
  DEFAULT_SUBTITLE_STYLE,
  MPV_EXTRA_ARG_MAX_LENGTH,
  normalizePreferredUrlSubtitleLanguage,
  type Appearance,
  type KeyBinding,
  type KeyBindings,
  type LevelColors,
  type PlayerKeyAction,
  type PopupSettings,
  type SubtitleStyleSettings,
  type UnderlineLevel
} from '../../../shared/playerSettings'
import { audioDeviceMenuList, type AudioDevice } from '../../../shared/audioDevice'
import { DEFAULT_LEVEL_COLOR_HEX } from '../util/levelColors'
import type { McDict } from '../../../shared/mecab'
import type { DictInfo, ImportProgress } from '../../../shared/dictionary'
import { defaultAnkiSettings, type AnkiSettings, type AnkiPing } from '../../../shared/anki'
import type {
  KnowledgeSource,
  PublicKnowledgeSettings,
  SyncStatus
} from '../../../shared/knowledge'
import type { SetupData } from '../state/optionsData'
import DictionariesTab from './options/DictionariesTab'
import AnkiTab from './options/AnkiTab'
import KnowledgeTab from './options/KnowledgeTab'
import SetupTab from './options/SetupTab'
import OptionsToggleRow from './options/OptionsToggleRow'
import { matchSettings, type SettingEntry } from './options/settingsSearch'

// Options dialog: reachable from Settings > Options…. Lets the user rebind
// keyboard shortcuts, change the skip-back/skip-ahead jump amount, and pick the active MeCab
// dictionary. Always rendered (CSS toggles visibility via the `open` class)
// so it's testable without a live DOM, same pattern as MenuBar's dropdown
// panels.
//
// Only the Keybindings/Playback/Subtitles tabs stay inline here — they have
// no external data dependencies. Dictionaries/Anki/Known words are each a
// separate component under options/ owning their own domain props and
// transient UI state, mounted only while their category is active.

// Optionality rule: a prop is optional only when its absence carries meaning —
// the caller genuinely has nothing to give. That is exactly the three
// `*LoadError`s (undefined = no error), `subscribeImportProgress`,
// `heldModifiers` (undefined = none held), and the four `anki*` data props
// (undefined until the 'anki' options-data domain has loaded; App has no
// value for them before then).
//
// Everything else is required. These props were optional while App was being
// decomposed, so a caller that "didn't yet wire it" could still render; that
// phase is over and there is exactly one caller wiring all of them
// (App.tsx's <OptionsMenu …>). Keeping the defaults now would only mean that
// dropping a prop from that call site compiles and leaves a control silently
// no-opping against a `() => {}` instead of failing the type check.
export interface OptionsMenuProps {
  open: boolean
  keyBindings: KeyBindings
  /** The left-side modifier keys currently held (App's `createModifierTracker`),
   * read by the rebind capture below so Ctrl+Up is recorded as a chord rather
   * than as a bare Up. Absent means none held, so unmodified keys still rebind. */
  heldModifiers?: ReadonlySet<string>
  skipSeconds: number
  /** Right-click on the video toggles play/pause when true. */
  rightClickTogglePause: boolean
  autoPlayNext: boolean
  /** Preferred language code for online (yt-dlp URL) subtitles, e.g. 'ja'. Empty = no preference. */
  preferredUrlSubtitleLanguage: string
  /** Output devices from mpv's `audio-device-list`. Refreshed via
   * `onAudioDevicesRequest` whenever the Playback tab becomes active. */
  audioDevices: AudioDevice[]
  /** Name of the currently-selected output device; `'auto'` follows the OS. */
  selectedAudioDevice: string
  onSelectAudioDevice: (name: string) => void
  /** Whether the dynaudnorm loudness-normalization filter is active. */
  loudnessNormalization: boolean
  onToggleLoudnessNorm: () => void
  /** Fires when the Playback tab becomes active, so the caller can re-read
   * mpv's device list — devices come and go (BT headphones, HDMI) while the
   * app runs, so a snapshot taken at startup would be misleading. */
  onAudioDevicesRequest: () => void
  /** Folder screenshots save to; null shows the Pictures default placeholder. */
  screenshotFolder: string | null
  /** Whether mpv reads Kizuna's own config dir. */
  mpvUserConfig: boolean
  /** Extra mpv CLI args, one per entry. */
  mpvExtraArgs: string[]
  mecabDicts: McDict[]
  currentMecabDictId: 'ipadic' | 'unidic'
  yomitanDicts: DictInfo[]
  /** User-facing error from the last dictionaries-domain load, shown at the
   * top of the Parser & Dictionaries tab. Undefined when there is none. */
  dictionariesLoadError?: string
  popupSettings: PopupSettings
  subtitleStyle: SubtitleStyleSettings
  /** Whether subtitles can be dragged to reposition them. */
  subtitleDragEnabled: boolean
  /** Whether right-clicked subtitles may use the experimental online translator. */
  translationEnabled: boolean
  /** UI theme preference. */
  appearance: Appearance
  /** Underline color overrides; an absent level uses the theme's color. */
  levelColors: LevelColors
  onClose: () => void
  onChangeKeyBinding: (action: PlayerKeyAction, binding: KeyBinding) => void
  onChangeSkipSeconds: (value: number) => void
  onChangeRightClickTogglePause: (value: boolean) => void
  onChangeAutoPlayNext: (value: boolean) => void
  /** Commits the normalized preferred online-subtitle language. */
  onChangePreferredUrlSubtitleLanguage: (value: string) => void
  /** Commits the screenshot folder; `null` restores the Pictures default. */
  onChangeScreenshotFolder: (value: string | null) => void
  onChangeMpvUserConfig: (value: boolean) => void
  /** Commits the parsed (trimmed, non-empty) extra-args list. */
  onChangeMpvExtraArgs: (value: string[]) => void
  /** Opens the mpv config folder in the OS file manager. */
  onOpenMpvConfigDir: () => void
  onSelectMecabDict: (id: 'ipadic' | 'unidic') => void
  onImportYomitanDict: (bytes: Uint8Array) => Promise<void>
  /** Subscribes to advisory term-row progress for the in-flight import; see
   * DictionariesTab. Absent means no progress is reported. */
  subscribeImportProgress?: (cb: (progress: ImportProgress) => void) => () => void
  onSetYomitanEnabled: (id: number, enabled: boolean) => void
  onSetYomitanFallbackOnly: (id: number, fallbackOnly: boolean) => void
  onReorderYomitanDicts: (orderedIds: number[]) => void
  onRemoveYomitanDict: (id: number) => void
  onChangePopupSettings: (value: Partial<PopupSettings>) => void
  onChangeSubtitleStyle: (value: Partial<SubtitleStyleSettings>) => void
  onChangeSubtitleDragEnabled: (value: boolean) => void
  onChangeTranslationEnabled: (enabled: boolean) => void
  onChangeAppearance: (value: Appearance) => void
  /** `null` clears the override, restoring the theme's color for that level. */
  onChangeLevelColor: (level: UnderlineLevel, color: string | null) => void
  wanikaniConfigured: boolean
  onSaveWanikaniToken: (token: string) => void | Promise<void>
  /** Undefined until the 'anki' options-data domain has loaded. */
  ankiSettings?: AnkiSettings
  /** Undefined until the 'anki' options-data domain has loaded. */
  ankiDeckNames?: string[]
  /** Undefined until the 'anki' options-data domain has loaded. */
  ankiModelNames?: string[]
  /** Fields of ankiSettings.modelName; undefined until that domain has loaded. */
  ankiModelFields?: string[]
  /** "Test connection". */
  ankiPing: () => Promise<AnkiPing>
  onChangeAnkiSettings: (patch: Partial<AnkiSettings>) => void
  /** User-facing error from the last anki-domain load (e.g. "Is Anki
   * running?"), shown at the top of the Anki tab. Undefined when there is none. */
  ankiLoadError?: string
  knowledgeSettings: PublicKnowledgeSettings
  onChangeKnowledgeSettings: (
    patch: Partial<Omit<PublicKnowledgeSettings, 'hasWanikaniToken' | 'encryptionAvailable'>>
  ) => void
  /** User-facing error from the last knowledge-domain load, shown at the top
   * of the Known words tab. Undefined when there is none. */
  knowledgeLoadError?: string
  syncStatus: SyncStatus
  /** Live signals for the read-only "Setup & integrations" tab (bundled-binary
   * presence + the last AnkiConnect ping). Undefined until the 'setup'
   * options-data domain has loaded, which is what makes each row read
   * "Checking…" rather than guessing a verdict. */
  setupStatus?: SetupData
  onSyncNow: (source: KnowledgeSource) => Promise<SyncStatus>
  /** Called with the current category whenever the dialog opens, and again
   * whenever the active category changes while open, so the caller can load
   * that category's optional-integration data lazily. */
  onCategoryOpen: (category: OptionsCategory) => void
}

/** Parses the font-size percent input into a fontScale (0.5-3), or null when invalid. */
export function parseFontScalePercent(rawValue: string): number | null {
  const value = Number(rawValue)
  return Number.isFinite(value) && value >= 50 && value <= 300 ? value / 100 : null
}

/** Parses a 0-100 subtitle-position percent input, or null when invalid. */
export function parsePositionPercent(rawValue: string): number | null {
  const value = Number(rawValue)
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null
}

/** Splits a one-arg-per-line textarea into trimmed, non-empty mpv args. Applies
 * the *same* `MPV_EXTRA_ARG_MAX_LENGTH` cap the main-side `normalizeMpvExtraArgs`
 * enforces, so what the renderer commits and re-displays matches what actually
 * persists — an over-long line is dropped here rather than appearing saved for
 * the session and then vanishing after a restart. */
export function parseMpvExtraArgs(rawValue: string): string[] {
  return rawValue
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && line.length <= MPV_EXTRA_ARG_MAX_LENGTH)
}

/** Row order + display label for each rebindable action. */
export const ACTION_ROWS: { action: PlayerKeyAction; label: string }[] = [
  { action: 'togglePause', label: 'Play / Pause' },
  { action: 'toggleFullscreen', label: 'Toggle Fullscreen' },
  { action: 'exitFullscreen', label: 'Exit Fullscreen' },
  { action: 'skipBack', label: 'Skip Back' },
  { action: 'skipForward', label: 'Skip Forward' },
  { action: 'speedDown', label: 'Speed down' },
  { action: 'speedUp', label: 'Speed up' },
  { action: 'speedReset', label: 'Reset speed' },
  { action: 'replayLine', label: 'Replay line' },
  { action: 'prevLine', label: 'Previous line' },
  { action: 'nextLine', label: 'Next line' },
  { action: 'loopLine', label: 'Loop line' },
  { action: 'abLoop', label: 'A–B loop' },
  { action: 'frameStep', label: 'Step forward one frame' },
  { action: 'frameBack', label: 'Step back one frame' },
  { action: 'prevFile', label: 'Previous file' },
  { action: 'nextFile', label: 'Next file' },
  { action: 'prevChapter', label: 'Previous chapter' },
  { action: 'nextChapter', label: 'Next chapter' },
  { action: 'screenshot', label: 'Save screenshot' },
  { action: 'miniPlayer', label: 'Mini player' }
]

export type OptionsCategory =
  | 'keybindings'
  | 'playback'
  | 'appearance'
  | 'subtitles'
  | 'dictionaries'
  | 'anki'
  | 'knowledge'
  | 'setup'

/** Sidebar order + display label for each category tab. */
export const CATEGORY_ROWS: { id: OptionsCategory; label: string }[] = [
  { id: 'keybindings', label: 'Keybindings' },
  { id: 'playback', label: 'Playback' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'subtitles', label: 'Subtitles' },
  { id: 'dictionaries', label: 'Parser & Dictionaries' },
  { id: 'anki', label: 'Anki' },
  { id: 'knowledge', label: 'Known words' },
  { id: 'setup', label: 'Setup & integrations' }
]

/** Display label for a category id; falls back to the id if it is ever asked
 * for one that isn't in CATEGORY_ROWS (unreachable via the typed callers). */
export function categoryLabel(category: OptionsCategory): string {
  return CATEGORY_ROWS.find((row) => row.id === category)?.label ?? category
}

/** Every setting the header search box can find, in tab order. Each entry
 * carries the tab that holds it and — where the control has a DOM id — the id
 * to scroll to and flash after navigating.
 *
 * KEEP THIS IN SYNC: adding a control to any tab (including the tabs under
 * options/) means adding a row here, or the search box silently can't find it.
 * `keywords` exist for the words users type that the label doesn't contain. */
export const SETTING_ENTRIES: SettingEntry[] = [
  ...ACTION_ROWS.map(({ action, label }): SettingEntry => ({
    id: `keybind-${action}`,
    label,
    category: 'keybindings',
    keywords: ['keybinding', 'shortcut', 'hotkey'],
    targetId: `keybind-${action}`
  })),

  {
    id: 'skip-seconds',
    label: 'Skip back/ahead seconds',
    category: 'playback',
    keywords: ['skip', 'jump', 'seek', 'amount'],
    targetId: 'skip-seconds-input'
  },
  {
    id: 'auto-play-next',
    label: 'Auto-play next file',
    category: 'playback',
    keywords: ['playlist', 'continue', 'autoplay'],
    targetId: 'auto-play-next-checkbox'
  },
  {
    id: 'preferred-url-subtitle-language',
    label: 'Preferred online subtitle language',
    category: 'playback',
    keywords: ['yt-dlp', 'url', 'youtube', 'language'],
    targetId: 'preferred-url-subtitle-language-input'
  },
  {
    id: 'right-click-toggle-pause',
    label: 'Right-click toggles play/pause',
    category: 'playback',
    keywords: ['mouse', 'pause'],
    targetId: 'right-click-toggle-pause-checkbox'
  },
  {
    id: 'screenshot-folder',
    label: 'Screenshot folder',
    category: 'playback',
    keywords: ['capture', 'save', 'pictures'],
    targetId: 'screenshot-folder-input'
  },
  {
    id: 'audio-device',
    label: 'Audio output device',
    category: 'playback',
    keywords: ['sound', 'speakers', 'headphones', 'hdmi'],
    targetId: 'audio-device-select'
  },
  {
    id: 'loudness-normalization',
    label: 'Normalize loudness',
    category: 'playback',
    keywords: ['volume', 'audio', 'dynaudnorm', 'compressor'],
    targetId: 'loudness-normalization-checkbox'
  },
  {
    id: 'mpv-user-config',
    label: 'Load my mpv config folder',
    category: 'playback',
    keywords: ['mpv.conf', 'input.conf', 'scripts', 'shaders', 'advanced'],
    targetId: 'mpv-user-config-checkbox'
  },
  {
    id: 'mpv-extra-args',
    label: 'Extra mpv arguments',
    category: 'playback',
    keywords: ['command line', 'hwdec', 'profile', 'advanced'],
    targetId: 'mpv-extra-args-input'
  },
  {
    id: 'mpv-config-dir',
    label: 'Open mpv config folder',
    category: 'playback',
    keywords: ['explorer', 'advanced'],
    targetId: 'mpv-open-config-folder'
  },

  {
    id: 'appearance-theme',
    label: 'Theme',
    category: 'appearance',
    keywords: ['dark', 'light', 'system', 'appearance', 'color scheme'],
    targetId: 'appearance-system'
  },
  {
    id: 'underline-colors',
    label: 'Word underline colors',
    category: 'appearance',
    keywords: ['unknown', 'in deck', 'learning', 'known', 'highlight'],
    targetId: 'level-color-unknown'
  },

  {
    id: 'subtitle-font-scale',
    label: 'Subtitle font size',
    category: 'subtitles',
    keywords: ['bigger', 'smaller', 'scale', 'text size'],
    targetId: 'subtitle-font-scale-input'
  },
  {
    id: 'subtitle-x',
    label: 'Subtitle horizontal position',
    category: 'subtitles',
    keywords: ['left', 'right', 'placement'],
    targetId: 'subtitle-x-input'
  },
  {
    id: 'subtitle-y',
    label: 'Subtitle vertical position',
    category: 'subtitles',
    keywords: ['up', 'down', 'placement'],
    targetId: 'subtitle-y-input'
  },
  {
    id: 'subtitle-drag',
    label: 'Drag subtitles to reposition',
    category: 'subtitles',
    keywords: ['mouse', 'move'],
    targetId: 'subtitle-drag-enabled'
  },
  {
    id: 'subtitle-style-reset',
    label: 'Reset subtitle style to default',
    category: 'subtitles',
    targetId: 'subtitle-style-reset'
  },
  {
    id: 'translation-enabled',
    label: 'Enable experimental subtitle translation',
    category: 'subtitles',
    keywords: ['translate', 'google', 'english'],
    targetId: 'translation-enabled'
  },

  {
    id: 'mecab-dictionary',
    label: 'MeCab dictionary',
    category: 'dictionaries',
    keywords: ['ipadic', 'unidic', 'parser', 'tokenizer']
  },
  {
    id: 'yomitan-import',
    label: 'Import Yomitan dictionary',
    category: 'dictionaries',
    keywords: ['jmdict', 'zip', 'add dictionary'],
    targetId: 'yomitan-import-input'
  },
  {
    id: 'popup-freq-dict',
    label: 'Frequency dictionary',
    category: 'dictionaries',
    keywords: ['word popup', 'frequency'],
    targetId: 'popup-freq-dict-select'
  },
  {
    id: 'popup-sort-order',
    label: 'Word popup sort order',
    category: 'dictionaries',
    keywords: ['ordering'],
    targetId: 'popup-sort-order-select'
  },
  {
    id: 'popup-max-entries',
    label: 'Max entries shown in the word popup',
    category: 'dictionaries',
    keywords: ['limit'],
    targetId: 'popup-max-entries-input'
  },
  {
    id: 'popup-max-meanings',
    label: 'Max meanings per entry',
    category: 'dictionaries',
    keywords: ['definitions', 'limit', 'word popup'],
    targetId: 'popup-max-meanings-input'
  },

  {
    id: 'anki-url',
    label: 'AnkiConnect URL',
    category: 'anki',
    keywords: ['connection', 'localhost', 'port'],
    targetId: 'anki-url-input'
  },
  {
    id: 'anki-api-key',
    label: 'AnkiConnect API key',
    category: 'anki',
    keywords: ['password', 'secret'],
    targetId: 'anki-api-key-input'
  },
  {
    id: 'anki-deck',
    label: 'Anki deck',
    category: 'anki',
    keywords: ['mining', 'target deck'],
    targetId: 'anki-deck-select'
  },
  {
    id: 'anki-model',
    label: 'Anki note type',
    category: 'anki',
    keywords: ['model', 'template'],
    targetId: 'anki-model-select'
  },
  {
    id: 'anki-test-connection',
    label: 'Test Anki connection',
    category: 'anki',
    keywords: ['ping', 'check'],
    targetId: 'anki-test-connection'
  },
  {
    id: 'anki-fields',
    label: 'Anki field mapping',
    category: 'anki',
    keywords: ['word', 'reading', 'sentence', 'audio', 'screenshot', 'frequency', 'pitch accent']
  },
  {
    id: 'anki-duplicate-policy',
    label: 'Duplicate policy',
    category: 'anki',
    keywords: ['skip', 'allow', 'existing note'],
    targetId: 'anki-duplicate-policy-select'
  },
  {
    id: 'anki-tags',
    label: 'Anki tags',
    category: 'anki',
    targetId: 'anki-tags-input'
  },
  {
    id: 'anki-include-audio',
    label: 'Include word audio (JapanesePod101)',
    category: 'anki',
    keywords: ['pronunciation', 'sound'],
    targetId: 'anki-include-audio-checkbox'
  },

  {
    id: 'wanikani-token',
    label: 'WaniKani personal access token',
    category: 'knowledge',
    keywords: ['api', 'wk', 'known words'],
    targetId: 'wanikani-token-input'
  },
  {
    id: 'knowledge-anki-decks',
    label: 'Anki known decks',
    category: 'knowledge',
    keywords: ['known words', 'source']
  },
  {
    id: 'knowledge-anki-field',
    label: 'Known-word field',
    category: 'knowledge',
    targetId: 'anki-known-field-select'
  },
  {
    id: 'known-interval',
    label: 'Known after (days)',
    category: 'knowledge',
    keywords: ['threshold', 'srs', 'interval'],
    targetId: 'known-interval-days-input'
  },
  {
    id: 'well-known-interval',
    label: 'Well-known after (days)',
    category: 'knowledge',
    keywords: ['threshold', 'srs', 'interval'],
    targetId: 'well-known-interval-days-input'
  },
  {
    id: 'knowledge-sync',
    label: 'Sync known words',
    category: 'knowledge',
    keywords: ['refresh', 'wanikani', 'anki']
  },
  {
    id: 'setup-status',
    label: 'Setup & integrations status',
    category: 'setup',
    keywords: [
      'ffmpeg',
      'ffprobe',
      'yt-dlp',
      'mpv',
      'mecab',
      'unidic',
      'yomitan',
      'anki',
      'wanikani',
      'diagnostics',
      'ready',
      'missing',
      'installed'
    ]
  },
  {
    id: 'coloring-enabled',
    label: 'Color subtitle words by knowledge level',
    category: 'knowledge',
    keywords: ['underline', 'highlight'],
    targetId: 'coloring-enabled-checkbox'
  }
]

/** Row order + display label + description for each appearance choice. */
export const APPEARANCE_ROWS: { value: Appearance; label: string; description: string }[] = [
  { value: 'system', label: 'System', description: 'Follow the Windows light/dark setting' },
  { value: 'light', label: 'Light', description: 'Always use the light theme' },
  { value: 'dark', label: 'Dark', description: 'Always use the dark theme' }
]

/** Row order + display label for each level that draws an underline. wellKnown
 * is absent on purpose: it renders a transparent border, so it has no color. */
export const UNDERLINE_COLOR_ROWS: { level: UnderlineLevel; label: string }[] = [
  { level: 'unknown', label: 'Unknown' },
  { level: 'inDeck', label: 'In deck' },
  { level: 'learning', label: 'Learning' },
  { level: 'known', label: 'Known' }
]

/** The Appearance tab's underline-color rows. A separate (hook-free) component
 * so a test can call it directly and invoke the row handlers — OptionsMenu
 * itself holds hooks and can only be rendered. */
export function UnderlineColorRows({
  levelColors,
  onChangeLevelColor
}: {
  levelColors: LevelColors
  onChangeLevelColor: (level: UnderlineLevel, color: string | null) => void
}): React.JSX.Element {
  return (
    <>
      {UNDERLINE_COLOR_ROWS.map(({ level, label }) => {
        const override = levelColors[level]
        return (
          <div className="options-row" key={level}>
            <label htmlFor={`level-color-${level}`} className="options-row-label">
              {label}
            </label>
            <div className="options-color-control">
              {/* Only rendered while overridden: with no override there is
                  nothing to reset, and the swatch already shows the default. */}
              {override && (
                <button
                  type="button"
                  className="options-keybind-button options-color-reset"
                  aria-label={`Reset ${label} underline color`}
                  onClick={() => onChangeLevelColor(level, null)}
                >
                  Reset
                </button>
              )}
              {/* <input type="color"> always emits a lowercase #rrggbb, which
                  normalizeLevelColors accepts as-is — no validation needed. */}
              <input
                type="color"
                id={`level-color-${level}`}
                value={override ?? DEFAULT_LEVEL_COLOR_HEX[level]}
                onChange={(e) => onChangeLevelColor(level, e.target.value)}
              />
            </div>
          </div>
        )
      })}
    </>
  )
}

/** Stable empty set for the `heldModifiers` default, so the rebind effect below
 * doesn't re-register on every render. */
const NO_MODIFIERS: ReadonlySet<string> = new Set()

/** How long a search result's target row stays flashed, in ms. Matches the
 * `options-row-flash` animation in OptionsMenu.css. */
const FLASH_MS = 1600

export default function OptionsMenu({
  open,
  keyBindings,
  heldModifiers = NO_MODIFIERS,
  skipSeconds,
  rightClickTogglePause,
  mecabDicts,
  currentMecabDictId,
  yomitanDicts,
  dictionariesLoadError,
  popupSettings,
  subtitleStyle,
  subtitleDragEnabled,
  autoPlayNext,
  preferredUrlSubtitleLanguage,
  audioDevices,
  selectedAudioDevice,
  onSelectAudioDevice,
  loudnessNormalization,
  onToggleLoudnessNorm,
  onAudioDevicesRequest,
  screenshotFolder,
  mpvUserConfig,
  mpvExtraArgs,
  translationEnabled,
  appearance,
  levelColors,
  onClose,
  onChangeKeyBinding,
  onChangeSkipSeconds,
  onChangeRightClickTogglePause,
  onChangeAutoPlayNext,
  onChangePreferredUrlSubtitleLanguage,
  onChangeScreenshotFolder,
  onChangeMpvUserConfig,
  onChangeMpvExtraArgs,
  onOpenMpvConfigDir,
  onSelectMecabDict,
  onImportYomitanDict,
  subscribeImportProgress,
  onSetYomitanEnabled,
  onSetYomitanFallbackOnly,
  onReorderYomitanDicts,
  onRemoveYomitanDict,
  onChangePopupSettings,
  onChangeSubtitleStyle,
  onChangeSubtitleDragEnabled,
  onChangeTranslationEnabled,
  onChangeAppearance,
  onChangeLevelColor,
  wanikaniConfigured,
  onSaveWanikaniToken,
  // The 'anki' domain's four data props are the only ones still defaulted
  // here: App has no value for them until that domain loads, so the fallbacks
  // are about absent data, not an unwired caller.
  ankiSettings = defaultAnkiSettings,
  ankiDeckNames = [],
  ankiModelNames = [],
  ankiModelFields = [],
  ankiPing,
  onChangeAnkiSettings,
  ankiLoadError,
  knowledgeSettings,
  onChangeKnowledgeSettings,
  knowledgeLoadError,
  syncStatus,
  setupStatus,
  onSyncNow,
  onCategoryOpen
}: OptionsMenuProps): React.JSX.Element {
  const [listeningFor, setListeningFor] = useState<PlayerKeyAction | null>(null)
  // Clock for the Setup tab's "last synced" label, read once per mount rather
  // than per render so the text can't shift between two renders of one open
  // dialog (same idiom as KnowledgeTab's).
  const [nowMs] = useState(() => Date.now())
  const [activeCategory, setActiveCategory] = useState<OptionsCategory>('keybindings')
  // Header search box. A non-blank query replaces the tab content with the
  // matching settings; picking one jumps to its tab and clears the query.
  const [query, setQuery] = useState('')
  // DOM id of the control a result just navigated to, scrolled into view and
  // briefly flashed by the effect below. null = nothing to point at.
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const searching = query.trim() !== ''
  const results = searching ? matchSettings(query, SETTING_ENTRIES) : []
  const selectResult = (entry: SettingEntry): void => {
    setActiveCategory(entry.category)
    setQuery('')
    setHighlightId(entry.targetId ?? null)
  }
  // Raw text of the font-size input while it's being edited, so a keystroke
  // that's momentarily out of range (e.g. "5" on the way to "50", or the
  // field cleared to type a fresh number) still shows what was typed instead
  // of snapping back to the last committed value. null = not editing, so the
  // field falls back to the committed subtitleStyle.fontScale.
  const [fontScaleDraft, setFontScaleDraft] = useState<string | null>(null)
  // Raw text of the screenshot-folder field while it's being edited; committed
  // on blur/Enter. null = not editing, so it falls back to screenshotFolder.
  const [screenshotFolderDraft, setScreenshotFolderDraft] = useState<string | null>(null)
  const commitScreenshotFolder = (): void => {
    if (screenshotFolderDraft === null) return
    const trimmed = screenshotFolderDraft.trim()
    onChangeScreenshotFolder(trimmed === '' ? null : trimmed)
    setScreenshotFolderDraft(null)
  }
  // Raw text of the preferred-online-subtitle-language field while it's being
  // edited; committed on blur/Enter. null = not editing, so it falls back to
  // preferredUrlSubtitleLanguage.
  const [preferredUrlSubtitleLanguageDraft, setPreferredUrlSubtitleLanguageDraft] = useState<
    string | null
  >(null)
  const commitPreferredUrlSubtitleLanguage = (): void => {
    if (preferredUrlSubtitleLanguageDraft === null) return
    onChangePreferredUrlSubtitleLanguage(
      normalizePreferredUrlSubtitleLanguage(preferredUrlSubtitleLanguageDraft)
    )
    setPreferredUrlSubtitleLanguageDraft(null)
  }
  // Raw text of the mpv extra-args textarea while it's being edited (one arg per
  // line), committed on blur. null = not editing, so it falls back to the
  // persisted mpvExtraArgs joined by newlines.
  const [mpvExtraArgsDraft, setMpvExtraArgsDraft] = useState<string | null>(null)
  const commitMpvExtraArgs = (): void => {
    if (mpvExtraArgsDraft === null) return
    onChangeMpvExtraArgs(parseMpvExtraArgs(mpvExtraArgsDraft))
    setMpvExtraArgsDraft(null)
  }

  // While a rebind is armed, the next keydown anywhere becomes the new
  // binding for `listeningFor` instead of reaching the app's own shortcuts.
  // A press that yields no binding (a lone Ctrl/Shift on the way to a chord,
  // or an unbindable one — see `eventKeyBinding`) leaves the row armed, so
  // holding Ctrl and then pressing Up records Ctrl+Up.
  useEffect(() => {
    if (!listeningFor) return
    const capture = (e: KeyboardEvent): void => {
      e.preventDefault()
      e.stopPropagation()
      const binding = eventKeyBinding(e, heldModifiers)
      if (!binding) return
      onChangeKeyBinding(listeningFor, binding)
      setListeningFor(null)
    }
    window.addEventListener('keydown', capture, true)
    return () => window.removeEventListener('keydown', capture, true)
  }, [listeningFor, onChangeKeyBinding, heldModifiers])

  // Closing (or the dialog being hidden) always cancels an in-flight rebind.
  // Done in the cleanup of the open window rather than in an effect body, so
  // the cancel still runs on exactly the open → closed transition.
  useEffect(() => {
    if (!open) return
    return () => {
      setListeningFor(null)
      setQuery('')
    }
  }, [open])

  // Let Escape close the open dialog, unless the capture-phase rebind listener
  // above is armed and consumes the key as a new binding. A pending search
  // query is what Escape cancels first, so searching doesn't cost the user the
  // whole dialog on a mistyped word.
  useEffect(() => {
    if (!open) return
    const closeOnEscape = (e: KeyboardEvent): void => {
      if (e.code !== 'Escape') return
      if (query !== '') setQuery('')
      else onClose()
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [open, onClose, query])

  // Point at the control a search result led to: scroll it into view and flash
  // it, so the user sees which row of the newly-opened tab they asked for.
  // Applied to the live node rather than through a per-row `className`, since
  // the target may live in any of the seven tabs, three of which are separate
  // components.
  useEffect(() => {
    if (!highlightId) return
    const target = document.getElementById(highlightId)
    if (!target) return
    const row = target.closest('.options-row') ?? target
    // Optional call: jsdom-style test DOMs don't always implement scrolling.
    row.scrollIntoView?.({ block: 'center' })
    row.classList.add('options-row-flash')
    const timer = window.setTimeout(() => setHighlightId(null), FLASH_MS)
    return () => {
      window.clearTimeout(timer)
      row.classList.remove('options-row-flash')
    }
  }, [highlightId])

  // Requests the active category's data whenever the dialog opens and again
  // whenever the active category changes while it's open, so optional
  // integration data (dictionaries, Anki, knowledge) loads lazily per-tab
  // instead of all at once on app startup.
  useEffect(() => {
    if (open) onCategoryOpen(activeCategory)
  }, [open, activeCategory, onCategoryOpen])

  // The Playback tab holds the output-device picker, so re-read mpv's device
  // list whenever it becomes visible rather than showing a startup snapshot.
  useEffect(() => {
    if (open && activeCategory === 'playback') onAudioDevicesRequest()
  }, [open, activeCategory, onAudioDevicesRequest])

  return (
    <div
      id="options-overlay"
      className={open ? 'options-overlay open' : 'options-overlay'}
      role="dialog"
      aria-label="Options"
      aria-hidden={!open}
    >
      <div className="options-panel">
        <div className="options-header">
          <span>Options</span>
          <input
            type="search"
            id="options-search-input"
            className="options-search"
            placeholder="Find a setting or feature…"
            aria-label="Find a setting or feature"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button type="button" id="options-close" aria-label="Close options" onClick={onClose}>
            &#x2715;
          </button>
        </div>

        <div className="options-body">
          <nav className="options-sidebar" role="tablist" aria-label="Options categories">
            {CATEGORY_ROWS.map(({ id, label }) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={activeCategory === id}
                className={activeCategory === id ? 'options-nav-item active' : 'options-nav-item'}
                onClick={() => setActiveCategory(id)}
              >
                {label}
              </button>
            ))}
          </nav>

          {/* While searching, the results list stands in for the tab content:
              the tabs stay mounted (same "always rendered, CSS hides it"
              pattern as the dialog itself) and `.searching` hides them. */}
          <div className={searching ? 'options-content searching' : 'options-content'}>
            {searching && (
              <div
                className="options-search-results"
                role="listbox"
                aria-label="Setting search results"
              >
                {results.length === 0 ? (
                  <p className="options-hint" id="options-search-empty">
                    No settings match that search.
                  </p>
                ) : (
                  results.map((entry) => (
                    <button
                      key={entry.id}
                      type="button"
                      role="option"
                      aria-selected={false}
                      className="options-search-result"
                      onClick={() => selectResult(entry)}
                    >
                      <span>{entry.label}</span>
                      <span className="options-search-result-category">
                        {categoryLabel(entry.category)}
                      </span>
                    </button>
                  ))
                )}
              </div>
            )}

            <section
              className={activeCategory === 'keybindings' ? 'options-tab active' : 'options-tab'}
              aria-hidden={activeCategory !== 'keybindings'}
            >
              <div className="options-section">
                <h3>Keybindings</h3>
                {/* Two-column grid: 21 rebind rows in one column made the tab a
                    long scroll for what is really a lookup table. */}
                <div className="options-shortcut-grid">
                  {ACTION_ROWS.map(({ action, label }) => (
                    <div className="options-row options-shortcut-row" key={action}>
                      <span className="options-row-label">{label}</span>
                      <button
                        type="button"
                        id={`keybind-${action}`}
                        className="options-keybind-button"
                        aria-label={`Rebind ${label}`}
                        onClick={() => setListeningFor(action)}
                      >
                        {listeningFor === action
                          ? 'Press a key…'
                          : describeKeyBinding(keyBindings[action])}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </section>

            <section
              className={activeCategory === 'playback' ? 'options-tab active' : 'options-tab'}
              aria-hidden={activeCategory !== 'playback'}
            >
              <div className="options-section">
                <h3>Skip amount</h3>
                <div className="options-row">
                  <label htmlFor="skip-seconds-input" className="options-row-label">
                    Skip back/ahead seconds
                    <span className="options-row-description">
                      Used by the arrow keys and the transport skip buttons.
                    </span>
                  </label>
                  <input
                    type="number"
                    id="skip-seconds-input"
                    min={1}
                    max={120}
                    value={skipSeconds}
                    onChange={(e) => {
                      const value = Number(e.target.value)
                      if (Number.isFinite(value) && value > 0) onChangeSkipSeconds(value)
                    }}
                  />
                </div>

                <OptionsToggleRow
                  id="auto-play-next-checkbox"
                  title="Auto-play next file"
                  description="At the end of a file, continue with the next video in the folder; an active playlist takes priority."
                  checked={autoPlayNext}
                  onChange={(checked) => onChangeAutoPlayNext?.(checked)}
                />
                <div className="options-row">
                  <label
                    htmlFor="preferred-url-subtitle-language-input"
                    className="options-row-label"
                  >
                    Preferred online subtitle language
                    <span className="options-row-description">
                      Matching online (yt-dlp) caption tracks sort first. Blank means no preference.
                    </span>
                  </label>
                  <input
                    type="text"
                    id="preferred-url-subtitle-language-input"
                    placeholder="e.g. ja"
                    value={preferredUrlSubtitleLanguageDraft ?? preferredUrlSubtitleLanguage}
                    onChange={(e) => setPreferredUrlSubtitleLanguageDraft(e.target.value)}
                    onBlur={commitPreferredUrlSubtitleLanguage}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur()
                      else if (e.key === 'Escape') setPreferredUrlSubtitleLanguageDraft(null)
                    }}
                  />
                </div>
                <OptionsToggleRow
                  id="right-click-toggle-pause-checkbox"
                  title="Right-click toggles play/pause"
                  description="Right-clicking the video pauses or resumes instead of opening a menu."
                  checked={rightClickTogglePause}
                  onChange={onChangeRightClickTogglePause}
                />
                <div className="options-row">
                  <label htmlFor="screenshot-folder-input" className="options-row-label">
                    Screenshot folder
                    <span className="options-row-description">
                      {`Blank saves to Pictures\\${APP_NAME}.`}
                    </span>
                  </label>
                  <input
                    type="text"
                    id="screenshot-folder-input"
                    placeholder={`Pictures\\${APP_NAME} (default)`}
                    value={screenshotFolderDraft ?? screenshotFolder ?? ''}
                    onChange={(e) => setScreenshotFolderDraft(e.target.value)}
                    onBlur={commitScreenshotFolder}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur()
                      else if (e.key === 'Escape') setScreenshotFolderDraft(null)
                    }}
                  />
                </div>
              </div>

              <div className="options-section">
                <h3>Audio output</h3>
                <div className="options-row">
                  <label htmlFor="audio-device-select" className="options-row-label">
                    Output device
                    <span className="options-row-description">
                      Falls back to the system default if the device disappears.
                    </span>
                  </label>
                  <select
                    id="audio-device-select"
                    value={selectedAudioDevice}
                    onChange={(e) => onSelectAudioDevice(e.target.value)}
                  >
                    {audioDeviceMenuList(audioDevices).map((device) => (
                      <option key={device.name} value={device.name}>
                        {device.description}
                      </option>
                    ))}
                  </select>
                </div>
                <OptionsToggleRow
                  id="loudness-normalization-checkbox"
                  title="Normalize loudness"
                  description={<>Uses mpv&rsquo;s dynamic audio-normalization filter.</>}
                  checked={loudnessNormalization}
                  onChange={() => onToggleLoudnessNorm()}
                />
              </div>

              <div className="options-section">
                <h3>mpv (advanced)</h3>
                <p className="options-hint">Changes take effect after restarting Kizuna.</p>
                <OptionsToggleRow
                  id="mpv-user-config-checkbox"
                  title="Load my mpv config folder"
                  description={
                    <>
                      Reads mpv.conf, input.conf, scripts/ and shaders/ from Kizuna&rsquo;s mpv
                      folder. Off runs mpv with --no-config.
                    </>
                  }
                  checked={mpvUserConfig}
                  onChange={onChangeMpvUserConfig}
                />
                <div className="options-row options-row-stacked">
                  <label htmlFor="mpv-extra-args-input" className="options-row-label">
                    Extra mpv arguments
                    <span className="options-row-description">
                      One argument per line. Only known playback-tuning options are passed to mpv;
                      anything else is ignored.
                    </span>
                  </label>
                  <textarea
                    id="mpv-extra-args-input"
                    className="options-mpv-args"
                    rows={4}
                    spellCheck={false}
                    placeholder={'--hwdec=auto\n--profile=gpu-hq'}
                    value={mpvExtraArgsDraft ?? mpvExtraArgs.join('\n')}
                    onChange={(e) => setMpvExtraArgsDraft(e.target.value)}
                    onBlur={commitMpvExtraArgs}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') setMpvExtraArgsDraft(null)
                    }}
                  />
                </div>
                <div className="options-row">
                  <button
                    type="button"
                    id="mpv-open-config-folder"
                    className="options-button"
                    onClick={() => onOpenMpvConfigDir()}
                  >
                    Open mpv config folder
                  </button>
                </div>
              </div>
            </section>

            <section
              className={activeCategory === 'appearance' ? 'options-tab active' : 'options-tab'}
              aria-hidden={activeCategory !== 'appearance'}
            >
              <div className="options-section">
                <h3>Theme</h3>
                {APPEARANCE_ROWS.map(({ value, label, description }) => (
                  <div className="options-row" key={value}>
                    <label htmlFor={`appearance-${value}`} className="options-row-label">
                      {label}
                      <span className="options-row-description">{description}</span>
                    </label>
                    <input
                      type="radio"
                      id={`appearance-${value}`}
                      name="appearance-mode"
                      value={value}
                      checked={appearance === value}
                      onChange={() => onChangeAppearance(value)}
                    />
                  </div>
                ))}
              </div>

              <div className="options-section">
                <h3>Word underline colors</h3>
                <p className="options-hint">
                  Overrides apply to both light and dark themes; well-known words have no underline.
                </p>
                <UnderlineColorRows
                  levelColors={levelColors}
                  onChangeLevelColor={onChangeLevelColor}
                />
              </div>
            </section>

            <section
              className={activeCategory === 'subtitles' ? 'options-tab active' : 'options-tab'}
              aria-hidden={activeCategory !== 'subtitles'}
            >
              <div className="options-section">
                <h3>Subtitle appearance</h3>
                <div className="options-row">
                  <label htmlFor="subtitle-font-scale-input" className="options-row-label">
                    Font size (%)
                    <span
                      className="options-help-icon"
                      title="Any number between 50% and 300%."
                      aria-label="Any number between 50% and 300%."
                    >
                      ?
                    </span>
                  </label>
                  <input
                    type="number"
                    id="subtitle-font-scale-input"
                    min={50}
                    max={300}
                    step={10}
                    value={fontScaleDraft ?? Math.round(subtitleStyle.fontScale * 100)}
                    onChange={(e) => {
                      setFontScaleDraft(e.target.value)
                      const fontScale = parseFontScalePercent(e.target.value)
                      if (fontScale !== null) onChangeSubtitleStyle({ fontScale })
                    }}
                    onBlur={() => setFontScaleDraft(null)}
                  />
                </div>
                <div className="options-row">
                  <label htmlFor="subtitle-x-input" className="options-row-label">
                    Horizontal position (%)
                    <span className="options-row-description">
                      Share of the video&rsquo;s width: 0% is the left edge, 100% the right.
                    </span>
                  </label>
                  <input
                    type="number"
                    id="subtitle-x-input"
                    min={0}
                    max={100}
                    value={Math.round(subtitleStyle.xPct)}
                    onChange={(e) => {
                      const xPct = parsePositionPercent(e.target.value)
                      if (xPct !== null) onChangeSubtitleStyle({ xPct })
                    }}
                  />
                </div>
                <div className="options-row">
                  <label htmlFor="subtitle-y-input" className="options-row-label">
                    Vertical position (%)
                    <span className="options-row-description">
                      Share of the video&rsquo;s height: 0% is the top, 100% the bottom.
                    </span>
                  </label>
                  <input
                    type="number"
                    id="subtitle-y-input"
                    min={0}
                    max={100}
                    value={Math.round(subtitleStyle.yPct)}
                    onChange={(e) => {
                      const yPct = parsePositionPercent(e.target.value)
                      if (yPct !== null) onChangeSubtitleStyle({ yPct })
                    }}
                  />
                </div>
                <p className="options-hint">
                  Tip: you can also drag the subtitles directly on the video to reposition them.
                </p>
                <OptionsToggleRow
                  id="subtitle-drag-enabled"
                  title="Drag subtitles to reposition"
                  checked={subtitleDragEnabled ?? true}
                  onChange={(checked) => onChangeSubtitleDragEnabled?.(checked)}
                />
                <button
                  type="button"
                  id="subtitle-style-reset"
                  className="options-keybind-button"
                  onClick={() => onChangeSubtitleStyle(DEFAULT_SUBTITLE_STYLE)}
                >
                  Reset to default
                </button>
              </div>

              {/* Its own card, not one nested inside "Subtitle appearance":
                  translation is a separate setting, and the card styling makes
                  the old nesting read as a mistake. */}
              <div className="options-section">
                <h3>Experimental translation</h3>
                <OptionsToggleRow
                  id="translation-enabled"
                  title="Enable experimental subtitle translation"
                  checked={translationEnabled}
                  onChange={onChangeTranslationEnabled}
                />
                <p className="options-hint">
                  Right-clicked subtitle text is sent to Google&apos;s unofficial online endpoint.
                  Requests may fail or be rate-limited; no API key is used.
                </p>
              </div>
            </section>

            {activeCategory === 'dictionaries' && (
              <DictionariesTab
                mecabDicts={mecabDicts}
                currentMecabDictId={currentMecabDictId}
                yomitanDicts={yomitanDicts}
                popupSettings={popupSettings}
                loadError={dictionariesLoadError}
                onSelectMecabDict={onSelectMecabDict}
                onImportYomitanDict={onImportYomitanDict}
                subscribeImportProgress={subscribeImportProgress}
                onSetYomitanEnabled={onSetYomitanEnabled}
                onSetYomitanFallbackOnly={onSetYomitanFallbackOnly}
                onReorderYomitanDicts={onReorderYomitanDicts}
                onRemoveYomitanDict={onRemoveYomitanDict}
                onChangePopupSettings={onChangePopupSettings}
              />
            )}

            {activeCategory === 'anki' && (
              <AnkiTab
                ankiSettings={ankiSettings}
                ankiDeckNames={ankiDeckNames}
                ankiModelNames={ankiModelNames}
                ankiModelFields={ankiModelFields}
                ankiPing={ankiPing}
                onChangeAnkiSettings={onChangeAnkiSettings}
                loadError={ankiLoadError}
              />
            )}

            {activeCategory === 'knowledge' && (
              <KnowledgeTab
                wanikaniConfigured={wanikaniConfigured}
                onSaveWanikaniToken={onSaveWanikaniToken}
                ankiDeckNames={ankiDeckNames}
                ankiModelFields={ankiModelFields}
                knowledgeSettings={knowledgeSettings}
                onChangeKnowledgeSettings={onChangeKnowledgeSettings}
                syncStatus={syncStatus}
                onSyncNow={onSyncNow}
                loadError={knowledgeLoadError}
              />
            )}

            {activeCategory === 'setup' && (
              <SetupTab
                setup={setupStatus}
                mecabDicts={mecabDicts}
                yomitanDicts={yomitanDicts}
                wanikaniConfigured={wanikaniConfigured}
                syncStatus={syncStatus}
                nowMs={nowMs}
                onGoToCategory={setActiveCategory}
                categoryLabel={categoryLabel}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
