// Feature 2 — mpv startup orchestration, extracted from index.ts so the
// config-enabled / no-config-retry / warning-banner paths are unit-testable
// without an Electron BrowserWindow or a real mpv process (AGENTS.md law 2/3).
// Every side effect (spawn+connect, dir creation, error reporting, logging) is
// injected.

/** Argv-shaping options forwarded to `MpvController.start`. */
export interface MpvStartOptions {
  mpvPath: string
  hwnd: bigint | string
  userConfigDir?: string
  extraArgs?: string[]
  /** Bundled yt-dlp path (Feature 9); enables mpv's ytdl hook when present. */
  ytdlpPath?: string
}

/** Shown to the user when their own mpv config broke startup and we retried
 * without it. Exported so the test asserts the exact banner text. */
export const MPV_CONFIG_ERROR_MESSAGE =
  'Your mpv config failed to load, so mpv started with it disabled. Check mpv.conf in the mpv config folder.'

export interface StartMpvWithConfigDeps {
  mpvPath: string
  hwnd: bigint | string
  /** Bundled yt-dlp path (Feature 9); forwarded to every `start` attempt so mpv
   * gets the ytdl hook. Undefined when the binary isn't bundled — mpv still
   * plays direct-stream URLs, only extractor-backed ones stop resolving. */
  ytdlpPath?: string
  /** The persisted mpv settings block (mpvUserConfig / mpvExtraArgs). */
  settings: { mpvUserConfig: boolean; mpvExtraArgs: string[] }
  /** Kizuna's mpv config dir, used only when `mpvUserConfig` is true. */
  configDir: string
  /** Create `<userData>/mpv/scripts` (idempotent); called only on enable. */
  ensureConfigDir(): void
  /** Spawn+connect mpv with the given argv-shaping options. */
  start(opts: MpvStartOptions): Promise<void>
  /** Surface the "config failed to load" banner to the renderer. */
  reportConfigError(message: string): void
  /** Optional logger for the retry (defaults to no-op). */
  warn?(err: unknown): void
}

/**
 * Starts mpv with the user's config settings applied, falling back to a
 * config-disabled launch if the first attempt fails. A broken `mpv.conf`
 * (e.g. `vo=` garbage) can make mpv exit at startup, surfacing as a `start`
 * rejection; `MpvController.start` already killed the process and reset its
 * state, so a retry is safe. When the retry is what succeeds, a banner tells
 * the user their config failed to load. If the user hasn't enabled their own
 * config there's nothing to retry — the original error propagates. If the
 * retry itself fails, that rejection propagates too (no banner).
 */
export async function startMpvWithConfig(deps: StartMpvWithConfigDeps): Promise<void> {
  const { mpvUserConfig, mpvExtraArgs } = deps.settings
  const userConfigDir = mpvUserConfig ? deps.configDir : undefined
  // Give the user a drop target the first time they enable their own config.
  if (mpvUserConfig) deps.ensureConfigDir()

  try {
    await deps.start({
      mpvPath: deps.mpvPath,
      hwnd: deps.hwnd,
      userConfigDir,
      extraArgs: mpvExtraArgs,
      ytdlpPath: deps.ytdlpPath
    })
  } catch (err) {
    if (!userConfigDir) throw err // no user config in play — nothing to fall back to
    deps.warn?.(err)
    // The retry drops only the user config — the ytdl hook still applies.
    await deps.start({
      mpvPath: deps.mpvPath,
      hwnd: deps.hwnd,
      extraArgs: mpvExtraArgs,
      ytdlpPath: deps.ytdlpPath
    })
    deps.reportConfigError(MPV_CONFIG_ERROR_MESSAGE)
  }
}
