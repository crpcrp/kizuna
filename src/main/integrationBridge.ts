// Integration-status IPC bridge: a single read-only query telling
// the Options dialog's "Setup & integrations" tab which optional bundled
// binaries are actually on disk. Mirrors playerSettingsBridge.ts's
// registerXBridge + createXService pattern; the `exists` probe is injected, so
// no test ever touches the real filesystem (AGENTS.md law 3).
//
// Only the *optional* binaries are reported. mpv is not: without it the app has
// no playback engine at all and never reaches this dialog, and MeCab's
// dictionaries already report themselves through `mecab:listDicts`.

import { INTEGRATION_CHANNELS } from '../shared/ipcChannels'
import type { BundledBinaryStatus } from '../shared/integrationStatus'
import type { IpcMainHandleLike } from './ipc'

/** The slice of the integration service this bridge needs (fakeable in tests). */
export interface IntegrationServiceLike {
  binaryStatus(): BundledBinaryStatus
}

/** Registers the integration-status channel against the ipcMain-like object. */
export function registerIntegrationBridge<E>(
  ipc: IpcMainHandleLike<E>,
  service: IntegrationServiceLike
): void {
  ipc.handle(INTEGRATION_CHANNELS.binaryStatus, () => service.binaryStatus())
}

export interface CreateIntegrationServiceDeps {
  /** The resolved bundled-binary paths (resourcePaths.ts). */
  paths: { ffmpegPath: string; ffprobePath: string; ytdlpPath: string }
  /** Existence probe — never real `fs.existsSync` inside a test. */
  exists: (path: string) => boolean
}

/**
 * Composes the resolved binary paths and an existence probe into an
 * `IntegrationServiceLike`. Probed per call rather than once at startup: a user
 * who drops the missing binary into `resources/` sees the tab go green on the
 * next open instead of having to restart Kizuna.
 */
export function createIntegrationService(
  deps: CreateIntegrationServiceDeps
): IntegrationServiceLike {
  return {
    binaryStatus(): BundledBinaryStatus {
      return {
        ffmpeg: deps.exists(deps.paths.ffmpegPath),
        ffprobe: deps.exists(deps.paths.ffprobePath),
        ytdlp: deps.exists(deps.paths.ytdlpPath)
      }
    }
  }
}
