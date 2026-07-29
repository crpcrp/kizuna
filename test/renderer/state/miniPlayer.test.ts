import { describe, it, expect } from 'vitest'
import {
  INACTIVE_MINI_PLAYER,
  MINI_PLAYER_SUBTITLE_SCALE,
  enterMiniPlayer,
  exitMiniPlayer,
  miniPlayerForFullscreen,
  miniPlayerSubtitleStyle,
  type MiniPlayerState
} from '@src/renderer/src/state/miniPlayer'
import { DEFAULT_SUBTITLE_STYLE } from '@src/shared/playerSettings'
import type { WindowBounds } from '@src/shared/windowBounds'

const savedBounds: WindowBounds = { x: 100, y: 50, width: 1280, height: 720 }

describe('enterMiniPlayer', () => {
  it('snapshots bounds + always-on-top and asks for the mini corner', () => {
    const { state, effect } = enterMiniPlayer({
      savedBounds,
      wasAlwaysOnTop: false,
      topBarHeight: 32,
      bottomBarHeight: 60
    })
    expect(state).toEqual({ active: true, snapshot: { savedBounds, wasAlwaysOnTop: false } })
    expect(effect).toEqual({
      bounds: { mode: 'miniPlayer', topBarHeight: 32, bottomBarHeight: 60 },
      alwaysOnTop: true,
      uiState: 'mini'
    })
  })

  it('forces always-on-top on even when it was already on (remembers the prior flag)', () => {
    const { state, effect } = enterMiniPlayer({
      savedBounds,
      wasAlwaysOnTop: true,
      topBarHeight: 32,
      bottomBarHeight: 40
    })
    expect(effect.alwaysOnTop).toBe(true)
    expect(state).toEqual({ active: true, snapshot: { savedBounds, wasAlwaysOnTop: true } })
  })
})

describe('exitMiniPlayer', () => {
  it('restores saved bounds and the prior always-on-top flag', () => {
    const active = enterMiniPlayer({
      savedBounds,
      wasAlwaysOnTop: true,
      topBarHeight: 32,
      bottomBarHeight: 60
    }).state
    const { state, effect } = exitMiniPlayer(active)
    expect(state).toEqual(INACTIVE_MINI_PLAYER)
    expect(effect).toEqual({
      bounds: { mode: 'explicit', bounds: savedBounds },
      alwaysOnTop: true,
      uiState: 'normal'
    })
  })

  it('restores always-on-top to off when it was off before entering', () => {
    const active = enterMiniPlayer({
      savedBounds,
      wasAlwaysOnTop: false,
      topBarHeight: 32,
      bottomBarHeight: 60
    }).state
    expect(exitMiniPlayer(active).effect?.alwaysOnTop).toBe(false)
  })

  it('is a no-op (null effect) when not active', () => {
    const { state, effect } = exitMiniPlayer(INACTIVE_MINI_PLAYER)
    expect(state).toBe(INACTIVE_MINI_PLAYER)
    expect(effect).toBeNull()
  })
})

describe('miniPlayerForFullscreen', () => {
  it('exits mini first when entering fullscreen while active (fullscreen wins)', () => {
    const active = enterMiniPlayer({
      savedBounds,
      wasAlwaysOnTop: false,
      topBarHeight: 32,
      bottomBarHeight: 60
    }).state
    const { state, effect } = miniPlayerForFullscreen(active, true)
    expect(state).toEqual(INACTIVE_MINI_PLAYER)
    expect(effect).toEqual({
      bounds: { mode: 'explicit', bounds: savedBounds },
      alwaysOnTop: false,
      uiState: 'normal'
    })
  })

  it('is a no-op when entering fullscreen while not in mini-player', () => {
    const { state, effect } = miniPlayerForFullscreen(INACTIVE_MINI_PLAYER, true)
    expect(state).toBe(INACTIVE_MINI_PLAYER)
    expect(effect).toBeNull()
  })

  it('is a no-op when leaving fullscreen, even if mini is somehow active', () => {
    const active: MiniPlayerState = enterMiniPlayer({
      savedBounds,
      wasAlwaysOnTop: false,
      topBarHeight: 32,
      bottomBarHeight: 60
    }).state
    const { state, effect } = miniPlayerForFullscreen(active, false)
    expect(state).toBe(active)
    expect(effect).toBeNull()
  })
})

describe('miniPlayerSubtitleStyle', () => {
  it('multiplies the font scale down while active without mutating the input', () => {
    const style = { ...DEFAULT_SUBTITLE_STYLE, fontScale: 1.5 }
    const scaled = miniPlayerSubtitleStyle(style, true)
    expect(scaled.fontScale).toBeCloseTo(1.5 * MINI_PLAYER_SUBTITLE_SCALE)
    expect(scaled.xPct).toBe(style.xPct)
    expect(scaled.yPct).toBe(style.yPct)
    expect(style.fontScale).toBe(1.5) // untouched
    expect(scaled).not.toBe(style)
  })

  it('returns the same object unchanged when inactive', () => {
    const style = { ...DEFAULT_SUBTITLE_STYLE, fontScale: 1.5 }
    expect(miniPlayerSubtitleStyle(style, false)).toBe(style)
  })
})
