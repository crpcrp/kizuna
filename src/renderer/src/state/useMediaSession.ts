import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type Dispatch,
  type RefObject
} from 'react'
import type { KizunaApi } from '../../../shared/preloadApi'
import type { Cue } from '../../../shared/cue'
import type { SubtitleEncoding } from '../../../shared/subtitleEncoding'
import type { PlayerApi } from '../components/BottomBar'
import type { MediaMenuProps } from '../components/menu/MediaMenu'
import type { SubtitleMenuProps } from '../components/menu/SubtitleMenu'
import { handleDroppedFiles } from './dropHandling'
import { performFileNavigation } from './keyActions'
import type { OpenMediaResult, OpenSession, SubtitleRequestToken } from './mediaSession'
import {
  appendPathsToPlaylist,
  appendPlaylistFile,
  type PlaylistAppendResult,
  type PlaylistAppendDeps
} from './playlistAppend'
import {
  createPlaylistController,
  type PlaylistControllerState,
  type PlaylistLoadDeps
} from './playlistController'
import type { PlayerAction, PlayerState } from './playerState'
import { createRecentFilesController } from './recentFilesController'
import { loadExternalSubtitle, loadSubtitleFromPicker, selectSubtitle } from './trackSelection'
import { useLatestCallback, useLatestRef } from './useLatestRef'

/** The render-driven fields this feature reads. */
type SessionState = Pick<
  PlayerState,
  'externalSubtitleEncoding' | 'externalSubtitlePath' | 'filePath' | 'selectedSubtitleId' | 'tracks'
>

export interface UseMediaSessionInput {
  bridge: KizunaApi
  dispatch: Dispatch<PlayerAction>
  player: Pick<PlayerApi, 'setPause'>
  state: SessionState
  stateRef: RefObject<PlayerState>
}

export interface PlaylistViewModel {
  state: PlaylistControllerState
  play(index: number): void
  remove(index: number): void
  move(from: number, to: number): void
  setRepeat(repeat: PlaylistControllerState['playlist']['repeat']): void
  toggleShuffle(): void
}

export interface MediaSessionEvents {
  openPath(path: string): Promise<OpenMediaResult>
  handleOpenNeighbor(direction: 'prev' | 'next'): Promise<void>
  isMediaOpening(): boolean
  isPlaylistPlaybackCurrent(filePath: string | undefined): boolean
  handlePlaylistEof(): Promise<boolean>
  nextPlaylist(): Promise<void>
  previousPlaylist(): Promise<void>
  reportError(message: string): void
}

export interface MediaSessionBanner {
  message: string | undefined
  dismiss(): void
  reportError(message: string): void
  reportTransient(message: string, ttlMs?: number): void
}

export interface UseMediaSessionResult {
  mediaMenu: Omit<MediaMenuProps, 'onTogglePlaylist' | 'playlistOpen' | 'onExit'>
  subtitleMenu: Pick<
    SubtitleMenuProps,
    'mediaOpening' | 'onChangeExternalSubtitleEncoding' | 'onLoadSubtitleFile' | 'onSelectSubtitle'
  >
  playlist: PlaylistViewModel
  events: MediaSessionEvents
  banner: MediaSessionBanner
  navigate(direction: 'prev' | 'next'): void
}

/**
 * Owns the renderer media-session lifecycle: opening media, recents, queue
 * navigation, file drops, and local subtitles.
 * The returned groups match their UI consumers instead of exposing one flat
 * application-controller contract.
 */
