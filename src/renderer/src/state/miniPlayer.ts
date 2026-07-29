// Pure mini-player (picture-in-picture) mode transitions. No React, no window,
// no preload — the App orchestrator turns each returned effect into the actual
// `window:setBounds` / `setAlwaysOnTop` calls and UI-state flip. Kept pure so
// the enter/exit/fullscreen-wins rules are unit-testable in isolation.

import type { SetWindowBoundsRequest, WindowBounds } from '../../../shared/windowBounds'
import type { SubtitleStyleSettings } from '../../../shared/playerSettings'

/** What must be remembered on the way into mini-player to restore on the way
 * out: the pre-mini window rectangle and the always-on-top flag as it was
 * (mini forces always-on-top on; exiting must not clobber a user who already
 * had it on). */
export interface MiniPlayerSnapshot {
  savedBounds: WindowBounds
  wasAlwaysOnTop: boolean
}

/** Mini-player is a two-state machine: off, or on with the restore snapshot. */
export type MiniPlayerState = { active: false } | { active: true; snapshot: MiniPlayerSnapshot }

/** Starting/neutral state — mini-player off. */
export const INACTIVE_MINI_PLAYER: MiniPlayerState = { active: false }

/** The side effects a transition asks the orchestrator to apply. */
export interface MiniPlayerEffect {
  /** Passed straight to `window:setBounds`. */
  bounds: SetWindowBoundsRequest
  /** Desired always-on-top after the transition. */
  alwaysOnTop: boolean
  /** Which chrome layout the renderer should render. */
  uiState: 'mini' | 'normal'
}

/**
 * Enters mini-player. Stores the pre-mini bounds and prior always-on-top flag
 * so `exitMiniPlayer` can put them back, and returns the effect: ask main for
 * the mini rectangle (corner computed main-side from the current display's work
 * area), force always-on-top on, and switch to the reduced `mini` chrome.
 */
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

/**
 * Exits mini-player, restoring the saved window bounds and the always-on-top
 * flag as it was before entering. A no-op (null effect) when not active, so a
 * stray exit can never resize a normal window to stale bounds.
 */
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

/**
 * Fullscreen wins over mini-player: entering fullscreen while mini is active
 * exits mini first (its exit effect is returned so the orchestrator restores
 * the saved bounds/always-on-top before the fullscreen transition takes over).
 * Any other case — leaving fullscreen, or entering it while not mini — is a
 * no-op that leaves the state untouched.
 */
export function miniPlayerForFullscreen(
  state: MiniPlayerState,
  enteringFullscreen: boolean
): { state: MiniPlayerState; effect: MiniPlayerEffect | null } {
  if (enteringFullscreen && state.active) return exitMiniPlayer(state)
  return { state, effect: null }
}

/** Subtitle font-scale multiplier applied while in mini-player, so text stays
 * legible against the shrunken 480×270 video without touching the persisted
 * `subtitleStyle`. */
export const MINI_PLAYER_SUBTITLE_SCALE = 0.6

/**
 * Pure: the subtitle style to render with. In mini-player the persisted font
 * scale is multiplied down by `MINI_PLAYER_SUBTITLE_SCALE`; otherwise the
 * style is returned unchanged. Never mutates the input — a fresh object is
 * returned only when scaling actually applies.
 */
export function miniPlayerSubtitleStyle(
  style: SubtitleStyleSettings,
  active: boolean
): SubtitleStyleSettings {
  if (!active) return style
  return { ...style, fontScale: style.fontScale * MINI_PLAYER_SUBTITLE_SCALE }
}
