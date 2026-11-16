import type { SetWindowBoundsRequest, WindowBounds } from '../../../shared/windowBounds'
import type { SubtitleStyleSettings } from '../../../shared/playerSettings'

// Restore the original always-on-top value on exit, including when it was already enabled.
interface MiniPlayerSnapshot {
  savedBounds: WindowBounds
  wasAlwaysOnTop: boolean
}

export type MiniPlayerState = { active: false } | { active: true; snapshot: MiniPlayerSnapshot }

export const INACTIVE_MINI_PLAYER: MiniPlayerState = { active: false }

export interface MiniPlayerEffect {
  bounds: SetWindowBoundsRequest
  alwaysOnTop: boolean
  uiState: 'mini' | 'normal'
}

export function enterMiniPlayer(input: {
  savedBounds: WindowBounds
  wasAlwaysOnTop: boolean
  topBarHeight: number
  bottomBarHeight: number
}): { state: MiniPlayerState; effect: MiniPlayerEffect } {
  return {
    state: {
      active: true,
      snapshot: { savedBounds: input.savedBounds, wasAlwaysOnTop: input.wasAlwaysOnTop }
    },
    effect: {
      bounds: {
        mode: 'miniPlayer',
        topBarHeight: input.topBarHeight,
        bottomBarHeight: input.bottomBarHeight
      },
      alwaysOnTop: true,
      uiState: 'mini'
    }
  }
}

export function exitMiniPlayer(state: MiniPlayerState): {
  state: MiniPlayerState
  effect: MiniPlayerEffect | null
} {
  if (!state.active) return { state, effect: null }
  return {
    state: INACTIVE_MINI_PLAYER,
    effect: {
      bounds: { mode: 'explicit', bounds: state.snapshot.savedBounds },
      alwaysOnTop: state.snapshot.wasAlwaysOnTop,
      uiState: 'normal'
    }
  }
}

// Exit mini-player before entering fullscreen so its saved bounds and always-on-top state are restored.
export function miniPlayerForFullscreen(
  state: MiniPlayerState,
  enteringFullscreen: boolean
): { state: MiniPlayerState; effect: MiniPlayerEffect | null } {
  if (enteringFullscreen && state.active) return exitMiniPlayer(state)
  return { state, effect: null }
}

// Scale subtitles for the small video without changing the persisted style.
const MINI_PLAYER_SUBTITLE_SCALE = 0.6

export function miniPlayerSubtitleStyle(
  style: SubtitleStyleSettings,
  active: boolean
): SubtitleStyleSettings {
  if (!active) return style
  return { ...style, fontScale: style.fontScale * MINI_PLAYER_SUBTITLE_SCALE }
}
