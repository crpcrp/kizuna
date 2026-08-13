// Pure renderer player state + reducer. Driven via React useReducer by App.
// No React import here — kept framework-agnostic and directly unit-testable.

import type { Track } from '../../../shared/track'
import type { Chapter } from '../../../shared/chapter'
import type { Cue } from '../../../shared/cue'
import type { Token } from '../../../shared/token'
import type { KnowledgeLevel } from '../../../shared/knowledge'
import {
  DEFAULT_APPEARANCE,
  DEFAULT_KEY_BINDINGS,
  DEFAULT_POPUP_SETTINGS,
  DEFAULT_SKIP_SECONDS,
  DEFAULT_SUBTITLE_STYLE,
  DEFAULT_VIDEO_ADJUSTMENTS,
  type Appearance,
  type KeyBinding,
  type KeyBindings,
  type LevelColors,
  type PopupSettings,
  type StartupBehavior,
  type SubtitleStyleSettings,
  type UnderlineLevel,
  type VideoAdjustments
} from '../../../shared/playerSettings'
import { AUTO_AUDIO_DEVICE } from '../../../shared/audioDevice'
import type { LoadedRendererSettings } from './rendererSettings'
import type { SubtitleEncoding } from '../../../shared/subtitleEncoding'

/** The armed A–B loop endpoints (seconds), or `null` when that endpoint is
 * unset. When both are numbers mpv loops the range on its own. Normalized so
 * `a <= b` whenever both are set (see `cycleAbLoop`). */
export interface AbLoopState {
  a: number | null
  b: number | null
}

/** No A–B loop armed. */
export const EMPTY_AB_LOOP: AbLoopState = { a: null, b: null }

/** Everything the player UI needs to render, in one immutable state object. */
export interface PlayerState {
  filePath?: string
  /** Increments on every `fileLoaded`, even when the same path is reopened.
   * Per-file effects (speed reset, subtitle-offset/audio-delay restore,
   * chapter fetch) key on this instead of `filePath` so reopening the current
   * file re-runs them — a same-path reopen leaves `filePath` unchanged. */
  loadGeneration: number
  tracks: Track[]
  cues: Cue[]
  chapters: Chapter[]
  timePos: number
  duration: number
  paused: boolean
  /** 0..100 */
  volume: number
  /** Audio muted (independent of volume, so the level is restored on unmute). */
  muted: boolean
  /** Playback speed multiplier; session-only and reset on each file load. */
  speed: number
  /** Window is in fullscreen mode (mirrors the OS/BrowserWindow state). */
  fullscreen: boolean
  selectedAudioId?: number
  selectedSubtitleId: number | null
  /** Path of the external subtitle file currently loaded (see
   * `EXTERNAL_SUBTITLE_TRACK_ID`); undefined when subtitles come from the
   * video's own streams. */
  externalSubtitlePath?: string
  /** Keyboard shortcut -> action map, user-editable via the Options menu. */
  keyBindings: KeyBindings
  /** Surface to open on the next process launch. */
  startupBehavior: StartupBehavior
  /** Seconds the skip-back/skip-ahead buttons and shortcuts jump. */
  skipSeconds: number
  /** MeCab tokens for the currently-active cue only; empty until tokenized. */
  activeTokens: Token[]
  /** MeCab tokens for every cue of the current track, keyed by `cueKey`, for
   * the subtitle sidebar's per-word coloring. Empty ({}) until the sidebar
   * requests a whole-track tokenization; reset whenever the cues change. */
  allCueTokens: Record<string, Token[]>
  /** Lemma -> resolved knowledge level, accumulated across cues (never reset
   * on cue change) so previously-resolved words stay colored/cached. */
  knownLevels: Record<string, KnowledgeLevel>
  /** Increments whenever cached knowledge levels are cleared, invalidating open derived views. */
  knowledgeEpoch: number
  /** Word popup display settings (frequency dict/order, entry/meaning caps). */
  popupSettings: PopupSettings
  /** Subtitle font scale + box position, user-editable/draggable. */
  subtitleStyle: SubtitleStyleSettings
  /** Whether the subtitle box can be dragged to reposition it. */
  subtitleDragEnabled: boolean
  /** Decoder choice for the active external subtitle file. */
  externalSubtitleEncoding: SubtitleEncoding
  /** Right-click on the video toggles play/pause when true (Options > Playback). */
  rightClickTogglePause: boolean
  /** EOF opens the next same-folder video when true. */
  autoPlayNext: boolean
  /** Whether right-clicked subtitle text may use the experimental online translator. */
  translationEnabled: boolean
  /** Subtitle timing offset (ms) for the currently-loaded file; positive delays
   * subtitles, negative shows them earlier. See `offsetTimePos` in shared/cue. */
  subtitleOffsetMs: number
  /** Audio delay (ms) for the currently-loaded file; positive delays audio,
   * negative plays it earlier. Persisted per file like `subtitleOffsetMs`;
   * see `MpvController.setAudioDelay`. */
  audioDelayMs: number
  /** Armed A–B loop for the currently-loaded file. Session-only (not persisted);
   * cleared on every file load, like the per-cue loop. */
  abLoopState: AbLoopState
  /** UI theme preference; 'system' follows the OS (Options > Appearance). */
  appearance: Appearance
  /** User overrides for the subtitle/report color of each knowledge level. An
   * absent ordinary level keeps the theme default; absent wellKnown means no
   * underline and a white report swatch. Overrides apply to both themes. */
  levelColors: LevelColors
  /** Folder screenshots are saved to; null uses the main-side Pictures default. */
  screenshotFolder: string | null
  /** Whether mpv loads Kizuna's own config dir (Options > Playback > mpv).
   * Takes effect on the next mpv launch. */
  mpvUserConfig: boolean
  /** Extra mpv CLI args (one per entry). Takes effect on the next mpv launch. */
  mpvExtraArgs: string[]
  /** App-wide picture adjustments (equalizer, rotate, deinterlace), re-applied
   * after each load. Persisted (Options-independent of the current file). */
  videoAdjustments: VideoAdjustments
  /** Preferred mpv output device (`audio-device`); `'auto'` follows the OS
   * default. Persisted app-wide; re-applied after mpv start. */
  audioDevice: string
  /** When true mpv runs the dynaudnorm loudness filter. Persisted app-wide;
   * re-applied after mpv start (Audio menu toggle). */
  loudnessNormalization: boolean
}

