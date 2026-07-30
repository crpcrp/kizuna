import { describe, it, expect, vi } from 'vitest'
import {
  startMpvWithConfig,
  MPV_CONFIG_ERROR_MESSAGE,
  type MpvStartOptions,
  type StartMpvWithConfigDeps
} from '@src/main/mpvStartup'

function makeDeps(overrides: Partial<StartMpvWithConfigDeps> = {}): {
  deps: StartMpvWithConfigDeps
  start: ReturnType<typeof vi.fn>
  ensureConfigDir: ReturnType<typeof vi.fn>
  reportConfigError: ReturnType<typeof vi.fn>
  warn: ReturnType<typeof vi.fn>
} {
  const start = vi.fn(async (_opts: MpvStartOptions) => {})
  const ensureConfigDir = vi.fn()
  const reportConfigError = vi.fn()
  const warn = vi.fn()
  const deps: StartMpvWithConfigDeps = {
    mpvPath: 'mpv.exe',
    hwnd: 658188n,
    settings: { mpvUserConfig: false, mpvExtraArgs: [] },
    configDir: '/data/userData/mpv',
    ensureConfigDir,
    start,
    reportConfigError,
    warn,
    ...overrides
  }
  return { deps, start, ensureConfigDir, reportConfigError, warn }
}

describe('startMpvWithConfig', () => {
  it('with config disabled: no dir creation, one start with --no-config semantics, no banner', async () => {
    const { deps, start, ensureConfigDir, reportConfigError } = makeDeps({
      settings: { mpvUserConfig: false, mpvExtraArgs: ['--hwdec=auto'] }
    })

    await startMpvWithConfig(deps)

    expect(ensureConfigDir).not.toHaveBeenCalled()
    expect(start).toHaveBeenCalledTimes(1)
    expect(start).toHaveBeenCalledWith({
      mpvPath: 'mpv.exe',
      hwnd: 658188n,
      userConfigDir: undefined,
      extraArgs: ['--hwdec=auto']
    })
    expect(reportConfigError).not.toHaveBeenCalled()
  })

  it('with config enabled and a clean start: ensures the dir and passes the config dir once', async () => {
    const { deps, start, ensureConfigDir, reportConfigError } = makeDeps({
      settings: { mpvUserConfig: true, mpvExtraArgs: ['--profile=gpu-hq'] }
    })

    await startMpvWithConfig(deps)

    expect(ensureConfigDir).toHaveBeenCalledTimes(1)
    expect(start).toHaveBeenCalledTimes(1)
    expect(start).toHaveBeenCalledWith({
      mpvPath: 'mpv.exe',
      hwnd: 658188n,
      userConfigDir: '/data/userData/mpv',
      extraArgs: ['--profile=gpu-hq']
    })
    expect(reportConfigError).not.toHaveBeenCalled()
  })

  it('with config enabled and a broken config: retries without the config dir and reports the banner', async () => {
    const start = vi
      .fn<(opts: MpvStartOptions) => Promise<void>>()
      .mockRejectedValueOnce(new Error('mpv exited: bad mpv.conf'))
      .mockResolvedValueOnce(undefined)
    const { deps, ensureConfigDir, reportConfigError, warn } = makeDeps({
      settings: { mpvUserConfig: true, mpvExtraArgs: ['--vo=gpu'] },
      start
    })

    await startMpvWithConfig(deps)

    expect(ensureConfigDir).toHaveBeenCalledTimes(1)
    expect(start).toHaveBeenCalledTimes(2)
    // First attempt carries the config dir; the retry drops it (extraArgs kept).
    expect(start).toHaveBeenNthCalledWith(1, {
      mpvPath: 'mpv.exe',
      hwnd: 658188n,
      userConfigDir: '/data/userData/mpv',
      extraArgs: ['--vo=gpu']
    })
    expect(start).toHaveBeenNthCalledWith(2, {
      mpvPath: 'mpv.exe',
      hwnd: 658188n,
      extraArgs: ['--vo=gpu']
    })
    expect(warn).toHaveBeenCalledTimes(1)
    expect(reportConfigError).toHaveBeenCalledWith(MPV_CONFIG_ERROR_MESSAGE)
  })

  it('forwards the yt-dlp path to the clean-start attempt (ytdl hook)', async () => {
    const { deps, start } = makeDeps({
      ytdlpPath: '/data/resources/yt-dlp/yt-dlp.exe',
      settings: { mpvUserConfig: false, mpvExtraArgs: [] }
    })

    await startMpvWithConfig(deps)

    expect(start).toHaveBeenCalledTimes(1)
    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({ ytdlpPath: '/data/resources/yt-dlp/yt-dlp.exe' })
    )
  })

  it('keeps the yt-dlp path on the config-disabled retry so streaming survives a broken mpv.conf', async () => {
    const start = vi
      .fn<(opts: MpvStartOptions) => Promise<void>>()
      .mockRejectedValueOnce(new Error('bad mpv.conf'))
      .mockResolvedValueOnce(undefined)
    const { deps } = makeDeps({
      ytdlpPath: '/data/resources/yt-dlp/yt-dlp.exe',
      settings: { mpvUserConfig: true, mpvExtraArgs: [] },
      start
    })

    await startMpvWithConfig(deps)

    expect(start).toHaveBeenCalledTimes(2)
    // Both the first attempt and the config-dropping retry carry the hook path.
    expect(start).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ ytdlpPath: '/data/resources/yt-dlp/yt-dlp.exe' })
    )
    expect(start).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ ytdlpPath: '/data/resources/yt-dlp/yt-dlp.exe' })
    )
    // The retry still drops the user config dir.
    expect(start).toHaveBeenNthCalledWith(
      2,
      expect.not.objectContaining({ userConfigDir: '/data/userData/mpv' })
    )
  })

  it('with config disabled and a failing start: rethrows without retrying or reporting', async () => {
    const err = new Error('mpv missing')
    const start = vi.fn<(opts: MpvStartOptions) => Promise<void>>().mockRejectedValue(err)
    const { deps, reportConfigError } = makeDeps({
      settings: { mpvUserConfig: false, mpvExtraArgs: [] },
      start
    })

    await expect(startMpvWithConfig(deps)).rejects.toBe(err)
    expect(start).toHaveBeenCalledTimes(1)
    expect(reportConfigError).not.toHaveBeenCalled()
  })

  it('propagates a retry failure and never reports the banner', async () => {
    const retryErr = new Error('mpv still broken')
    const start = vi
      .fn<(opts: MpvStartOptions) => Promise<void>>()
      .mockRejectedValueOnce(new Error('bad config'))
      .mockRejectedValueOnce(retryErr)
    const { deps, reportConfigError } = makeDeps({
      settings: { mpvUserConfig: true, mpvExtraArgs: [] },
      start
    })

    await expect(startMpvWithConfig(deps)).rejects.toBe(retryErr)
    expect(start).toHaveBeenCalledTimes(2)
    expect(reportConfigError).not.toHaveBeenCalled()
  })
})
