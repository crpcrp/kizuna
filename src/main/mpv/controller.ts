// Owns mpv.exe's lifecycle and translates high-level playback calls into mpv
// JSON IPC command arrays. Dependencies (spawn, IPC client) are injected so
// tests use fakes instead of a real mpv process.

import {
  isVideoRotate,
  SPEED_MAX,
  SPEED_MIN,
  VIDEO_EQ_MAX,
  VIDEO_EQ_MIN,
  type VideoEqProperty
} from '../../shared/playerSettings'
import { parseAudioDeviceList, type AudioDevice } from '../../shared/audioDevice'
import { parseTrackList, type Track, type VideoDimensions } from '../../shared/track'
import { ytdlpFormatForQuality, type YtdlpQuality } from '../../shared/ytdlpQuality'
import { spawn } from 'node:child_process'
import { MpvIpcClient, type ConnectOptions, type MpvMessage } from './ipcClient'

/**
 * `loadFile` rejection for the case where mpv accepted the `loadfile` command
 * but the file itself could not be demuxed/decoded (`end-file` reason `error`).
 * mpv has dropped to idle, so nothing is playing. This is distinct from a
 * command-send rejection (the `loadfile` command never reached/was accepted by
 * mpv), where a previously playing file keeps going — callers use the type to
 * tell "mpv is idle now" apart from "the old file is still up".
 */
export class MpvLoadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MpvLoadError'
  }
}

/**
 * `loadFile` rejection when a URL open never settled within its
 * `timeoutMs`: mpv accepted `loadfile` but emitted neither `file-loaded` nor
 * `end-file`, so the load path sent `['stop']` to unstick it. Extends
 * `MpvLoadError` because the stop drops mpv to idle exactly like a real load
 * failure — the player bridge's `instanceof MpvLoadError` check must release
 * the power-save blocker and the renderer open-lock. Distinguishable by name
 * so the renderer can show a timeout-specific message.
 */
export class MpvLoadTimeoutError extends MpvLoadError {
  constructor(message: string) {
    super(message)
    this.name = 'MpvLoadTimeoutError'
  }
}

/**
 * `loadFile` rejection when the user (or a later open) cancelled an in-flight
 * load via `cancelLoad()`. Like the timeout, it goes through the stop-and-reject
 * path and extends `MpvLoadError` so the pending open-lock is released.
 */
export class MpvLoadCancelledError extends MpvLoadError {
  constructor(message: string) {
    super(message)
    this.name = 'MpvLoadCancelledError'
  }
}

/** The default `loadFile` timeout applied to URL opens (see playerBridge). */
export const URL_LOAD_TIMEOUT_MS = 60_000

/** Injected `setTimeout`/`clearTimeout` seam so load-timeout tests stay fast. */
export type SetTimeoutFn = (cb: () => void, ms: number) => unknown
export type ClearTimeoutFn = (handle: unknown) => void

export interface BuildMpvArgsOptions {
  /** Native window ID mpv should render into. */
  windowId: bigint | string
  /** Bare pipe name — the `\\.\pipe\` prefix is added here. */
  pipeName: string
  /**
   * Kizuna-owned mpv config dir (`<userData>/mpv`). When set, mpv reads
   * `mpv.conf`/`input.conf`/`scripts/`/`shaders/` from it
   * (`--config=yes --config-dir=<dir>`). When undefined (the default),
   * `--no-config` is emitted instead, which blocks mpv from reading the user's
   * *global* config — the accidental behavior this option makes explicit.
   */
  userConfigDir?: string
  /**
   * Advanced user escape-hatch args, inserted before the forced embedding args
   * (which always win, since for a repeated mpv option the later one wins).
   * Passed through `sanitizeExtraMpvArgs` so integration-breaking or
   * file-smuggling args can't slip in.
   */
  extraArgs?: string[]
  /**
   * Absolute path to the bundled `yt-dlp` binary. When set, the
   * forced block enables mpv's ytdl hook and points it at this binary so
   * pasted stream/YouTube URLs resolve. Left undefined in a dev checkout with
   * no bundled binary — mpv still plays direct-stream URLs without ytdl.
   */
  ytdlpPath?: string
}

