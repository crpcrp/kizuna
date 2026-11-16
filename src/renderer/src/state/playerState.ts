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

// A–B endpoints are media seconds; null is unset, and mpv owns looping once both are set.
export interface AbLoopState {
  a: number | null
  b: number | null
}

export const EMPTY_AB_LOOP: AbLoopState = { a: null, b: null }

export interface PlayerState extends LoadedRendererSettings {
  filePath?: string
  // Increment even on same-path reopen so per-file effects run again.
  loadGeneration: number
  tracks: Track[]
  cues: Cue[]
  chapters: Chapter[]
  duration: number
  paused: boolean
  /** 0..100 */
  volume: number
  muted: boolean
  /** Playback speed multiplier; session-only and reset on each file load. */
  speed: number
  fullscreen: boolean
  selectedAudioId?: number
  selectedSubtitleId: number | null
  externalSubtitlePath?: string
  externalSubtitleProvenance?: JimakuSubtitleProvenance
  activeTokens: Token[]
  // Whole-track tokens are keyed by cueKey and cleared when cues change.
  allCueTokens: Record<string, Token[]>
  // Accumulate lemma levels across cues so revisiting a word reuses its known level.
  knownLevels: Record<string, KnowledgeLevel>
  /** Increments whenever cached knowledge levels are cleared, invalidating open derived views. */
  knowledgeEpoch: number
  externalSubtitleEncoding: SubtitleEncoding
  // Subtitle offset in ms: positive delays subtitles, negative advances them.
  subtitleOffsetMs: number
  subtitleOffsetsByVersion: Record<string, number>
  // Audio delay in ms: positive delays audio, negative advances it; persisted per file.
  audioDelayMs: number
  /** Armed A–B loop for the currently-loaded file. Session-only (not persisted);
   * cleared on every file load, like the per-cue loop. */
  abLoopState: AbLoopState
}

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

function defaultAudioId(tracks: Track[]): number | undefined {
  return tracks.find((t) => t.kind === 'audio')?.id
}

export function defaultSubtitleId(tracks: Track[]): number | null {
  return tracks.find((t) => t.kind === 'subtitle')?.id ?? null
}

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
  | { type: 'loadSettings'; settings: LoadedRendererSettings }
  | { type: 'activeTokensLoaded'; tokens: Token[] }
  | { type: 'allCueTokensLoaded'; tokens: Record<string, Token[]> }
  | { type: 'resetTokenization' }
  | { type: 'knownLevelsLoaded'; levels: Record<string, KnowledgeLevel> }
  | { type: 'resetKnownLevels' }
  | { type: 'setPopupSettings'; value: Partial<PopupSettings> }
  | { type: 'setSubtitleStyle'; value: Partial<SubtitleStyleSettings> }

function sameCueTokenSnapshot(
  current: Record<string, Token[]>,
  next: Record<string, Token[]>
): boolean {
  const currentKeys = Object.keys(current)
  return (
    currentKeys.length === Object.keys(next).length &&
    currentKeys.every((key) => current[key] === next[key])
  )
}

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
        externalSubtitlePath: undefined,
        externalSubtitleProvenance:
          action.history?.subtitle?.mode === 'external'
            ? action.history.subtitle.provenance
            : undefined,
        externalSubtitleEncoding: 'auto',
        subtitleOffsetMs: 0,
        subtitleOffsetsByVersion: { ...(action.history?.subtitleOffsetsByVersion ?? {}) },
        audioDelayMs: 0,
        // mpv retains A–B properties across loadfile; clear both renderer and mpv loop state on a new file.
        abLoopState: EMPTY_AB_LOOP,
        allCueTokens: {}
      }
    case 'mediaClosed':
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
