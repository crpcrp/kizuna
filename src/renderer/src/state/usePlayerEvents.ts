import { useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react'
import type { KizunaApi } from '../../../shared/preloadApi'
import type { PlayerApi } from '../components/BottomBar'
import { eofAction, performMediaKey, type OpenMediaResult } from './playerActions'
import type { PlayerAction, PlayerState } from './playerState'
import {
  INACTIVE_MINI_PLAYER,
  miniPlayerForFullscreen,
  type MiniPlayerEffect,
  type MiniPlayerState
} from './miniPlayer'
import { registerLaunchOpenHandler } from './appShell'
import type { RecentFilesController } from './recentFilesController'
import type { PlaylistController, PlaylistLoadDeps } from './playlistController'

export interface UsePlayerEventsInput {
  dispatch: Dispatch<PlayerAction>
  bridge: KizunaApi
  playerAdapter: PlayerApi
  /** Opens the same-folder neighbor in `direction` (EOF folder auto-advance, media keys). */
  handleOpenNeighbor: (direction: 'prev' | 'next') => Promise<void>
  stateRef: RefObject<Pick<PlayerState, 'autoPlayNext' | 'filePath' | 'paused'>>
  recentFiles: RecentFilesController
  playlistController: PlaylistController
  playlistLoadDeps: () => PlaylistLoadDeps
  miniPlayerRef: RefObject<MiniPlayerState>
  setMiniPlayer: Dispatch<SetStateAction<MiniPlayerState>>
  setAlwaysOnTop: Dispatch<SetStateAction<boolean>>
  applyMiniPlayerEffect: (
    nextState: MiniPlayerState,
    effect: MiniPlayerEffect | null
  ) => Promise<unknown>
  /** The shared App-level OpenSession/openPath closure (see App.tsx) — a
   * launch-delivered path is opened through the same pipeline as every
   * other direct open. */
  openPath: (path: string) => Promise<OpenMediaResult>
}

/** Wires mpv/window event pushes and file-association launch delivery. */
export function usePlayerEvents({
  dispatch,
  bridge,
  playerAdapter,
  handleOpenNeighbor,
  stateRef,
  recentFiles,
  playlistController,
  playlistLoadDeps,
  miniPlayerRef,
  setMiniPlayer,
  setAlwaysOnTop,
  applyMiniPlayerEffect,
  openPath
}: UsePlayerEventsInput): void {
  const prevEofRef = useRef(false)
  const deferredFullscreenMiniExitRef = useRef<MiniPlayerEffect | null>(null)

  // mpv time/duration/EOF pushes + window fullscreen transitions.
  useEffect(() => {
    const offTimePos = bridge.player.onTimePos((value) => dispatch({ type: 'timePos', value }))
    const offDuration = bridge.player.onDuration((value) => dispatch({ type: 'duration', value }))
    // mpv is the source of truth for pause: this reflects self-pauses the
    // renderer never issued (frame-step lands here, EOF with keep-open).
    const offPause = bridge.player.onPause((value) => dispatch({ type: 'setPaused', value }))
    const offFullscreen = bridge.windowControls.onFullscreenChange((value) => {
      dispatch({ type: 'setFullscreen', value })
      const deferredExit = deferredFullscreenMiniExitRef.current
      if (!value && deferredExit) {
        deferredFullscreenMiniExitRef.current = null
        void applyMiniPlayerEffect(INACTIVE_MINI_PLAYER, deferredExit)
        return
      }
      const { state: nextMini, effect } = miniPlayerForFullscreen(miniPlayerRef.current, value)
      if (!effect) return
      // Native/OS fullscreen pushes arrive after the window is already
      // fullscreen. Restore mini bounds only when fullscreen leaves; setting
      // bounds while fullscreen would poison main's fullscreen restore target.
      deferredFullscreenMiniExitRef.current = effect
      setMiniPlayer(nextMini)
      setAlwaysOnTop(effect.alwaysOnTop)
      bridge.windowControls.setAlwaysOnTop(effect.alwaysOnTop)
    })
    const offEof = bridge.player.onEofReached((value) => {
      if (typeof value !== 'boolean') return
      const current = stateRef.current
      const mediaOpening = recentFiles.getState().mediaOpening
      // The queue drives EOF only while the file that just ended is its current
      // entry — queueing files behind an unrelated video must not hijack that
      // video's EOF (which would skip entry 0 from a phantom currentIndex).
      const queueDriving = playlistController.isPlaybackCurrent(current.filePath)
      // An explicit queue takes EOF precedence regardless of autoPlayNext (it is
      // gated only by the open lock); folder auto-advance stays gated by autoPlayNext.
      const action = eofAction(
        prevEofRef.current,
        value,
        current.autoPlayNext,
        mediaOpening,
        current.filePath,
        queueDriving
      )
      if (action === 'playlist') {
        void playlistController.handleEof(playlistLoadDeps())
      } else if (action === 'folder') {
        void handleOpenNeighbor('next')
      }
      prevEofRef.current = value
    })
    // System media keys / taskbar thumbnail buttons. Next/Prev advance the play
    // queue when it owns playback (isPlaybackCurrent, matching the EOF path),
    // else the same-folder neighbor. Live pause/file state is read from the refs
    // so the effect doesn't re-subscribe on every change.
    const offMediaKey = bridge.player.onMediaKey((command) =>
      performMediaKey(command, {
        player: playerAdapter,
        paused: stateRef.current.paused,
        playlistActive: playlistController.isPlaybackCurrent(stateRef.current.filePath),
        onNextFile: () => void handleOpenNeighbor('next'),
        onPrevFile: () => void handleOpenNeighbor('prev'),
        onPlaylistNext: () => void playlistController.next(playlistLoadDeps()),
        onPlaylistPrev: () => void playlistController.prev(playlistLoadDeps())
      })
    )
    return () => {
      offTimePos()
      offDuration()
      offPause()
      offFullscreen()
      offEof()
      offMediaKey()
    }
    // Only handleOpenNeighbor and playerAdapter can actually re-fire this: the
    // rest are render-stable (the preload bridge, refs, the reducer's dispatch,
    // state setters, and the useState-held / useLatestCallback controllers).
  }, [
    handleOpenNeighbor,
    playerAdapter,
    bridge.player,
    bridge.windowControls,
    dispatch,
    stateRef,
    miniPlayerRef,
    recentFiles,
    playlistController,
    playlistLoadDeps,
    setMiniPlayer,
    setAlwaysOnTop,
    applyMiniPlayerEffect
  ])

  useEffect(
    () =>
      registerLaunchOpenHandler({
        bridge,
        openPath,
        reportError: (message) => recentFiles.reportError(message)
      }),
    [bridge, openPath, recentFiles]
  )
}