/**
 * mpv options a user may set through `extraArgs`, by option name.
 *
 * This is an allowlist on purpose. A denylist cannot hold: mpv exposes several
 * unrelated-looking options that reach code execution or arbitrary file reads —
 * `--script`/`--scripts` (runs Lua), `--input-conf` (reads any file),
 * `--input-commands` (runs input.conf commands, and the `run` command spawns a
 * detached process), `--ytdl-raw-options` (documented as passing arbitrary
 * unchecked options to youtube-dl, whose own `--exec` runs a command) — and
 * every new mpv release can add more. Since `extraArgs` comes from
 * `settings.json` / `playerSettings:setSettings`, an unknown option must fail
 * closed, not open.
 *
 * Entries are playback-tuning options only: nothing that names a file, a
 * command, or a script, and nothing Kizuna owns (`--wid`,
 * `--input-ipc-server`, `--config`/`--config-dir`). Every name here was checked
 * against the mpv manual. Adding to this list is the intended way to support a
 * new power-user option.
 */
const ALLOWED_EXTRA_ARGS: ReadonlySet<string> = new Set([
  // Decoding and video output
  'hwdec',
  'hwdec-codecs',
  'vo',
  'gpu-api',
  'gpu-context',
  'profile',
  // Scaling and quality
  'scale',
  'cscale',
  'dscale',
  'tscale',
  'deband',
  'interpolation',
  'video-sync',
  'framedrop',
  'keepaspect',
  // Audio
  'volume',
  'audio-channels',
  'audio-device',
  'audio-delay',
  // Cache and demuxer
  'cache',
  'cache-secs',
  'demuxer-max-bytes',
  // On-screen display
  'osc',
  'osd-level',
  'sub-scale'
])

/**
 * Pure. Reduces one raw token to the mpv option name it sets, or `null` if it
 * is not an option at all. `--hwdec=auto`, `--hwdec`, and the boolean negation
 * `--no-osc` all name `hwdec`/`osc`; a bare token yields `null` so it can never
 * sneak in as a positional file mpv would try to play.
 */
function extraArgName(arg: string): string | null {
  if (!arg.startsWith('--')) return null
  const name = arg.slice(2).split('=', 1)[0]
  return name.startsWith('no-') ? name.slice(3) : name
}

/**
 * Pure. Filters user-supplied extra mpv args down to the allowlisted
 * playback-tuning options. Anything unrecognized — including options that only
 * exist in newer mpv builds — is dropped.
 */
export function sanitizeExtraMpvArgs(args: string[]): string[] {
  return args.filter((arg) => {
    const name = extraArgName(arg)
    return name !== null && ALLOWED_EXTRA_ARGS.has(name)
  })
}

/**
 * Pure. Builds the mpv.exe argv for embedded, DOM-subtitled playback. Argv
 * order is load-bearing: the config block comes first, the user's sanitized
 * `extraArgs` next, and the non-negotiable embedding args last so nothing a
 * user drops in can break the integration.
 */
