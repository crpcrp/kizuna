import { useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react'
import { effectiveAudioDevice, type AudioDevice } from '../../../shared/audioDevice'
import type { VideoAdjustments } from '../../../shared/playerSettings'
import type { KizunaApi } from '../../../shared/preloadApi'
import type { VideoDimensions } from '../../../shared/track'
import type { AudioMenuProps } from '../components/menu/AudioMenu'
import type { PlaybackMenuProps } from '../components/menu/PlaybackMenu'
import type { SubtitleMenuProps } from '../components/menu/SubtitleMenu'
import type { VideoMenuProps } from '../components/menu/VideoMenu'
import type { PlaybackTabProps } from '../components/options/PlaybackTab'
import { useAudioDevices } from './audioDevices'
import type { BulkMiningPresentation } from './useBulkMining'
import { INACTIVE_MINI_PLAYER, type MiniPlayerState } from './miniPlayer'
import { applyOffsetToFolder, nextAudioDelays, nextSubtitleOffsets } from './perFileOffsets'
import { applyVideoAdjustments, frameStepAction, type FrameStepGuard } from './playbackCommands'
import type { PlayerAction, PlayerState } from './playerState'
import type { SettingsPersistence } from './settingsPersistence'
import { selectAudio } from './trackSelection'
import type { KeyboardShortcutContext } from './useKeyboardShortcuts'
import { useLatestRef } from './useLatestRef'
import { useMiniPlayer } from './useMiniPlayer'
import { usePerFileRestore } from './usePerFileRestore'
import type { UsePlayerEventsInput } from './usePlayerEvents'
import { useVideoMargins } from './useVideoMargins'
import { useVideoWindowSizing } from './useVideoWindowSizing'

type PlaybackWindowState = Pick<
  PlayerState,
  | 'audioDelayMs'
  | 'audioDevice'
  | 'filePath'
  | 'fullscreen'
  | 'loadGeneration'
  | 'loudnessNormalization'
  | 'subtitleOffsetMs'
  | 'subtitleOffsetsByVersion'
  | 'externalSubtitleProvenance'
  | 'tracks'
>

// Keep persisted per-file values in refs; only the current file needs to reach the reducer.
export interface PerFileValueRefs {
  subtitleOffsetsRef: RefObject<Record<string, number>>
  /** Per-folder subtitle offsets (ms), the fallback for any file in the folder
   * with no per-file entry — written by the Subtitle menu's "Apply to folder". */
  folderSubtitleOffsetsRef: RefObject<Record<string, number>>
  audioDelaysRef: RefObject<Record<string, number>>
  // Read picture adjustments through a ref so slider changes do not retrigger per-load restoration.
  videoAdjustmentsRef: RefObject<VideoAdjustments>
}

export interface PlaybackWindowPanels {
  sidebarOpen: boolean
  playlistOpen: boolean
  setSidebarOpen: Dispatch<SetStateAction<boolean>>
  setPlaylistOpen: Dispatch<SetStateAction<boolean>>
}

export interface UsePlaybackWindowInput {
  bridge: KizunaApi
  dispatch: Dispatch<PlayerAction>
  state: PlaybackWindowState
  stateRef: RefObject<PlayerState>
  perFileValues: PerFileValueRefs
  settingsPersistenceRef: RefObject<SettingsPersistence>
  /** False until `settings.json` has been read (or failed to read): the
   * per-load restore and the window-size baseline both wait for it. */
  settingsReady: boolean
  panels: PlaybackWindowPanels
  miningPresentation: BulkMiningPresentation
  initialAudioDevices?: AudioDevice[]
  reportError: (message: string) => void
}

export interface PlaybackWindowLayoutRefs {
  topBar: RefObject<HTMLDivElement | null>
  bottomBar: RefObject<HTMLDivElement | null>
  leftSidebarStack: RefObject<HTMLElement | null>
  rightSidebarStack: RefObject<HTMLElement | null>
}

export interface PanelToggles {
  onToggleSidebar(): void
  onTogglePlaylist(): void
}

export interface MiniPlayerViewModel {
  active: boolean
  toggle(): void
}

export interface FullscreenViewModel {
  /** Plain window toggle (BottomBar's button). The keyboard/menu toggle, which
   * tears the mini player down first, is in `keyboard.windowControls`. */
  toggle(): void
}

export interface VideoAdjustmentsDialogViewModel {
  open: boolean
  onChange(next: VideoAdjustments): void
  onClose(): void
}

export interface UsePlaybackWindowResult {
  layoutRefs: PlaybackWindowLayoutRefs
  audioMenu: Omit<AudioMenuProps, 'tracks' | 'selectedAudioId'>
  videoMenu: Pick<
    VideoMenuProps,
    | 'alwaysOnTop'
    | 'miniPlayer'
    | 'onOpenVideoAdjustments'
    | 'onSetVideoScale'
    | 'onToggleAlwaysOnTop'
    | 'onToggleMiniPlayer'
  >
  subtitleMenu: Pick<
    SubtitleMenuProps,
    'onApplyOffsetToFolder' | 'onChangeSubtitleOffset' | 'onToggleSidebar' | 'subtitleOffsetMs'
  >
  playbackMenu: Pick<PlaybackMenuProps, 'hasFile' | 'onFrameBack' | 'onFrameStep'>
  optionsPlayback: Pick<
    PlaybackTabProps,
    | 'audioDevices'
    | 'audioDeviceSelectionPending'
    | 'loudnessNormalization'
    | 'onAudioDevicesRequest'
    | 'onSelectAudioDevice'
    | 'onToggleLoudnessNorm'
    | 'selectedAudioDevice'
  >
  panels: PanelToggles
  miniPlayer: MiniPlayerViewModel
  fullscreen: FullscreenViewModel
  videoAdjustmentsDialog: VideoAdjustmentsDialogViewModel
  keyboard: Pick<
    KeyboardShortcutContext,
    'onFrameBack' | 'onFrameStep' | 'onToggleMiniPlayer' | 'windowControls'
  >
  playerEvents: Pick<
    UsePlayerEventsInput,
    'applyMiniPlayerEffect' | 'miniPlayerRef' | 'setAlwaysOnTop' | 'setMiniPlayer'
  >
  thumbnailsEnabled: boolean
}

export function usePlaybackWindow({
  bridge,
  dispatch,
  state,
  stateRef,
  perFileValues,
  settingsPersistenceRef,
  settingsReady,
  panels,
  miningPresentation,
  initialAudioDevices = [],
  reportError
}: UsePlaybackWindowInput): UsePlaybackWindowResult {
  const { subtitleOffsetsRef, folderSubtitleOffsetsRef, audioDelaysRef, videoAdjustmentsRef } =
    perFileValues
  const { sidebarOpen, playlistOpen, setSidebarOpen, setPlaylistOpen } = panels
  // Measured to keep the mpv video frame out from under these bars.
  const topBarRef = useRef<HTMLDivElement>(null)
  const bottomBarRef = useRef<HTMLDivElement>(null)
  // The shared right-side stack is measured once to keep mpv out from under
  // either (or both) sidebar surfaces.
  const rightSidebarStackRef = useRef<HTMLElement>(null)
  const leftSidebarStackRef = useRef<HTMLElement>(null)
  // Drops frame-step presses while a previous step's IPC invoke is still in
  // flight, so holding the key down can't flood mpv's command queue.
  const frameStepGuard = useRef<FrameStepGuard>({ inFlight: false })
  const [videoAdjustmentsOpen, setVideoAdjustmentsOpen] = useState(false)
  const [videoDimensions, setVideoDimensions] = useState<VideoDimensions | undefined>(undefined)
  const [alwaysOnTop, setAlwaysOnTop] = useState(false)
  // Mirror mini-player mode in a ref so fullscreen toggling reads it without resubscribing.
  const [miniPlayer, setMiniPlayer] = useState<MiniPlayerState>(INACTIVE_MINI_PLAYER)
  const miniPlayerRef = useLatestRef(miniPlayer)
  const miniPlayerActive = miniPlayer.active

  const audioDeviceController = useAudioDevices({
    player: bridge.player,
    dispatch,
    storedDeviceRef: stateRef,
    initialDevices: initialAudioDevices,
    reportError
  })

  const { applyMiniPlayerEffect, handleToggleMiniPlayer, toggleFullscreenFromKey } = useMiniPlayer({
    setMiniPlayer,
    miniPlayerRef,
    alwaysOnTop,
    setAlwaysOnTop,
    windowControls: bridge.windowControls,
    stateRef,
    topBarRef,
    bottomBarRef
  })

  useVideoMargins({
    topBarRef,
    bottomBarRef,
    rightSidebarStackRef,
    leftSidebarStackRef,
    fullscreen: state.fullscreen,
    sidebarOpen,
    playlistOpen,
    miningPresentation,
    miniPlayerActive,
    player: bridge.player
  })

  usePerFileRestore({
    dispatch,
    bridge,
    filePath: state.filePath,
    loadGeneration: state.loadGeneration,
    settingsReady,
    playbackSettingsRef: stateRef,
    subtitleOffsetsRef,
    folderSubtitleOffsetsRef,
    subtitleOffsetsByVersion: state.subtitleOffsetsByVersion,
    externalSubtitleProvenance: state.externalSubtitleProvenance,
    audioDelaysRef,
    videoAdjustmentsRef,
    reapplyAudioDevice: audioDeviceController.reapplyAfterLoad,
    setVideoDimensions
  })

  const { onSetVideoScale } = useVideoWindowSizing({
    topBarRef,
    bottomBarRef,
    leftSidebarStackRef,
    rightSidebarStackRef,
    videoDimensions,
    fullscreen: state.fullscreen,
    miniPlayerActive,
    settingsReady,
    sidebarOpen,
    playlistOpen,
    setWindowSize: (width, height) => bridge.windowControls.setSize(width, height)
  })

  const handleSubtitleOffsetChange = (valueMs: number): void => {
    dispatch({ type: 'set', patch: { subtitleOffsetMs: valueMs } })
    if (!state.filePath) return
    if (state.externalSubtitleProvenance) {
      const { contentVersion } = state.externalSubtitleProvenance
      dispatch({ type: 'setSubtitleVersionOffset', contentVersion, value: valueMs })
      void bridge.mediaHistory
        .setSubtitleVersionOffset(state.filePath, contentVersion, valueMs)
        .catch(() => reportError('Could not save subtitle offset.'))
      return
    }
    subtitleOffsetsRef.current = nextSubtitleOffsets(
      subtitleOffsetsRef.current,
      state.filePath,
      valueMs
    )
    settingsPersistenceRef.current.schedule({ subtitleOffsets: subtitleOffsetsRef.current })
  }

  const handleAudioDelayChange = (valueMs: number): void => {
    dispatch({ type: 'set', patch: { audioDelayMs: valueMs } })
    void bridge.player.setAudioDelay(valueMs)
    if (!state.filePath) return
    audioDelaysRef.current = nextAudioDelays(audioDelaysRef.current, state.filePath, valueMs)
    settingsPersistenceRef.current.schedule({ audioDelays: audioDelaysRef.current })
  }

  const handleApplyOffsetToFolder = (): void => {
    if (!state.filePath) return
    applyOffsetToFolder(
      { subtitleOffsets: subtitleOffsetsRef, folderSubtitleOffsets: folderSubtitleOffsetsRef },
      state.filePath,
      state.subtitleOffsetMs,
      (patch) => settingsPersistenceRef.current.schedule(patch)
    )
  }

  const handleSelectAudio = (id: number): void => {
    const track = state.tracks.find((t) => t.kind === 'audio' && t.id === id)
    if (state.filePath && track) selectAudio(bridge, dispatch, state.filePath, track)
  }

  const handleToggleLoudnessNorm = (): void => {
    const next = !state.loudnessNormalization
    dispatch({ type: 'set', patch: { loudnessNormalization: next } })
    void bridge.player.setLoudnessNorm(next)
  }

  const handleFrameStep = (direction: 'forward' | 'back'): void => {
    frameStepAction(bridge.player, direction, state.filePath !== undefined, frameStepGuard.current)
  }

  const handleChangeVideoAdjustments = (next: VideoAdjustments): void => {
    videoAdjustmentsRef.current = next
    dispatch({ type: 'set', patch: { videoAdjustments: next } })
    applyVideoAdjustments(bridge.player, next)
  }

  const handleToggleAlwaysOnTop = (): void => {
    const next = !alwaysOnTop
    setAlwaysOnTop(next)
    bridge.windowControls.setAlwaysOnTop(next)
  }

  const handleToggleSidebar = (): void => {
    const next = !sidebarOpen
    setSidebarOpen(next)
    settingsPersistenceRef.current.schedule({ sidebarOpen: next })
  }

  const handleTogglePlaylist = (): void => {
    const next = !playlistOpen
    setPlaylistOpen(next)
    settingsPersistenceRef.current.schedule({ playlistOpen: next })
  }

  return {
    layoutRefs: {
      topBar: topBarRef,
      bottomBar: bottomBarRef,
      leftSidebarStack: leftSidebarStackRef,
      rightSidebarStack: rightSidebarStackRef
    },
    audioMenu: {
      hasFile: state.filePath !== undefined,
      audioDelayMs: state.audioDelayMs,
      onSelectAudio: handleSelectAudio,
      onChangeAudioDelay: handleAudioDelayChange
    },
    videoMenu: {
      alwaysOnTop,
      miniPlayer: miniPlayerActive,
      onSetVideoScale,
      onOpenVideoAdjustments: () => setVideoAdjustmentsOpen(true),
      onToggleAlwaysOnTop: handleToggleAlwaysOnTop,
      onToggleMiniPlayer: () => void handleToggleMiniPlayer()
    },
    subtitleMenu: {
      subtitleOffsetMs: state.subtitleOffsetMs,
      onChangeSubtitleOffset: handleSubtitleOffsetChange,
      onApplyOffsetToFolder: state.filePath ? handleApplyOffsetToFolder : undefined,
      onToggleSidebar: handleToggleSidebar
    },
    playbackMenu: {
      hasFile: state.filePath !== undefined,
      onFrameStep: () => handleFrameStep('forward'),
      onFrameBack: () => handleFrameStep('back')
    },
    optionsPlayback: {
      audioDevices: audioDeviceController.devices,
      audioDeviceSelectionPending: audioDeviceController.selectionPending,
      selectedAudioDevice: effectiveAudioDevice(state.audioDevice, audioDeviceController.devices),
      onSelectAudioDevice: audioDeviceController.selectDevice,
      onAudioDevicesRequest: audioDeviceController.requestDevices,
      loudnessNormalization: state.loudnessNormalization,
      onToggleLoudnessNorm: handleToggleLoudnessNorm
    },
    panels: {
      onToggleSidebar: handleToggleSidebar,
      onTogglePlaylist: handleTogglePlaylist
    },
    miniPlayer: {
      active: miniPlayerActive,
      toggle: () => void handleToggleMiniPlayer()
    },
    fullscreen: {
      toggle: () => bridge.windowControls.toggleFullscreen()
    },
    videoAdjustmentsDialog: {
      open: videoAdjustmentsOpen,
      onChange: handleChangeVideoAdjustments,
      onClose: () => setVideoAdjustmentsOpen(false)
    },
    keyboard: {
      windowControls: {
        toggleFullscreen: toggleFullscreenFromKey,
        setFullscreen: (fullscreen) => bridge.windowControls.setFullscreen(fullscreen)
      },
      onFrameStep: () => handleFrameStep('forward'),
      onFrameBack: () => handleFrameStep('back'),
      onToggleMiniPlayer: () => void handleToggleMiniPlayer()
    },
    playerEvents: {
      miniPlayerRef,
      setMiniPlayer,
      setAlwaysOnTop,
      applyMiniPlayerEffect
    },
    thumbnailsEnabled: videoDimensions !== undefined && state.filePath !== undefined
  }
}
