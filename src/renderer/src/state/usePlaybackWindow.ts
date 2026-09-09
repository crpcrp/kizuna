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
import { toggleSidebar } from './appChrome'
import { useAudioDevices } from './audioDevices'
import type { BulkMiningPresentation } from './bulkMiningPresentation'
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

/** The persisted per-file (and app-wide picture) values this feature applies to
 * mpv. Held in refs, not state: they are read and written outside the render
 * path, and only the current file's entry ever needs to reach the reducer. */
export interface PerFileValueRefs {
  /** Per-file subtitle offsets (ms), keyed by file path. */
  subtitleOffsetsRef: RefObject<Record<string, number>>
  /** Per-folder subtitle offsets (ms), the fallback for any file in the folder
   * with no per-file entry — written by the Subtitle menu's "Apply to folder". */
  folderSubtitleOffsetsRef: RefObject<Record<string, number>>
  /** Per-file audio delays (ms), keyed by file path. */
  audioDelaysRef: RefObject<Record<string, number>>
  /** Latest app-wide picture adjustments, mirrored here so the per-load
   * re-apply can read them without depending on the state value (which would
   * re-fire it on every slider drag). */
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
  /** Side-panel visibility, restored by `useSettingsLifecycle` and persisted by
   * the toggles returned below. */
  panels: PlaybackWindowPanels
  /** Bulk mining's presentation, which reserves right-stack width like a panel. */
  miningPresentation: BulkMiningPresentation
  /** Initially-known mpv outputs, for deterministic renderer integration tests. */
  initialAudioDevices?: AudioDevice[]
  /** Reports playback-operation failures through the media banner. */
  reportError: (message: string) => void
}

/** Refs the composition root attaches to the chrome and side-panel elements.
 * Their measured sizes drive mpv's video margins, the mini-player rectangle,
 * and both window-sizing paths. */
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
  /** Gates the reduced chrome across the whole layout. */
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
  /** The mini-player bindings mpv/window event pushes drive directly. */
  playerEvents: Pick<
    UsePlayerEventsInput,
    'applyMiniPlayerEffect' | 'miniPlayerRef' | 'setAlwaysOnTop' | 'setMiniPlayer'
  >
  /** Whether the seekbar can show frame previews for the current media. */
  thumbnailsEnabled: boolean
}

/**
 * Owns the renderer's playback and window lifecycle: audio/subtitle menu
 * commands, the per-file values applied after every load, side-panel sizing,
 * the Video ▸ Size presets, fullscreen, the mini player, and picture
 * adjustments. The returned groups match their UI consumers instead of
 * exposing one flat application-controller contract.
 */
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
  // The left-side stack holds the playlist; measured so mpv stays out from
  // under it too, exactly like the right stack.
  const leftSidebarStackRef = useRef<HTMLElement>(null)
  // Drops frame-step presses while a previous step's IPC invoke is still in
  // flight, so holding the key down can't flood mpv's command queue.
  const frameStepGuard = useRef<FrameStepGuard>({ inFlight: false })
  const [videoAdjustmentsOpen, setVideoAdjustmentsOpen] = useState(false)
  // Native pixel resolution of the current file's video stream, used by the
  // Video menu's size presets; undefined until fetched (or if there's no
  // video stream).
  const [videoDimensions, setVideoDimensions] = useState<VideoDimensions | undefined>(undefined)
  const [alwaysOnTop, setAlwaysOnTop] = useState(false)
  // Compact mini-player (picture-in-picture) mode. `miniPlayer.active` gates the
  // reduced chrome; the ref mirror lets the toggle-fullscreen wrapper read the
  // current mode without re-subscribing. See `state/miniPlayer.ts`.
  const [miniPlayer, setMiniPlayer] = useState<MiniPlayerState>(INACTIVE_MINI_PLAYER)
  const miniPlayerRef = useLatestRef(miniPlayer)
  const miniPlayerActive = miniPlayer.active

  // mpv output selection (list refresh, explicit picks, per-load re-apply).
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

  // Applies the current file's persisted subtitle offset (its own entry, else
  // its folder's — see subtitleOffsetForFile) and fetches its video stream's
  // native resolution (for the Video menu's size presets) whenever a new file
  // loads. Both offset refs are populated by the settings-load effect (or
  // already hold this file's entry if it was set earlier this session).
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

  // Updates the current subtitle offset immediately and persists it keyed by
  // the current file path, so re-opening the file later re-applies it.
  const handleSubtitleOffsetChange = (valueMs: number): void => {
    dispatch({ type: 'setSubtitleOffset', value: valueMs })
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

  // Applies the audio delay immediately and persists it keyed by the current
  // file path, mirroring handleSubtitleOffsetChange.
  const handleAudioDelayChange = (valueMs: number): void => {
    dispatch({ type: 'setAudioDelay', value: valueMs })
    void bridge.player.setAudioDelay(valueMs)
    if (!state.filePath) return
    audioDelaysRef.current = nextAudioDelays(audioDelaysRef.current, state.filePath, valueMs)
    settingsPersistenceRef.current.schedule({ audioDelays: audioDelaysRef.current })
  }

  // Subtitle menu > "Apply to folder": makes the current offset the default for
  // every video in this file's folder, present and future.
  const handleApplyOffsetToFolder = (): void => {
    if (!state.filePath || state.externalSubtitleProvenance) return
    applyOffsetToFolder(
      { subtitleOffsets: subtitleOffsetsRef, folderSubtitleOffsets: folderSubtitleOffsetsRef },
      state.filePath,
      state.subtitleOffsetMs,
      (patch) => settingsPersistenceRef.current.schedule(patch)
    )
  }

  // Audio menu > track list. Ignores ids with no matching audio track, and
  // does nothing without a loaded file (there is no stream to switch).
  const handleSelectAudio = (id: number): void => {
    const track = state.tracks.find((t) => t.kind === 'audio' && t.id === id)
    if (state.filePath && track) selectAudio(bridge, dispatch, state.filePath, track)
  }

  const handleToggleLoudnessNorm = (): void => {
    const next = !state.loudnessNormalization
    dispatch({ type: 'setLoudnessNormalization', value: next })
    void bridge.player.setLoudnessNorm(next)
  }

  // Video menu > frame stepping, shared by the menu rows and the shortcut keys.
  // The guard drops repeat presses while a step is still in flight.
  const handleFrameStep = (direction: 'forward' | 'back'): void => {
    frameStepAction(bridge.player, direction, state.filePath !== undefined, frameStepGuard.current)
  }

  // Video menu > "Adjustments…" panel: applies the new picture-adjustments block
  // to mpv live and persists it app-wide (not per file). The ref is updated in
  // lockstep so the per-load re-apply reads the latest value.
  const handleChangeVideoAdjustments = (next: VideoAdjustments): void => {
    videoAdjustmentsRef.current = next
    dispatch({ type: 'setVideoAdjustments', value: next })
    applyVideoAdjustments(bridge.player, next)
  }

  const handleToggleAlwaysOnTop = (): void => {
    const next = !alwaysOnTop
    setAlwaysOnTop(next)
    bridge.windowControls.setAlwaysOnTop(next)
  }

  const handleToggleSidebar = (): void => {
    toggleSidebar(sidebarOpen, setSidebarOpen, (patch) =>
      settingsPersistenceRef.current.schedule(patch)
    )
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
      onApplyOffsetToFolder:
        state.filePath && !state.externalSubtitleProvenance ? handleApplyOffsetToFolder : undefined,
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