/** Empty-file starting state. Volume defaults to full and is preserved across files. */
export const initialPlayerState: PlayerState = {
  filePath: undefined,
  loadGeneration: 0,
  tracks: [],
  cues: [],
  chapters: [],
  timePos: 0,
  duration: 0,
  paused: false,
  volume: 100,
  muted: false,
  speed: 1,
  fullscreen: false,
  selectedAudioId: undefined,
  selectedSubtitleId: null,
  externalSubtitlePath: undefined,
  keyBindings: DEFAULT_KEY_BINDINGS,
  startupBehavior: 'splash',
  skipSeconds: DEFAULT_SKIP_SECONDS,
  activeTokens: [],
  allCueTokens: {},
  knownLevels: {},
  knowledgeEpoch: 0,
  popupSettings: DEFAULT_POPUP_SETTINGS,
  subtitleStyle: DEFAULT_SUBTITLE_STYLE,
  subtitleDragEnabled: true,
  externalSubtitleEncoding: 'auto',
  rightClickTogglePause: true,
  autoPlayNext: false,
  translationEnabled: false,
  subtitleOffsetMs: 0,
  audioDelayMs: 0,
  abLoopState: EMPTY_AB_LOOP,
  appearance: DEFAULT_APPEARANCE,
  levelColors: {},
  screenshotFolder: null,
  mpvUserConfig: false,
  mpvExtraArgs: [],
  videoAdjustments: DEFAULT_VIDEO_ADJUSTMENTS,
  audioDevice: AUTO_AUDIO_DEVICE,
  loudnessNormalization: false
}

/** Id of the first audio track in `tracks`, else undefined. */
export function defaultAudioId(tracks: Track[]): number | undefined {
  return tracks.find((t) => t.kind === 'audio')?.id
}

/** Id of the first subtitle track in `tracks`, else null. */
export function defaultSubtitleId(tracks: Track[]): number | null {
  return tracks.find((t) => t.kind === 'subtitle')?.id ?? null
}

/** True only when the selected subtitle track is explicitly Japanese. */
export function isJapaneseSubtitleTrack(
  tracks: Track[],
  selectedSubtitleId: number | null
): boolean {
  if (selectedSubtitleId === null) return false
  const language = tracks.find(
    (track) => track.id === selectedSubtitleId && track.kind === 'subtitle'
  )?.language
  return language?.toLowerCase() === 'ja' || language?.toLowerCase() === 'jpn'
}

