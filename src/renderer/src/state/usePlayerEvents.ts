import { useEffect, useRef, type Dispatch, type RefObject, type SetStateAction } from 'react'
import type { KizunaApi } from '../../../shared/preloadApi'
import type { PlayerApi } from '../components/BottomBar'
import { eofAction, performMediaKey } from './keyActions'
import { type OpenMediaResult } from './mediaSession'
import type { PlayerAction, PlayerState } from './playerState'
import {
  INACTIVE_MINI_PLAYER,
  miniPlayerForFullscreen,
  type MiniPlayerEffect,
  type MiniPlayerState
} from './miniPlayer'
import type { MediaSessionEvents } from './useMediaSession'

interface LaunchHandlerDeps {
  bridge: Pick<KizunaApi, 'launch'>
  openPath: (path: string) => Promise<OpenMediaResult>
  reportError: (message: string) => void
}

function registerLaunchOpenHandler(deps: LaunchHandlerDeps): () => void {
  const off = deps.bridge.launch.onOpenPath((path) => {
    void deps.openPath(path)
  })
  const offError = deps.bridge.launch.onError((message) => deps.reportError(message))
  deps.bridge.launch.rendererReady()
  return () => {
    off()
    offError()
  }
}

export interface UsePlayerEventsInput {
  dispatch: Dispatch<PlayerAction>
  bridge: KizunaApi
  playerAdapter: PlayerApi
  stateRef: RefObject<Pick<PlayerState, 'autoPlayNext' | 'filePath' | 'paused'>>
  mediaSession: MediaSessionEvents
  miniPlayerRef: RefObject<MiniPlayerState>
  setMiniPlayer: Dispatch<SetStateAction<MiniPlayerState>>
  setAlwaysOnTop: Dispatch<SetStateAction<boolean>>
  applyMiniPlayerEffect: (
    nextState: MiniPlayerState,
    effect: MiniPlayerEffect | null
  ) => Promise<unknown>
}

/** Wires mpv/window event pushes and file-association launch delivery. */
export function usePlayerEvents({
  dispatch,
  bridge,
  playerAdapter,
  stateRef,
  mediaSession,
  miniPlayerRef,
  setMiniPlayer,
  setAlwaysOnTop,
  applyMiniPlayerEffect
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
      const mediaOpening = mediaSession.isMediaOpening()
      // The queue drives EOF only while the file that just ended is its current
      // entry — queueing files behind an unrelated video must not hijack that
      // video's EOF (which would skip entry 0 from a phantom currentIndex).
      const queueDriving = mediaSession.isPlaylistPlaybackCurrent(current.filePath)
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
        void mediaSession.handlePlaylistEof()
      } else if (action === 'folder') {
        void mediaSession.handleOpenNeighbor('next')
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
        playlistActive: mediaSession.isPlaylistPlaybackCurrent(stateRef.current.filePath),
        onNextFile: () => void mediaSession.handleOpenNeighbor('next'),
        onPrevFile: () => void mediaSession.handleOpenNeighbor('prev'),
        onPlaylistNext: () => void mediaSession.nextPlaylist(),
        onPlaylistPrev: () => void mediaSession.previousPlaylist()
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
    // The player adapter and media-session event group are render-stable; the
    // remaining values are the preload bridge, refs, reducer dispatch and
    // state setters.
  }, [
    playerAdapter,
    bridge.player,
    bridge.windowControls,
    dispatch,
    stateRef,
    miniPlayerRef,
    mediaSession,
    setMiniPlayer,
    setAlwaysOnTop,
    applyMiniPlayerEffect
  ])

  useEffect(
    () =>
      registerLaunchOpenHandler({
        bridge,
        openPath: mediaSession.openPath,
        reportError: mediaSession.reportError
      }),
    [bridge, mediaSession]
  )
}
