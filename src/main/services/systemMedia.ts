// Windows system media integration: keyboard media keys, taskbar progress,
// and thumbnail-toolbar buttons. Electron-free like powerSave.ts: every OS
// surface (globalShortcut, BrowserWindow.setProgressBar / setThumbarButtons) and
// the renderer push are injected, so the service is exercised with fakes and no
// live Electron. index.ts constructs it with the real pieces, injecting
// no-op thumbar/progress functions on non-Windows.

import { PLAYER_CHANNELS } from '../../shared/ipcChannels'
import type { MediaKeyCommand } from '../../shared/mediaKey'

export type { MediaKeyCommand }

/**
 * The accelerators registered while a file is loaded, each mapped to the command
 * pushed when it fires. Order is fixed so tests can assert it deterministically.
 */
export const MEDIA_KEY_BINDINGS: ReadonlyArray<
  readonly [accelerator: string, command: MediaKeyCommand]
> = [
  ['MediaPlayPause', 'playPause'],
  ['MediaNextTrack', 'next'],
  ['MediaPreviousTrack', 'prev'],
  ['MediaStop', 'stop']
]

/** The slice of Electron's globalShortcut this service needs. */
export interface GlobalShortcutLike {
  register(accelerator: string, callback: () => void): boolean
  unregister(accelerator: string): void
}

/** Taskbar progress modes (subset of Electron's setProgressBar options.mode). */
export type ProgressBarMode = 'none' | 'normal' | 'indeterminate' | 'paused' | 'error'

/** BrowserWindow.setProgressBar. A negative progress (or mode 'none') clears it. */
export type SetProgressBar = (progress: number, options?: { mode: ProgressBarMode }) => void

/** One thumbnail-toolbar button (subset of Electron's ThumbarButton). */
export interface ThumbarButton {
  icon: unknown
  tooltip?: string
  click: () => void
}

/** BrowserWindow.setThumbarButtons; injected as a no-op on non-Windows. */
export type SetThumbarButtons = (buttons: ThumbarButton[]) => void

/** The icons the thumbnail toolbar draws; opaque to the service (NativeImage in
 * the real app) so it never imports Electron. */
export interface SystemMediaIcons {
  prev: unknown
  play: unknown
  pause: unknown
  next: unknown
}

/** The playback facts the service reacts to, forwarded from playerBridge's mpv
 * property observers. */
export interface SystemMediaSnapshot {
  fileLoaded: boolean
  paused: boolean
  timePos: number
  duration: number
}

export interface SystemMediaController {
  /** Idempotent: registers/updates media keys, thumbnail buttons, and taskbar
   * progress for the current playback snapshot. Progress updates are throttled
   * (see below); shortcuts/buttons only change on a state transition. */
  update(snapshot: SystemMediaSnapshot): void
  /** Releases the media-key shortcuts and clears the taskbar surfaces (quit). */
  dispose(): void
}

export interface SystemMediaDeps {
  globalShortcut: GlobalShortcutLike
  setProgressBar: SetProgressBar
  setThumbarButtons: SetThumbarButtons
  /** Real impl: `webContents.send` — pushes `PLAYER_CHANNELS.mediaKey`. */
  send: (channel: string, value: unknown) => void
  icons: SystemMediaIcons
  /** Injected clock for the ≥1/sec progress throttle (default `Date.now`). */
  now?: () => number
}

/**
 * Builds the system-media controller. Media-key shortcuts are held only while a
 * file is loaded (registering permanently would steal the keys from other apps
 * when idle); taskbar progress mirrors timePos/duration, throttled to at most
 * one update per second because the timePos observer fires far more often; the
 * thumbnail toolbar carries prev / play-pause / next, its middle icon following
 * the pause state. Every surface routes back through `send` so the renderer owns
 * what each command actually does.
 */
export function createSystemMediaController(deps: SystemMediaDeps): SystemMediaController {
  const { globalShortcut, setProgressBar, setThumbarButtons, send, icons } = deps
  const now = deps.now ?? ((): number => Date.now())

  let shortcutsRegistered = false
  let progressShown = false
  let lastProgressAt = 0
  let lastProgressMode: ProgressBarMode | null = null
  let thumbarShown: 'play' | 'pause' | null = null

  const push = (command: MediaKeyCommand): void => send(PLAYER_CHANNELS.mediaKey, command)

  const registerShortcuts = (): void => {
    for (const [accelerator, command] of MEDIA_KEY_BINDINGS) {
      // register returns false when another app already owns the key: log and
      // carry on — never throw at startup over one unavailable media key.
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
    // Loading or malformed files report no usable duration — show indeterminate rather
    // than dividing by zero into a NaN progress.
    const known = Number.isFinite(duration) && duration > 0
    const mode: ProgressBarMode = !known ? 'indeterminate' : paused ? 'paused' : 'normal'
    const progress = known ? Math.min(1, Math.max(0, timePos / duration)) : 0
    // Throttle the frequent timePos-driven updates to ≥1/sec, but always emit on
    // the first update after a load and whenever the mode changes (pause toggled,
    // or the duration just became known) so those never wait out the interval.
    const t = now()
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
