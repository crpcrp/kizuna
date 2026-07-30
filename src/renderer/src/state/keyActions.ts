// Input routing: keyboard shortcuts, previous/next file navigation, system
// media keys, and the end-of-file auto-advance decision.

import { type Chapter } from '../../../shared/chapter'
import { type Cue } from '../../../shared/cue'
import { type MediaKeyCommand } from '../../../shared/mediaKey'
import {
  type PlayerKeyAction,
  SPEED_MAX,
  SPEED_MIN,
  SPEED_STEP
} from '../../../shared/playerSettings'
import { type PlayerApi, skipAhead, skipBack, togglePause } from '../components/BottomBar'
import {
  nextChapterStart,
  nextCue,
  prevChapterStart,
  prevCue,
  replayCue,
  seekTargetForCue
} from './cueNavigation'

/** Subset of the preload `kizuna.windowControls` bridge that performKeyAction needs. */
export interface WindowControlsBridge {
  toggleFullscreen(): void
  setFullscreen(fullscreen: boolean): void
}

export interface KeyActionDeps {
  player: PlayerApi
  windowControls: WindowControlsBridge
  paused: boolean
  fullscreen: boolean
  skipSeconds: number
  speed: number
  cues: Cue[]
  chapters: Chapter[]
  timePos: number
  subtitleOffsetMs: number
  onToggleLoopLine: () => void
  /** Advances the A–B loop cycle (no-loop → A → B → clear); see `cycleAbLoopAction`. */
  onCycleAbLoop: () => void
  /** Steps one frame forward and pauses; see `frameStepAction`. */
  onFrameStep: () => void
  /** Steps one frame back and pauses; see `frameStepAction`. */
  onFrameBack: () => void
  onNavigateLine: () => void
  onPrevFile: () => void
  onNextFile: () => void
  onScreenshot: () => void
  /** Toggles compact mini-player (picture-in-picture) mode; see `state/miniPlayer.ts`. */
  onToggleMiniPlayer: () => void
}

/**
 * Runs the side effect for a keyboard-shortcut `action` (from `keyToAction`) —
 * App.tsx's keydown effect boils down to `keyToAction` + this. Returns whether
 * the triggering key event should have `preventDefault()` called on it: true
 * for the play/pause and skip actions, whose bound keys (Space, arrows) would
 * otherwise also trigger the browser's own default handling; false for the
 * fullscreen actions, which have no conflicting default.
 */
export function performKeyAction(action: PlayerKeyAction, deps: KeyActionDeps): boolean {
  switch (action) {
    case 'togglePause':
      togglePause(deps.player, deps.paused)
      return true
    case 'toggleFullscreen':
      deps.windowControls.toggleFullscreen()
      return false
    case 'exitFullscreen':
      if (!deps.fullscreen) return false
      deps.windowControls.setFullscreen(false)
      return false
    case 'skipBack':
      skipBack(deps.player, deps.skipSeconds)
      return true
    case 'skipForward':
      skipAhead(deps.player, deps.skipSeconds)
      return true
    case 'speedDown':
      void deps.player.setSpeed(Math.max(SPEED_MIN, deps.speed - SPEED_STEP))
      return false
    case 'speedUp':
      void deps.player.setSpeed(Math.min(SPEED_MAX, deps.speed + SPEED_STEP))
      return false
    case 'speedReset':
      void deps.player.setSpeed(1)
      return false
    case 'replayLine': {
      const cue = replayCue(deps.cues, deps.timePos, deps.subtitleOffsetMs)
      if (cue) void deps.player.seek(seekTargetForCue(cue, deps.subtitleOffsetMs), true)
      return true
    }
    case 'prevLine': {
      const cue = prevCue(deps.cues, deps.timePos, deps.subtitleOffsetMs)
      if (cue) {
        deps.onNavigateLine()
        void deps.player.seek(seekTargetForCue(cue, deps.subtitleOffsetMs), true)
      }
      return true
    }
    case 'nextLine': {
      const cue = nextCue(deps.cues, deps.timePos, deps.subtitleOffsetMs)
      if (cue) {
        deps.onNavigateLine()
        void deps.player.seek(seekTargetForCue(cue, deps.subtitleOffsetMs), true)
      }
      return true
    }
    case 'loopLine':
      deps.onToggleLoopLine()
      return false
    case 'abLoop':
      deps.onCycleAbLoop()
      return false
    case 'frameStep':
      deps.onFrameStep()
      return true
    case 'frameBack':
      deps.onFrameBack()
      return true
    case 'prevFile':
      deps.onPrevFile()
      return false
    case 'nextFile':
      deps.onNextFile()
      return false
    case 'prevChapter': {
      const start = prevChapterStart(deps.chapters, deps.timePos)
      if (start !== undefined) void deps.player.seek(start, true)
      return true
    }
    case 'nextChapter': {
      const start = nextChapterStart(deps.chapters, deps.timePos)
      if (start !== undefined) void deps.player.seek(start, true)
      return true
    }
    case 'screenshot':
      deps.onScreenshot()
      return false
    case 'miniPlayer':
      deps.onToggleMiniPlayer()
      return false
  }
}

