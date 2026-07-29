// App-quit wiring. Split out from index.ts so it's unit-testable with fakes
// instead of a live Electron session/controller.

/** Subset of Electron's Session used on quit. */
export interface FlushableSession {
  flushStorageData(): void
}

/** Subset of MpvController used on quit. */
export interface QuittableController {
  quit(): Promise<void>
}

/**
 * Runs on 'before-quit'. Electron's renderer localStorage is backed by a
 * store that commits writes to disk asynchronously — a quit that follows
 * shortly after a write can race the commit and lose it, which looks exactly
 * like "my setting didn't persist" even though the write itself succeeded.
 * flushStorageData forces any pending writes to disk before mpv is torn down
 * and the process exits. See bugs.json's "subtitle position doesn't persist"
 * report. (Options-menu settings — keybindings, skip amount, popup/subtitle
 * style — no longer go through localStorage; they're persisted synchronously
 * via settings.json, see services/settings.ts's PlayerSettings.)
 */
export function handleBeforeQuit(
  defaultSession: FlushableSession,
  controller: QuittableController,
  flushHistory: () => void = () => {},
  releasePowerSave: () => void = () => {},
  disposeSystemMedia: () => void = () => {},
  cleanupUrlSubtitles: () => void = () => {}
): void {
  // Release the media-key global shortcuts (and clear the taskbar surfaces)
  // first: leaving them registered past quit would keep stealing the keys from
  // other apps.
  disposeSystemMedia()
  releasePowerSave()
  // Best-effort removal of the session-only URL-subtitle download cache: remote
  // subtitle assets are never persisted, so nothing outlives quit.
  cleanupUrlSubtitles()
  flushHistory()
  defaultSession.flushStorageData()
  void controller.quit()
}