export type PlayerAction =
  | { type: 'fileLoaded'; filePath: string; tracks: Track[] }
  | { type: 'mediaClosed' }
  | { type: 'cuesLoaded'; cues: Cue[] }
  | { type: 'chaptersLoaded'; chapters: Chapter[] }
  | { type: 'timePos'; value: number }
  | { type: 'duration'; value: number }
  | { type: 'setPaused'; value: boolean }
  | { type: 'setVolume'; value: number }
  | { type: 'setMuted'; value: boolean }
  | { type: 'setSpeed'; value: number }
  | { type: 'setFullscreen'; value: boolean }
  | { type: 'selectAudio'; id: number }
  | { type: 'selectSubtitle'; id: number | null }
  /** An external subtitle file became the active subtitle track. */
  | {
      type: 'externalSubtitleLoaded'
      path: string
      track: Track
      cues: Cue[]
      encoding: SubtitleEncoding
    }
  | { type: 'setKeyBinding'; action: keyof KeyBindings; binding: KeyBinding }
  | { type: 'setStartupBehavior'; value: StartupBehavior }
  | { type: 'setSkipSeconds'; value: number }
  | { type: 'setSubtitleDragEnabled'; value: boolean }
  | { type: 'setExternalSubtitleEncoding'; value: SubtitleEncoding }
  | { type: 'setRightClickTogglePause'; value: boolean }
  | { type: 'setAutoPlayNext'; value: boolean }
  | { type: 'setTranslationEnabled'; value: boolean }
  | { type: 'setSubtitleOffset'; value: number }
  | { type: 'setAudioDelay'; value: number }
  | { type: 'setAbLoop'; value: AbLoopState }
  | { type: 'setAppearance'; value: Appearance }
  /** `color: null` clears the override, restoring the theme default. */
  | { type: 'setLevelColor'; level: UnderlineLevel; color: string | null }
  /** `value: null` restores the main-side Pictures default folder. */
  | { type: 'setScreenshotFolder'; value: string | null }
  | { type: 'setMpvUserConfig'; value: boolean }
  | { type: 'setMpvExtraArgs'; value: string[] }
  /** Replaces the whole picture-adjustments block (slider/rotate/deinterlace edits). */
  | { type: 'setVideoAdjustments'; value: VideoAdjustments }
  | { type: 'setAudioDevice'; value: string }
  | { type: 'setLoudnessNormalization'; value: boolean }
  /** Applies a freshly-loaded `settings.json` in one payload; its shape is the
   * renderer's owned settings selection (see `state/rendererSettings.ts`), so
   * the two cannot drift. */
  | { type: 'loadSettings'; settings: LoadedRendererSettings }
  | { type: 'activeTokensLoaded'; tokens: Token[] }
  | { type: 'allCueTokensLoaded'; tokens: Record<string, Token[]> }
  | { type: 'resetTokenization' }
  | { type: 'knownLevelsLoaded'; levels: Record<string, KnowledgeLevel> }
  | { type: 'resetKnownLevels' }
  | { type: 'setPopupSettings'; value: Partial<PopupSettings> }
  | { type: 'setSubtitleStyle'; value: Partial<SubtitleStyleSettings> }

/** True when two whole-track snapshots contain the same cue keys and token arrays. */
export function sameCueTokenSnapshot(
  current: Record<string, Token[]>,
  next: Record<string, Token[]>
): boolean {
  const currentKeys = Object.keys(current)
  return (
    currentKeys.length === Object.keys(next).length &&
    currentKeys.every((key) => current[key] === next[key])
  )
}