export function buildMpvArgs({
  windowId,
  pipeName,
  userConfigDir,
  extraArgs = [],
  ytdlpPath
}: BuildMpvArgsOptions): string[] {
  const configArgs =
    userConfigDir === undefined
      ? ['--no-config'] // block mpv from reading the user's global config
      : ['--config=yes', `--config-dir=${userConfigDir}`]
  // ytdl hook: only when the binary is bundled. Points mpv's
  // ytdl_hook at our yt-dlp so pasted URLs resolve; part of the forced block so
  // user extraArgs can't accidentally disable streaming.
  const ytdlArgs =
    ytdlpPath === undefined
      ? []
      : [
          '--ytdl=yes',
          `--script-opts-append=ytdl_hook-ytdl_path=${ytdlpPath}`,
          '--script-opts-append=ytdl_hook-use_manifests=no'
        ]
  return [
    ...configArgs,
    ...sanitizeExtraMpvArgs(extraArgs),
    `--wid=${windowId}`,
    `--input-ipc-server=\\\\.\\pipe\\${pipeName}`,
    '--idle=yes', // start with no file; wait for loadfile commands
    '--force-window=yes', // paint into the wid even while idle
    '--keep-open=yes', // spike-proven: playback end must not kill the window
    '--no-osc', // spike-proven: our DOM draws all controls
    '--no-input-default-bindings', // spike-proven: keyboard is ours
    '--sid=no', // subtitles render in the DOM, never by mpv
    '--volume-max=200', // raise mpv's software-boost ceiling so setVolume can go past 100
    ...ytdlArgs
  ]
}

/** The slice of MpvIpcClient the controller needs (fakeable in tests). */
export interface MpvClientLike {
  connect(pipePath: string, opts?: ConnectOptions): Promise<void>
  sendCommand(command: unknown[]): Promise<unknown>
  observeProperty(name: string, cb: (value: unknown) => void): Promise<number>
  on(event: string, listener: (msg: MpvMessage) => void): void
  off(event: string, listener: (msg: MpvMessage) => void): void
  dispose(): void
}

/** The slice of ChildProcess the controller needs (fakeable in tests). */
export interface MpvProcessLike {
  kill(): boolean
  on(event: string, listener: (...args: unknown[]) => void): unknown
}

export type SpawnFn = (command: string, args: string[]) => MpvProcessLike

export interface MpvControllerDeps {
  spawnFn?: SpawnFn
  client?: MpvClientLike
  /** Fakeable timer for load timeouts; defaults to the global `setTimeout`. */
  setTimeoutFn?: SetTimeoutFn
  /** Fakeable timer clear; defaults to the global `clearTimeout`. */
  clearTimeoutFn?: ClearTimeoutFn
}

/** Options for a single `loadFile` call. */
export interface LoadFileOptions {
  /**
   * When set, the load rejects with `MpvLoadTimeoutError` if mpv emits neither
   * `file-loaded` nor `end-file` within this many milliseconds — the stalled-URL
   * case that would otherwise leave the promise pending forever.
   * Local opens omit it and keep the original no-timeout behavior.
   */
  timeoutMs?: number
}

export interface StartOptions {
  mpvPath: string
  windowId: bigint | string
  connect?: ConnectOptions
  /** Kizuna-owned mpv config dir; forwarded to `buildMpvArgs`. Undefined =
   * `--no-config` (mpv ignores every config source). */
  userConfigDir?: string
  /** User escape-hatch args; sanitized and forwarded to `buildMpvArgs`. */
  extraArgs?: string[]
  /** Bundled yt-dlp path; forwarded to `buildMpvArgs` to enable the ytdl hook. */
  ytdlpPath?: string
}

let pipeCounter = 0

/** One unique pipe name per mpv instance so parallel runs never collide. */
function uniquePipeName(): string {
  return `kizuna-mpv-${process.pid}-${Date.now()}-${pipeCounter++}`
}

export class MpvController {
  private readonly spawnFn: SpawnFn
  private readonly client: MpvClientLike
  private readonly setTimeoutFn: SetTimeoutFn
  private readonly clearTimeoutFn: ClearTimeoutFn
  private proc: MpvProcessLike | null = null
  /**
   * Abort hook for the currently in-flight `loadFile`, or null when none is
   * pending. `cancelLoad()` invokes it to settle the load early via the same
   * stop-and-reject path a timeout uses.
   */
  private pendingLoadAbort: ((error: Error) => void) | null = null