export function useMediaSession({
  bridge,
  dispatch,
  player,
  state,
  stateRef
}: UseMediaSessionInput): UseMediaSessionResult {
  const subtitleToken = useRef<SubtitleRequestToken>({ current: 0 })
  const subtitleCueCache = useRef(new Map<number, Cue[]>())
  const fileLoadToken = useRef<SubtitleRequestToken>({ current: 0 })

  const [recentFiles] = useState(createRecentFilesController)
  const recentFilesState = useSyncExternalStore(
    recentFiles.subscribe,
    () => recentFiles.getState(),
    () => recentFiles.getState()
  )
  const [playlistController] = useState(createPlaylistController)
  const playlistState = useSyncExternalStore(
    playlistController.subscribe,
    () => playlistController.getState(),
    () => playlistController.getState()
  )
  const openSession = useLatestCallback((): OpenSession & { bridge: KizunaApi } => ({
    bridge,
    dispatch,
    subtitleToken: subtitleToken.current,
    cueCache: subtitleCueCache.current,
    fileToken: fileLoadToken.current,
    onPlaylistPicked: (paths) => {
      playlistController.clear()
      playlistController.addPaths(paths)
    }
  }))
  const openPath = useLatestCallback((path: string): Promise<OpenMediaResult> =>
    recentFiles.openPath(openSession(), path)
  )
  const playlistLoadDeps = useLatestCallback((): PlaylistLoadDeps => ({
    load: openPath,
    play: () => player.setPause(false)
  }))
  const playlistAppendDeps = useLatestCallback((): PlaylistAppendDeps => ({
    readPlaylist: (path) => bridge.media.readPlaylist(path),
    addPaths: async (paths) => {
      await playlistController.addPathsAndMaybePlay(
        paths,
        stateRef.current.filePath !== undefined,
        playlistLoadDeps()
      )
    }
  }))
  const reportPlaylistAppendResult = useLatestCallback((result: PlaylistAppendResult): void => {
    if (result.status === 'empty') recentFiles.reportError('Playlist is empty.')
    if (result.status === 'unreadable') recentFiles.reportError('Could not read the playlist.')
  })
  const addFilesToPlaylist = useLatestCallback(async (): Promise<void> => {
    try {
      const paths = await bridge.media.openFiles()
      if (paths.length === 0) return
      const result = await appendPathsToPlaylist(paths, playlistAppendDeps())
      reportPlaylistAppendResult(result)
    } catch {
      recentFiles.reportError('Could not add files to the playlist.')
    }
  })
  const addFolderToPlaylist = useLatestCallback(async (): Promise<void> => {
    try {
      const paths = await bridge.media.openFolder()
      if (paths.length === 0) return
      const result = await appendPathsToPlaylist(paths, playlistAppendDeps())
      reportPlaylistAppendResult(result)
    } catch {
      recentFiles.reportError('Could not add the folder to the playlist.')
    }
  })
  const savePlaylist = useLatestCallback(async (): Promise<void> => {
    try {
      const path = await bridge.media.savePlaylist(playlistController.getState().playlist.entries)
      if (path === undefined) return
    } catch {
      recentFiles.reportError('Could not save the playlist.')
    }
  })

  const handleOpenNeighbor = useCallback(
    async (direction: 'prev' | 'next'): Promise<void> => {
      const current = stateRef.current
      if (!current.filePath || recentFiles.getState().mediaOpening) return
      const neighbors = await bridge.media.folderNeighbors(current.filePath)
      const target = direction === 'next' ? neighbors.next : neighbors.prev
      if (target) void openPath(target)
    },
    [bridge.media, openPath, recentFiles, stateRef]
  )

  const navigate = useCallback(
    (direction: 'prev' | 'next'): void => {
      performFileNavigation(direction, {
        playlistActive: playlistController.isPlaybackCurrent(stateRef.current.filePath),
        onNextFile: () => void handleOpenNeighbor('next'),
        onPrevFile: () => void handleOpenNeighbor('prev'),
        onPlaylistNext: () => void playlistController.next(playlistLoadDeps()),
        onPlaylistPrev: () => void playlistController.prev(playlistLoadDeps())
      })
    },
    [handleOpenNeighbor, playlistController, playlistLoadDeps, stateRef]
  )

  const handleSelectSubtitle = (id: number | null): void => {
    if (!state.filePath) return
    const track =
      id === null ? null : state.tracks.find((item) => item.kind === 'subtitle' && item.id === id)
    if (track === undefined) return
    selectSubtitle(
      bridge,
      dispatch,
      state.filePath,
      track,
      subtitleToken.current,
      subtitleCueCache.current,
      state.externalSubtitlePath,
      state.externalSubtitleEncoding
    )
  }

  const handleChangeExternalSubtitleEncoding = (encoding: SubtitleEncoding): void => {
    if (!state.filePath || !state.externalSubtitlePath) return
    void loadExternalSubtitle(
      { ...openSession(), externalSubtitleEncoding: encoding },
      state.filePath,
      state.externalSubtitlePath
    ).then((warning) => {
      if (warning) recentFiles.reportError(warning)
    })
  }

  const currentFilePathRef = useLatestRef(state.filePath)
  const handleLoadSubtitleFile = (): void => {
    if (state.filePath === undefined) return
    void loadSubtitleFromPicker({
      expectedFilePath: state.filePath,
      currentFilePath: () => currentFilePathRef.current,
      pickPath: () => bridge.media.openSubtitleFile(),
      session: openSession(),
      reportError: recentFiles.reportError
    })
  }

  const handleDrop = (files: File[]): Promise<void> =>
    handleDroppedFiles(files, {
      hasVideo: state.filePath !== undefined,
      currentFilePath: () => currentFilePathRef.current,
      pathForFile: (file) => bridge.files.pathForFile(file),
      openPath,
      loadSubtitle: (videoPath, path) => loadExternalSubtitle(openSession(), videoPath, path),
      appendPlaylistFile: (path) => appendPlaylistFile(path, playlistAppendDeps()),
      reportError: recentFiles.reportError
    })
  const handleDropRef = useLatestRef(handleDrop)

  useEffect(() => {
    void recentFiles.init(bridge)
    return () => recentFiles.dispose()
  }, [bridge, recentFiles])
  useEffect(() => {
    const onDragOver = (event: DragEvent): void => event.preventDefault()
    const onDrop = (event: DragEvent): void => {
      event.preventDefault()
      void handleDropRef.current(Array.from(event.dataTransfer?.files ?? []))
    }
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('drop', onDrop)
    }
  }, [handleDropRef])

  const events = useMemo<MediaSessionEvents>(
    () => ({
      openPath,
      handleOpenNeighbor,
      isMediaOpening: () => recentFiles.getState().mediaOpening,
      isPlaylistPlaybackCurrent: (filePath) => playlistController.isPlaybackCurrent(filePath),
      handlePlaylistEof: () => playlistController.handleEof(playlistLoadDeps()),
      nextPlaylist: () => playlistController.next(playlistLoadDeps()),
      previousPlaylist: () => playlistController.prev(playlistLoadDeps()),
      reportError: recentFiles.reportError
    }),
    [handleOpenNeighbor, openPath, playlistController, playlistLoadDeps, recentFiles]
  )

  return {
    mediaMenu: {
      hasFile: state.filePath !== undefined,
      mediaOpening: recentFilesState.mediaOpening,
      recentFiles: recentFilesState.recentFiles,
      hasPlaylist: playlistState.playlist.entries.length > 0,
      onOpenFile: () => void recentFiles.openPicker(openSession()),
      onPrevFile: () => navigate('prev'),
      onNextFile: () => navigate('next'),
      onOpenRecent: (path) => void recentFiles.openRecent(openSession(), path),
      onClearRecentFiles: () => void recentFiles.clearRecent(bridge),
      onAddFiles: () => void addFilesToPlaylist(),
      onAddFolder: () => void addFolderToPlaylist(),
      onSavePlaylist: () => void savePlaylist()
    },
    subtitleMenu: {
      mediaOpening: recentFilesState.mediaOpening,
      onSelectSubtitle: handleSelectSubtitle,
      onLoadSubtitleFile: state.filePath ? handleLoadSubtitleFile : undefined,
      onChangeExternalSubtitleEncoding: handleChangeExternalSubtitleEncoding
    },
    playlist: {
      state: playlistState,
      play: (index) => void playlistController.playAt(index, playlistLoadDeps()),
      remove: playlistController.removeAt,
      move: playlistController.moveEntry,
      setRepeat: playlistController.setRepeat,
      toggleShuffle: () => playlistController.setShuffle(!playlistState.playlist.shuffle)
    },
    events,
    banner: {
      message: recentFilesState.errorMessage,
      dismiss: recentFiles.dismissError,
      reportError: recentFiles.reportError,
      reportTransient: recentFiles.reportTransient
    },
    navigate
  }
}
