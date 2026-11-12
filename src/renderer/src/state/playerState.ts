// Pure renderer player state + reducer. Driven via React useReducer by App.
// No React import here — kept framework-agnostic and directly unit-testable.

import type { Track } from '../../../shared/track'
import type { Chapter } from '../../../shared/chapter'
import type { Cue } from '../../../shared/cue'
import type { Token } from '../../../shared/token'
import type { KnowledgeLevel } from '../../../shared/knowledge'
import type { MediaPlaybackHistory, JimakuSubtitleProvenance } from '../../../shared/mediaHistory'
import {
  DEFAULT_PLAYER_SETTINGS,
  type KeyBinding,
  type KeyBindings,
  type PopupSettings,
  type SubtitleStyleSettings,
  type UnderlineLevel
} from '../../../shared/playerSettings'

import { selectLoadedRendererSettings, type LoadedRendererSettings } from './rendererSettings'
import type { SubtitleEncoding } from '../../../shared/subtitleEncoding'
import { EXTERNAL_SUBTITLE_TRACK_ID } from '../../../shared/track'
import { nextSubtitleVersionOffsets } from './perFileOffsets'

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
export interface PlayerState extends LoadedRendererSettings {
  filePath?: string
  /** Increments on every `fileLoaded`, even when the same path is reopened.
   * Per-file effects (speed reset, subtitle-offset/audio-delay restore,
   * chapter fetch) key on this instead of `filePath` so reopening the current
   * file re-runs them — a same-path reopen leaves `filePath` unchanged. */
  loadGeneration: number
  tracks: Track[]
  cues: Cue[]
  chapters: Chapter[]
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
  /** Trusted Jimaku metadata for the active external subtitle, when any. */
  externalSubtitleProvenance?: JimakuSubtitleProvenance
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
  /** Decoder choice for the active external subtitle file. */
  externalSubtitleEncoding: SubtitleEncoding
  /** Subtitle timing offset (ms) for the currently-loaded file; positive delays
   * subtitles, negative shows them earlier. See `offsetTimePos` in shared/cue. */
  subtitleOffsetMs: number
  /** Per-video offsets for downloaded subtitle content versions. */
  subtitleOffsetsByVersion: Record<string, number>
  /** Audio delay (ms) for the currently-loaded file; positive delays audio,
   * negative plays it earlier. Persisted per file like `subtitleOffsetMs`;
   * see `MpvController.setAudioDelay`. */
  audioDelayMs: number
  /** Armed A–B loop for the currently-loaded file. Session-only (not persisted);
   * cleared on every file load, like the per-cue loop. */
  abLoopState: AbLoopState
}

/** Empty-file starting state. Volume defaults to full and is preserved across files. */
export const initialPlayerState: PlayerState = {
  ...selectLoadedRendererSettings(DEFAULT_PLAYER_SETTINGS),
  filePath: undefined,
  loadGeneration: 0,
  tracks: [],
  cues: [],
  chapters: [],
  duration: 0,
  paused: false,
  volume: 100,
  muted: false,
  speed: 1,
  fullscreen: false,
  selectedAudioId: undefined,
  selectedSubtitleId: null,
  externalSubtitlePath: undefined,
  externalSubtitleProvenance: undefined,
  activeTokens: [],
  allCueTokens: {},
  knownLevels: {},
  knowledgeEpoch: 0,
  externalSubtitleEncoding: 'auto',
  subtitleOffsetMs: 0,
  subtitleOffsetsByVersion: {},
  audioDelayMs: 0,
  abLoopState: EMPTY_AB_LOOP
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
  | { type: 'set'; patch: Partial<PlayerState> }
  | { type: 'fileLoaded'; filePath: string; tracks: Track[]; history?: MediaPlaybackHistory }
  | { type: 'mediaClosed' }
  | { type: 'cuesLoaded'; cues: Cue[] }
  | { type: 'chaptersLoaded'; chapters: Chapter[] }
  | { type: 'selectAudio'; id: number }
  | { type: 'selectSubtitle'; id: number | null }
  /** An external subtitle file became the active subtitle track. */
  | {
      type: 'externalSubtitleLoaded'
      path: string
      track: Track
      cues: Cue[]
      encoding: SubtitleEncoding
      provenance?: JimakuSubtitleProvenance
    }
  | { type: 'setKeyBinding'; action: keyof KeyBindings; binding: KeyBinding }
  | { type: 'setSubtitleVersionOffset'; contentVersion: string; value: number }
  /** `color: null` clears the override, restoring the theme default. */
  | { type: 'setLevelColor'; level: UnderlineLevel; color: string | null }
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
    case 'set':
      return { ...state, ...action.patch }
    case 'fileLoaded':
      return {
        ...state,
        filePath: action.filePath,
        loadGeneration: state.loadGeneration + 1,
        tracks: action.tracks,
        cues: [],
        chapters: [],
        duration: 0,
        paused: false,
        speed: 1,
        selectedAudioId: defaultAudioId(action.tracks),
        selectedSubtitleId: defaultSubtitleId(action.tracks),
        // `tracks` is replaced wholesale, so the previous file's synthetic
        // external track is gone with it — drop its path too.
        externalSubtitlePath: undefined,
        externalSubtitleProvenance:
          action.history?.subtitle?.mode === 'external'
            ? action.history.subtitle.provenance
            : undefined,
        externalSubtitleEncoding: 'auto',
        subtitleOffsetMs: 0,
        subtitleOffsetsByVersion: { ...(action.history?.subtitleOffsetsByVersion ?? {}) },
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
        duration: 0,
        paused: false,
        selectedAudioId: undefined,
        selectedSubtitleId: null,
        externalSubtitlePath: undefined,
        externalSubtitleProvenance: undefined,
        externalSubtitleEncoding: 'auto',
        subtitleOffsetMs: 0,
        subtitleOffsetsByVersion: {},
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
    case 'selectAudio':
      return { ...state, selectedAudioId: action.id }
    case 'selectSubtitle':
      return action.id === EXTERNAL_SUBTITLE_TRACK_ID
        ? { ...state, selectedSubtitleId: action.id }
        : {
            ...state,
            selectedSubtitleId: action.id,
            externalSubtitlePath: undefined,
            externalSubtitleProvenance: undefined,
            externalSubtitleEncoding: 'auto'
          }
    case 'externalSubtitleLoaded': {
      // Filter-then-append: a second external file replaces the first one's
      // synthetic track rather than adding a duplicate id.
      return {
        ...state,
        tracks: [...state.tracks.filter((track) => track.id !== action.track.id), action.track],
        cues: action.cues,
        selectedSubtitleId: action.track.id,
        externalSubtitlePath: action.path,
        externalSubtitleProvenance: action.provenance,
        externalSubtitleEncoding: action.encoding,
        subtitleOffsetsByVersion: state.subtitleOffsetsByVersion,
        allCueTokens: {}
      }
    }
    case 'setKeyBinding':
      return { ...state, keyBindings: { ...state.keyBindings, [action.action]: action.binding } }
    case 'setSubtitleVersionOffset':
      if (state.externalSubtitleProvenance?.contentVersion !== action.contentVersion) return state
      return {
        ...state,
        subtitleOffsetMs: action.value,
        subtitleOffsetsByVersion: nextSubtitleVersionOffsets(
          state.subtitleOffsetsByVersion,
          action.contentVersion,
          action.value
        )
      }
    case 'setLevelColor': {
      const levelColors = { ...state.levelColors }
      if (action.color === null) delete levelColors[action.level]
      else levelColors[action.level] = action.color
      return { ...state, levelColors }
    }
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
