import type { Dispatch, RefObject, SetStateAction } from 'react'
import {
  enterMiniPlayer,
  exitMiniPlayer,
  type MiniPlayerEffect,
  type MiniPlayerState
} from './miniPlayer'
import type { KizunaApi } from '../../../shared/preloadApi'
import type { PlayerState } from './playerState'
import { useLatestCallback } from './useLatestRef'

export interface UseMiniPlayerInput {
  setMiniPlayer: Dispatch<SetStateAction<MiniPlayerState>>
  miniPlayerRef: RefObject<MiniPlayerState>
  alwaysOnTop: boolean
  setAlwaysOnTop: Dispatch<SetStateAction<boolean>>
  windowControls: Pick<
    KizunaApi['windowControls'],
    'getBounds' | 'setBounds' | 'setAlwaysOnTop' | 'toggleFullscreen'
  >
  /** Read-only: whether the window is currently fullscreen (mini never enters over it). */
  stateRef: RefObject<Pick<PlayerState, 'fullscreen'>>
  topBarRef: RefObject<HTMLDivElement | null>
  bottomBarRef: RefObject<HTMLDivElement | null>
}

export interface UseMiniPlayerResult {
  /** Applies a mini-player transition's effect: flips the mode, mirrors the
   * always-on-top flag both in state and to the window, and asks main to
   * set the bounds (mini corner computed main-side, or the restored explicit
   * rectangle). Returns the setBounds promise so callers that must sequence a
   * later window operation (fullscreen) can await the resize first. */
  applyMiniPlayerEffect: (
    nextState: MiniPlayerState,
    effect: MiniPlayerEffect | null
  ) => Promise<unknown>
  /** View → "Mini player" / Ctrl+M: enter the compact corner window (saving the
   * current bounds + always-on-top to restore on exit) or leave it. */
  handleToggleMiniPlayer: () => Promise<void>
  /** Fullscreen wins over mini-player: mini and fullscreen are mutually
   * exclusive, so toggling fullscreen while mini can only mean entering it.
   * Tear mini down first (restoring the saved bounds *before* the fullscreen
   * request, so main captures the original size as the pre-fullscreen
   * rectangle) and only then flip fullscreen. */
  toggleFullscreenFromKey: () => void
}

/**
 * Owns the compact mini-player (picture-in-picture) enter/exit orchestration:
 * applying a transition's window-bounds/always-on-top effect, the toggle
 * handler (fullscreen-wins guard, saved-bounds capture on entry), and the
 * fullscreen-key wrapper that tears mini down before a fullscreen request.
 * See `docs/codebase-map.md` for the invariants this preserves.
 */
export function useMiniPlayer({
  miniPlayerRef,
  setMiniPlayer,
  alwaysOnTop,
  setAlwaysOnTop,
  windowControls,
  stateRef,
  topBarRef,
  bottomBarRef
}: UseMiniPlayerInput): UseMiniPlayerResult {
  // Stable identity (see useLatestCallback): usePlayerEvents' mount-once
  // fullscreen subscription depends on this, and must not re-subscribe on every
  // App render. The forwarded closure is still the newest one.
  const applyMiniPlayerEffect = useLatestCallback(
    (nextState: MiniPlayerState, effect: MiniPlayerEffect | null): Promise<unknown> => {
      setMiniPlayer(nextState)
      if (!effect) return Promise.resolve()
      setAlwaysOnTop(effect.alwaysOnTop)
      windowControls.setAlwaysOnTop(effect.alwaysOnTop)
      return Promise.resolve(windowControls.setBounds(effect.bounds))
    }
  )

  const handleToggleMiniPlayer = async (): Promise<void> => {
    if (miniPlayerRef.current.active) {
      const { state, effect } = exitMiniPlayer(miniPlayerRef.current)
      await applyMiniPlayerEffect(state, effect)
      return
    }
    // Fullscreen wins: never enter mini while fullscreen. Doing so would leave
    // the renderer both `fullscreen` and `miniPlayerActive` (hiding the normal
    // chrome twice over) and would capture fullscreen-sized bounds as the mini
    // restore target. Exit fullscreen first, then press Mini player.
    if (stateRef.current.fullscreen) return
    const savedBounds = await windowControls.getBounds()
    if (!savedBounds) return
    const topBarHeight = topBarRef.current?.querySelector<HTMLElement>('#chrome')?.offsetHeight ?? 0
    const bottomBarHeight = bottomBarRef.current?.offsetHeight ?? 0
    const { state, effect } = enterMiniPlayer({
      savedBounds,
      wasAlwaysOnTop: alwaysOnTop,
      topBarHeight,
      bottomBarHeight
    })
    await applyMiniPlayerEffect(state, effect)
  }

  const toggleFullscreenFromKey = (): void => {
    void (async () => {
      if (miniPlayerRef.current.active) {
        const { state, effect } = exitMiniPlayer(miniPlayerRef.current)
        await applyMiniPlayerEffect(state, effect)
      }
      windowControls.toggleFullscreen()
    })()
  }

  return { applyMiniPlayerEffect, handleToggleMiniPlayer, toggleFullscreenFromKey }
}
