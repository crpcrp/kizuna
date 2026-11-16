import { PLAYER_CHANNELS } from '../../shared/ipcChannels'
import type { MediaKeyCommand } from '../../shared/mediaKey'

export type { MediaKeyCommand }

const MEDIA_KEY_BINDINGS: ReadonlyArray<readonly [accelerator: string, command: MediaKeyCommand]> =
  [
    ['MediaPlayPause', 'playPause'],
    ['MediaNextTrack', 'next'],
    ['MediaPreviousTrack', 'prev'],
    ['MediaStop', 'stop']
  ]

export interface GlobalShortcutLike {
  register(accelerator: string, callback: () => void): boolean
  unregister(accelerator: string): void
}

export type ProgressBarMode = 'none' | 'normal' | 'indeterminate' | 'paused' | 'error'

// Electron clears taskbar progress with a negative value or mode none.
export type SetProgressBar = (progress: number, options?: { mode: ProgressBarMode }) => void

export interface ThumbarButton {
  icon: unknown
  tooltip?: string
  click: () => void
}

export type SetThumbarButtons = (buttons: ThumbarButton[]) => void

export interface SystemMediaIcons {
  prev: unknown
  play: unknown
  pause: unknown
  next: unknown
}

export interface SystemMediaSnapshot {
  fileLoaded: boolean
  paused: boolean
  timePos: number
  duration: number
}

export interface SystemMediaController {
  update(snapshot: SystemMediaSnapshot): void
  dispose(): void
}

interface SystemMediaDeps {
  globalShortcut: GlobalShortcutLike
  setProgressBar: SetProgressBar
  setThumbarButtons: SetThumbarButtons
  send: (channel: string, value: unknown) => void
  icons: SystemMediaIcons
}

// Hold media keys only while a file is loaded so idle Kizuna does not steal them from other apps.
export function createSystemMediaController(deps: SystemMediaDeps): SystemMediaController {
  const { globalShortcut, setProgressBar, setThumbarButtons, send, icons } = deps

  let shortcutsRegistered = false
  let progressShown = false
  let lastProgressAt = 0
  let lastProgressMode: ProgressBarMode | null = null
  let thumbarShown: 'play' | 'pause' | null = null

  const push = (command: MediaKeyCommand): void => send(PLAYER_CHANNELS.mediaKey, command)

  const registerShortcuts = (): void => {
    for (const [accelerator, command] of MEDIA_KEY_BINDINGS) {
      // Another app may own a media key; failure must not prevent startup.
      const ok = globalShortcut.register(accelerator, () => push(command))
      if (!ok) console.warn(`[kizuna] media key ${accelerator} could not be registered`)
    }
    shortcutsRegistered = true
  }

  const unregisterShortcuts = (): void => {
    for (const [accelerator] of MEDIA_KEY_BINDINGS) globalShortcut.unregister(accelerator)
    shortcutsRegistered = false
  }

  const syncThumbar = (fileLoaded: boolean, paused: boolean): void => {
    if (!fileLoaded) {
      if (thumbarShown !== null) {
        setThumbarButtons([])
        thumbarShown = null
      }
      return
    }
    const middle = paused ? 'play' : 'pause'
    if (thumbarShown === middle) return
    setThumbarButtons([
      { icon: icons.prev, tooltip: 'Previous', click: () => push('prev') },
      {
        icon: paused ? icons.play : icons.pause,
        tooltip: paused ? 'Play' : 'Pause',
        click: () => push('playPause')
      },
      { icon: icons.next, tooltip: 'Next', click: () => push('next') }
    ])
    thumbarShown = middle
  }

  const syncProgress = (snapshot: SystemMediaSnapshot): void => {
    if (!snapshot.fileLoaded) {
      if (progressShown) {
        setProgressBar(-1)
        progressShown = false
        lastProgressMode = null
      }
      return
    }
    const { paused, timePos, duration } = snapshot
    const known = Number.isFinite(duration) && duration > 0
    const mode: ProgressBarMode = !known ? 'indeterminate' : paused ? 'paused' : 'normal'
    const progress = known ? Math.min(1, Math.max(0, timePos / duration)) : 0
    // Throttle position updates, but emit mode changes immediately.
    const t = Date.now()
    const modeChanged = mode !== lastProgressMode
    if (progressShown && !modeChanged && t - lastProgressAt < 1000) return
    setProgressBar(progress, { mode })
    progressShown = true
    lastProgressMode = mode
    lastProgressAt = t
  }

  return {
    update(snapshot: SystemMediaSnapshot): void {
      if (snapshot.fileLoaded && !shortcutsRegistered) registerShortcuts()
      else if (!snapshot.fileLoaded && shortcutsRegistered) unregisterShortcuts()
      syncThumbar(snapshot.fileLoaded, snapshot.paused)
      syncProgress(snapshot)
    },
    dispose(): void {
      if (shortcutsRegistered) unregisterShortcuts()
      if (progressShown) {
        setProgressBar(-1)
        progressShown = false
      }
      if (thumbarShown !== null) {
        setThumbarButtons([])
        thumbarShown = null
      }
    }
  }
}