  constructor(deps: MpvControllerDeps = {}) {
    this.spawnFn = deps.spawnFn ?? ((cmd, args) => spawn(cmd, args, { stdio: 'ignore' }))
    this.client = deps.client ?? new MpvIpcClient()
    this.setTimeoutFn = deps.setTimeoutFn ?? ((cb, ms) => setTimeout(cb, ms))
    this.clearTimeoutFn =
      deps.clearTimeoutFn ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>))
  }

  /** Spawns mpv rendering into `windowId` and connects the IPC client to its pipe. */
  async start({
    mpvPath,
    windowId,
    connect,
    userConfigDir,
    extraArgs,
    ytdlpPath
  }: StartOptions): Promise<void> {
    if (this.proc) throw new Error('MpvController: already started')
    const pipeName = uniquePipeName()
    this.proc = this.spawnFn(
      mpvPath,
      buildMpvArgs({ windowId, pipeName, userConfigDir, extraArgs, ytdlpPath })
    )
    try {
      await this.client.connect(`\\\\.\\pipe\\${pipeName}`, connect)
    } catch (err) {
      // connect failed: don't leak the spawned mpv process or leave a
      // half-started controller stuck behind the "already started" guard.
      this.proc.kill()
      this.proc = null
      throw err
    }
  }

  /**
   * Resolves only after mpv has accepted the command and finished loading the
   * file, so callers can safely restore tracks or seek immediately afterward.
   * Rejects if mpv reports the file could not be opened: mpv acknowledges
   * `loadfile` immediately, then — when the file fails to demux/decode — emits
   * `end-file` (reason `error`) and never `file-loaded`. Without watching for
   * that, the promise would never settle and the caller's open lock would never
   * release, silently wedging every later open. Only reason `error` rejects:
   * replacing a playing file makes mpv emit `end-file` (reason `stop`) for the
   * outgoing file before `file-loaded` for the new one, and that must not be
   * mistaken for a failure.
   */
  loadFile(path: string, opts: LoadFileOptions = {}): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let commandResult: unknown
      let commandAcknowledged = false
      let fileLoaded = false
      let settled = false
      let timer: unknown = null

      const cleanup = (): void => {
        this.client.off('file-loaded', onFileLoaded)
        this.client.off('end-file', onEndFile)
        if (timer !== null) {
          this.clearTimeoutFn(timer)
          timer = null
        }
        // Only clear the shared abort hook if it still points at this load —
        // a later loadFile may already own it.
        if (this.pendingLoadAbort === abort) this.pendingLoadAbort = null
      }
      // Stop-and-reject path shared by the load timeout and `cancelLoad()`:
      // send `['stop']` to unstick a stalled mpv, drop listeners, and reject
      // with the given (timeout/cancel) error. Best-effort — a failed stop
      // still rejects the load and releases the caller's open-lock.
      const abort = (error: Error): void => {
        if (settled) return
        settled = true
        cleanup()
        void this.client.sendCommand(['stop']).catch(() => {})
        reject(error)
      }
      const onFileLoaded = (): void => {
        fileLoaded = true
        resolveWhenReady()
      }
      const onEndFile = (msg: MpvMessage): void => {
        // Only reason `error` before file-loaded means this load actually
        // failed (bad codec, truncated file, missing stream). Other endings —
        // `stop` for the outgoing file when a new load replaces it, `eof`/`quit`
        // for the previous file, or an ending after this file already loaded —
        // are not failures of this load and must be ignored.
        if (settled || fileLoaded || msg.reason !== 'error') return
        settled = true
        cleanup()
        reject(new MpvLoadError('MpvController: mpv could not load the file (error)'))
      }
      const resolveWhenReady = (): void => {
        if (settled || !commandAcknowledged || !fileLoaded) return
        settled = true
        cleanup()
        resolve(commandResult)
      }

      // Subscribe before issuing loadfile: a fast local file may emit
      // file-loaded before the command acknowledgement is delivered.
      this.client.on('file-loaded', onFileLoaded)
      this.client.on('end-file', onEndFile)
      // Expose the abort hook so cancelLoad() can settle this load, and arm the
      // timeout when one was requested (URL opens only).
      this.pendingLoadAbort = abort
      if (opts.timeoutMs !== undefined) {
        timer = this.setTimeoutFn(
          () => abort(new MpvLoadTimeoutError('MpvController: timed out loading the file')),
          opts.timeoutMs
        )
      }
      void this.client.sendCommand(['loadfile', path]).then(
        (result) => {
          commandResult = result
          commandAcknowledged = true
          resolveWhenReady()
        },
        (err: unknown) => {
          if (settled) return
          settled = true
          cleanup()
          reject(err)
        }
      )
    })
  }

  /**
   * Aborts the in-flight `loadFile` (if any) immediately, settling it through
   * the same stop-and-reject path a timeout uses so the renderer's open-lock is
   * released. No-op when no load is pending.
   */
  cancelLoad(): void {
    this.pendingLoadAbort?.(new MpvLoadCancelledError('MpvController: load cancelled'))
  }

  setPause(paused: boolean): Promise<unknown> {
    return this.client.sendCommand(['set_property', 'pause', paused])
  }

  seek(seconds: number, absolute = true): Promise<unknown> {
    return this.client.sendCommand(['seek', seconds, absolute ? 'absolute' : 'relative'])
  }

  /**
   * Volume is clamped to 0–200. mpv's default ceiling is 100, but `buildMpvArgs`
   * launches with `--volume-max=200`, so values above 100 apply software boost
   * (the BottomBar exposes the same range unconditionally).
   */
  setVolume(volume: number): Promise<unknown> {
    const v = Math.max(0, Math.min(200, volume))
    return this.client.sendCommand(['set_property', 'volume', v])
  }

  /** Playback speed is clamped to the shared UI/mpv bounds; malformed input resets to 1×. */
  setSpeed(speed: number): Promise<unknown> {
    const finiteSpeed = Number.isFinite(speed) ? speed : 1
    const clamped = Math.max(SPEED_MIN, Math.min(SPEED_MAX, finiteSpeed))
    return this.client.sendCommand(['set_property', 'speed', clamped])
  }

  setMuted(muted: boolean): Promise<unknown> {
    return this.client.sendCommand(['set_property', 'mute', muted])
  }

  /**
   * Audio/video sync delay. Everything above this controller speaks
   * milliseconds; mpv's `audio-delay` property is in seconds, so the ms→s
   * conversion happens only here. Non-finite input (NaN/Infinity) resets to 0.
   */
  setAudioDelay(delayMs: number): Promise<unknown> {
    const finiteMs = Number.isFinite(delayMs) ? delayMs : 0
    return this.client.sendCommand(['set_property', 'audio-delay', finiteMs / 1000])
  }

  /**
   * Insets the rendered picture by `top`/`bottom`/`right`/`left` ratios (0..1
   * of the window height, height, width, and width respectively) so it no
   * longer sits under the DOM's top/bottom chrome bars, the right-side
   * subtitle/mining sidebars, or the left-side playlist — mpv fills the freed
   * strip with its own background instead of video. `right` and `left` default
   * to 0 for callers that only manage the top/bottom bars.
   */
  setVideoMargins(top: number, bottom: number, right = 0, left = 0): Promise<unknown> {
    return Promise.all([
      this.client.sendCommand(['set_property', 'video-margin-ratio-top', top]),
      this.client.sendCommand(['set_property', 'video-margin-ratio-bottom', bottom]),
      this.client.sendCommand(['set_property', 'video-margin-ratio-right', right]),
      this.client.sendCommand(['set_property', 'video-margin-ratio-left', left])
    ])
  }

  setAudioTrack(aid: number): Promise<unknown> {
    return this.client.sendCommand(['set_property', 'aid', aid])
  }

  /**
   * Reads mpv's `track-list` (audio/subtitle/video streams of the current
   * file or URL). URL playback uses this, where ffprobe never runs, to
   * populate the audio-track menu. The reply is parsed defensively —
   * a non-array/garbage payload yields `[]` rather than throwing.
   */
  async getTrackList(): Promise<Track[]> {
    const raw = await this.client.sendCommand(['get_property', 'track-list'])
    return parseTrackList(raw)
  }

  /**
   * Reads the current file's displayed video resolution from mpv
   * (`video-params/dw` / `video-params/dh` — display dimensions, so anamorphic
   * content reports its corrected size). The URL path's counterpart to
   * ffprobe's `getVideoDimensions`; resolves undefined when no video is
   * playing or mpv reports a non-positive/absent value. Never throws — a
   * still-loading stream must not break the size-preset menu.
   */
  async getVideoDimensions(): Promise<VideoDimensions | undefined> {
    const positive = (v: unknown): v is number =>
      typeof v === 'number' && Number.isFinite(v) && v > 0
    try {
      const [dw, dh] = await Promise.all([
        this.client.sendCommand(['get_property', 'video-params/dw']),
        this.client.sendCommand(['get_property', 'video-params/dh'])
      ])
      if (!positive(dw) || !positive(dh)) return undefined
      return { width: dw, height: dh }
    } catch {
      return undefined
    }
  }

  /**
   * Reads mpv's `audio-device-list` (the output devices it can switch to, plus
   * the always-present `'auto'`). The reply is parsed defensively — a
   * non-array/garbage payload yields `[]` rather than throwing — so the caller
   * always gets a usable list for the device menu.
   */
  async getAudioDevices(): Promise<AudioDevice[]> {
    const raw = await this.client.sendCommand(['get_property', 'audio-device-list'])
    return parseAudioDeviceList(raw)
  }

  /** Switches the active output device live (`audio-device`); `'auto'` follows
   * the OS default. The name comes straight from `getAudioDevices`. mpv can be
   * left without an active audio output after a failed reinitialization, so the
   * internal `ao-reload` command follows the completed device write to recover it.
   * Older bundled mpv builds may not provide that internal command; reloading the
   * current playlist item is the documented compatibility fallback. */
  async setAudioDevice(name: string): Promise<unknown> {
    await this.client.sendCommand(['set_property', 'audio-device', name])
    try {
      return await this.client.sendCommand(['ao-reload'])
    } catch {
      return this.client.sendCommand(['playlist-play-index', 'current'])
    }
  }

  /**
   * Toggles loudness normalization via mpv's `af` (audio filter) command. The
   * `@kizuna-norm:` label makes `remove` idempotent and scoped to our filter,
   * so it never disturbs a user-script filter chain. `dynaudnorm=f=200` is
   * ffmpeg's dynamic normalizer with a 200 ms frame.
   */
  setLoudnessNormalization(on: boolean): Promise<unknown> {
    return this.client.sendCommand([
      'af',
      on ? 'add' : 'remove',
      '@kizuna-norm:lavfi=[dynaudnorm=f=200]'
    ])
  }

  /** Sets only mpv's ytdl-hook format policy for a later `loadfile`; it never reloads media. */
  setYtdlpQuality(quality: YtdlpQuality): Promise<unknown> {
    return this.client.sendCommand(['set_property', 'ytdl-format', ytdlpFormatForQuality(quality)])
  }

  /**
   * Sets mpv's native A–B loop endpoints (`ab-loop-a` / `ab-loop-b`, both in
   * seconds). `null` clears an endpoint (mpv's special `'no'` value); a numeric
   * endpoint is clamped to a non-negative time. Once both are set mpv loops the
   * range on its own — no renderer timer needed, unlike the per-cue loop. The
   * pair is passed through exactly as given: the renderer normalizes an inverted
   * range (B before A) before calling, so the stored state and mpv always agree.
   */
  setAbLoop(a: number | null, b: number | null): Promise<unknown> {
    const encode = (value: number | null): number | string =>
      value === null ? 'no' : Math.max(0, value)
    return Promise.all([
      this.client.sendCommand(['set_property', 'ab-loop-a', encode(a)]),
      this.client.sendCommand(['set_property', 'ab-loop-b', encode(b)])
    ])
  }

  /**
   * Writes the current frame to `path` as an image. The `video` flag captures
   * the pristine decoded frame with no OSD — explicit even though our OSD is
   * off, since subtitles live in the DOM and must never bleed into the file.
   */
  screenshotToFile(path: string): Promise<unknown> {
    return this.client.sendCommand(['screenshot-to-file', path, 'video'])
  }

  /**
   * Sets one mpv equalizer property (`brightness`/`contrast`/`saturation`/
   * `gamma`/`hue`). The value is rounded to an integer and clamped to mpv's
   * −100…100 range here, so a caller can never push the property out of bounds;
   * non-finite input (NaN/Infinity) resets it to the neutral 0.
   */
  setVideoAdjustment(name: VideoEqProperty, value: number): Promise<unknown> {
    const finite = Number.isFinite(value) ? Math.round(value) : 0
    const clamped = Math.max(VIDEO_EQ_MIN, Math.min(VIDEO_EQ_MAX, finite))
    return this.client.sendCommand(['set_property', name, clamped])
  }

  /**
   * Rotates the video (`video-rotate`, degrees clockwise). Only mpv's four
   * accepted values (0/90/180/270) are allowed; anything else falls back to 0.
   */
  setVideoRotate(deg: number): Promise<unknown> {
    const normalized = isVideoRotate(deg) ? deg : 0
    return this.client.sendCommand(['set_property', 'video-rotate', normalized])
  }

  /** Toggles mpv's `deinterlace` filter (a flag property, so a boolean is exact). */
  setDeinterlace(on: boolean): Promise<unknown> {
    return this.client.sendCommand(['set_property', 'deinterlace', on])
  }

  /** Advances exactly one frame, then pauses (mpv's `frame-step` behavior). */
  frameStep(): Promise<unknown> {
    return this.client.sendCommand(['frame-step'])
  }

  /** Steps back one frame (decoder-expensive but built into mpv), then pauses. */
  frameBackStep(): Promise<unknown> {
    return this.client.sendCommand(['frame-back-step'])
  }

  observeTimePos(cb: (value: unknown) => void): Promise<number> {
    return this.client.observeProperty('time-pos', cb)
  }

  /** Current media identity; used to attribute progress across load races. */
  observePath(cb: (value: unknown) => void): Promise<number> {
    return this.client.observeProperty('path', cb)
  }

  observeDuration(cb: (value: unknown) => void): Promise<number> {
    return this.client.observeProperty('duration', cb)
  }

  /** Source of truth for pause state, including mpv's own self-pause at EOF. */
  observePause(cb: (value: unknown) => void): Promise<number> {
    return this.client.observeProperty('pause', cb)
  }

  /** Source of truth for EOF, including user seeks to the end. */
  observeEofReached(cb: (value: unknown) => void): Promise<number> {
    return this.client.observeProperty('eof-reached', cb)
  }

  /** Passthrough for mpv events like 'file-loaded' / 'end-file'. */
  onEvent(event: string, listener: (msg: MpvMessage) => void): void {
    this.client.on(event, listener)
  }

  offEvent(event: string, listener: (msg: MpvMessage) => void): void {
    this.client.off(event, listener)
  }

  /** Asks mpv to quit politely, then tears everything down. */
  async quit(): Promise<void> {
    try {
      await this.client.sendCommand(['quit'])
    } catch {
      // not connected / already dead — dispose() below still cleans up
    }
    this.dispose()
  }

  /** Hard teardown: drops the IPC client and kills the mpv process. */
  dispose(): void {
    this.client.dispose()
    this.proc?.kill()
    this.proc = null
  }
}
