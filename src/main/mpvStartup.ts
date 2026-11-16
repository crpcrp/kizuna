/** Argv-shaping options forwarded to `MpvController.start`. */
export interface MpvStartOptions {
  mpvPath: string
  windowId: bigint | string
  userConfigDir?: string
  extraArgs?: string[]
}

const MPV_CONFIG_ERROR_MESSAGE =
  'Your mpv config failed to load, so mpv started with it disabled. Check mpv.conf in the mpv config folder.'

export interface StartMpvWithConfigDeps {
  mpvPath: string
  windowId: bigint | string
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

// A failed start cleans up mpv, so retrying without a broken user config is safe.
export async function startMpvWithConfig(deps: StartMpvWithConfigDeps): Promise<void> {
  const { mpvUserConfig, mpvExtraArgs } = deps.settings
  const userConfigDir = mpvUserConfig ? deps.configDir : undefined
  // Give the user a drop target the first time they enable their own config.
  if (mpvUserConfig) deps.ensureConfigDir()

  try {
    await deps.start({
      mpvPath: deps.mpvPath,
      windowId: deps.windowId,
      userConfigDir,
      extraArgs: mpvExtraArgs
    })
  } catch (err) {
    if (!userConfigDir) throw err // no user config in play — nothing to fall back to
    deps.warn?.(err)
    // The retry drops only the user config.
    await deps.start({
      mpvPath: deps.mpvPath,
      windowId: deps.windowId,
      extraArgs: mpvExtraArgs
    })
    deps.reportConfigError(MPV_CONFIG_ERROR_MESSAGE)
  }
}