/** Dependencies for file navigation routing. */
export interface FileNavigationDeps {
  playlistActive: boolean
  onNextFile: () => void
  onPrevFile: () => void
  onPlaylistNext: () => void
  onPlaylistPrev: () => void
}

/**
 * Routes explicit previous/next navigation to the active playlist when it owns
 * playback, otherwise to the same-folder neighbor handlers.
 */
export function performFileNavigation(direction: 'prev' | 'next', deps: FileNavigationDeps): void {
  if (direction === 'next') {
    if (deps.playlistActive) deps.onPlaylistNext()
    else deps.onNextFile()
    return
  }
  if (deps.playlistActive) deps.onPlaylistPrev()
  else deps.onPrevFile()
}

/** Dependencies `performMediaKey` routes a system media command to.
 * `next`/`prev` split on `playlistActive`: when the play queue owns playback
 * (`playlistController.isPlaybackCurrent`, mirroring the EOF path) they advance
 * the queue via `onPlaylistNext`/`onPlaylistPrev`; otherwise they fall back to
 * App's same-folder `onNextFile`/`onPrevFile`. So a hardware media key or a
 * taskbar Next button advances the active playlist instead of leaving it for
 * the adjacent folder file. */
export interface MediaKeyDeps extends FileNavigationDeps {
  player: PlayerApi
  paused: boolean
}

/**
 * Pure: runs the side effect for a system media command (a keyboard media key
 * or a taskbar thumbnail-toolbar button — see `main/services/systemMedia.ts`).
 * `playPause` toggles pause through the same helper the play button uses;
 * `next`/`prev` advance the play queue when it owns playback, else the
 * same-folder neighbor (see `MediaKeyDeps`); `stop` pauses and seeks to the
 * start, matching a player's Stop button. Never throws: the player calls are
 * fire-and-forget like the other transport actions.
 */
export function performMediaKey(command: MediaKeyCommand, deps: MediaKeyDeps): void {
  switch (command) {
    case 'playPause':
      togglePause(deps.player, deps.paused)
      return
    case 'next':
      performFileNavigation('next', deps)
      return
    case 'prev':
      performFileNavigation('prev', deps)
      return
    case 'stop':
      void deps.player.setPause(true)
      void deps.player.seek(0, true)
      return
  }
}

/**
 * True only on the false→true EOF edge while folder auto-advance can safely
 * open. An active playlist (`playlistActive`) suppresses folder-advance: the
 * queue decides what plays next and takes precedence (see
 * `playlistController.handleEof`).
 */
export function shouldAutoAdvance(
  prevEof: boolean,
  eof: boolean,
  autoPlayNext: boolean,
  mediaOpening: boolean,
  filePath: string | undefined,
  playlistActive = false
): boolean {
  return (
    !prevEof && eof && autoPlayNext && !mediaOpening && filePath !== undefined && !playlistActive
  )
}

export type EofAction = 'playlist' | 'folder' | 'none'

// Decides who handles an EOF rising edge. An explicit play queue is a
// deliberate "what plays next" statement and takes EOF precedence over the
// folder-advance option — so the queue branch is NOT gated by autoPlayNext
// (only by the open lock). Folder auto-advance stays gated by autoPlayNext
// via shouldAutoAdvance.
export function eofAction(
  prevEof: boolean,
  eof: boolean,
  autoPlayNext: boolean,
  mediaOpening: boolean,
  filePath: string | undefined,
  queueDriving: boolean
): EofAction {
  const risingEdge = !prevEof && eof
  if (queueDriving && risingEdge && !mediaOpening) return 'playlist'
  if (shouldAutoAdvance(prevEof, eof, autoPlayNext, mediaOpening, filePath, queueDriving)) {
    return 'folder'
  }
  return 'none'
}