/** Pure, immutable reducer. Unknown actions return the same state reference. */
export function playerReducer(state: PlayerState, action: PlayerAction): PlayerState {
  switch (action.type) {
    case 'fileLoaded':
      return {
        ...state,
        filePath: action.filePath,
        loadGeneration: state.loadGeneration + 1,
        tracks: action.tracks,
        cues: [],
        chapters: [],
        timePos: 0,
        duration: 0,
        paused: false,
        speed: 1,
        selectedAudioId: defaultAudioId(action.tracks),
        selectedSubtitleId: defaultSubtitleId(action.tracks),
        // `tracks` is replaced wholesale, so the previous file's synthetic
        // external track is gone with it — drop its path too.
        externalSubtitlePath: undefined,
        externalSubtitleEncoding: 'auto',
        subtitleOffsetMs: 0,
        audioDelayMs: 0,
        // A–B loop is per-file; a new file starts with no loop armed. App also
        // clears mpv's own ab-loop properties (they survive loadfile).
        abLoopState: EMPTY_AB_LOOP,
        allCueTokens: {}
      }
    case 'mediaClosed':
      // A media load failed or otherwise ended. Drop the previous file's
      // identity so the UI stops showing tracks/cues/chapters for media mpv is
      // no longer playing.
      // Persisted settings (volume, bindings, appearance, …) are untouched.
      return {
        ...state,
        filePath: undefined,
        tracks: [],
        cues: [],
        chapters: [],
        timePos: 0,
        duration: 0,
        paused: false,
        selectedAudioId: undefined,
        selectedSubtitleId: null,
        externalSubtitlePath: undefined,
        externalSubtitleEncoding: 'auto',
        subtitleOffsetMs: 0,
        audioDelayMs: 0,
        abLoopState: EMPTY_AB_LOOP,
        activeTokens: [],
        allCueTokens: {}
      }
    case 'cuesLoaded':
      // New cue set → the whole-track tokenization is stale; clear it so the
      // sidebar re-tokenizes rather than showing the previous track's spans.
      return { ...state, cues: action.cues, allCueTokens: {} }
    case 'chaptersLoaded':
      return { ...state, chapters: action.chapters }
    case 'timePos':
      return { ...state, timePos: action.value }
    case 'duration':
      return { ...state, duration: action.value }
    case 'setPaused':
      return { ...state, paused: action.value }
    case 'setVolume':
      return { ...state, volume: action.value }
    case 'setMuted':
      return { ...state, muted: action.value }
    case 'setSpeed':
      return { ...state, speed: action.value }
    case 'setFullscreen':
      return { ...state, fullscreen: action.value }
    case 'selectAudio':
      return { ...state, selectedAudioId: action.id }
    case 'selectSubtitle':
      return { ...state, selectedSubtitleId: action.id }
    case 'externalSubtitleLoaded':
      // Filter-then-append: a second external file replaces the first one's
      // synthetic track rather than adding a duplicate id.
      return {
        ...state,
        tracks: [...state.tracks.filter((track) => track.id !== action.track.id), action.track],
        cues: action.cues,
        selectedSubtitleId: action.track.id,
        externalSubtitlePath: action.path,
        externalSubtitleEncoding: action.encoding,
        allCueTokens: {}
      }
    case 'setKeyBinding':
      return { ...state, keyBindings: { ...state.keyBindings, [action.action]: action.binding } }
    case 'setStartupBehavior':
      return { ...state, startupBehavior: action.value }
    case 'setSkipSeconds':
      return { ...state, skipSeconds: action.value }
    case 'setSubtitleDragEnabled':
      return { ...state, subtitleDragEnabled: action.value }
    case 'setExternalSubtitleEncoding':
      return { ...state, externalSubtitleEncoding: action.value }
    case 'setRightClickTogglePause':
      return { ...state, rightClickTogglePause: action.value }
    case 'setAutoPlayNext':
      return { ...state, autoPlayNext: action.value }
    case 'setTranslationEnabled':
      return { ...state, translationEnabled: action.value }
    case 'setSubtitleOffset':
      return { ...state, subtitleOffsetMs: action.value }
    case 'setAudioDelay':
      return { ...state, audioDelayMs: action.value }
    case 'setAbLoop':
      return { ...state, abLoopState: action.value }
    case 'setAppearance':
      return { ...state, appearance: action.value }
    case 'setLevelColor': {
      const levelColors = { ...state.levelColors }
      if (action.color === null) delete levelColors[action.level]
      else levelColors[action.level] = action.color
      return { ...state, levelColors }
    }
    case 'setScreenshotFolder':
      return { ...state, screenshotFolder: action.value }
    case 'setMpvUserConfig':
      return { ...state, mpvUserConfig: action.value }
    case 'setMpvExtraArgs':
      return { ...state, mpvExtraArgs: action.value }
    case 'setVideoAdjustments':
      return { ...state, videoAdjustments: action.value }
    case 'setAudioDevice':
      return { ...state, audioDevice: action.value }
    case 'setLoudnessNormalization':
      return { ...state, loudnessNormalization: action.value }
    case 'loadSettings':
      return { ...state, ...action.settings }
    case 'activeTokensLoaded':
      return { ...state, activeTokens: action.tokens }
    case 'allCueTokensLoaded':
      return sameCueTokenSnapshot(state.allCueTokens, action.tokens)
        ? state
        : { ...state, allCueTokens: action.tokens }
    case 'resetTokenization':
      return { ...state, activeTokens: [], allCueTokens: {} }
    case 'knownLevelsLoaded':
      return { ...state, knownLevels: { ...state.knownLevels, ...action.levels } }
    case 'resetKnownLevels':
      return { ...state, knownLevels: {}, knowledgeEpoch: state.knowledgeEpoch + 1 }
    case 'setPopupSettings':
      return { ...state, popupSettings: { ...state.popupSettings, ...action.value } }
    case 'setSubtitleStyle':
      return { ...state, subtitleStyle: { ...state.subtitleStyle, ...action.value } }
    default:
      return state
  }
}
