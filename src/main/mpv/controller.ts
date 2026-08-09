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
import { spawn } from 'node:child_process'
import { unlinkSync } from 'node:fs'
import { MpvIpcClient, type ConnectOptions, type MpvMessage } from './ipcClient'
import { createMpvIpcEndpoint, removeMpvIpcEndpoint, type UnlinkFn } from './ipcEndpoint'

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

export interface BuildMpvArgsOptions {
  /** Host windowing/video-output platform. */
  platform: NodeJS.Platform
  /** Native window ID mpv should render into. */
  windowId: bigint | string
  /** Complete named-pipe or Unix-domain-socket endpoint for mpv IPC. */
  ipcEndpoint: string
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
}

/**
 * mpv options a user may set through `extraArgs`, by option name.
 *
 * This is an allowlist on purpose. A denylist cannot hold: mpv exposes several
 * unrelated-looking options that reach code execution or arbitrary file reads —
 * `--script`/`--scripts` (runs Lua), `--input-conf` (reads any file),
 * `--input-commands` (runs input.conf commands, and the `run` command spawns a
 * detached process) — and every new mpv release can add more. Since `extraArgs` comes from
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
  platform,
  windowId,
  ipcEndpoint,
  userConfigDir,
  extraArgs = []
}: BuildMpvArgsOptions): string[] {
  const configArgs =
    userConfigDir === undefined
      ? ['--no-config'] // block mpv from reading the user's global config
      : ['--config=yes', `--config-dir=${userConfigDir}`]
  // Linux embedding runs through Electron's X11 path under X11/XWayland.
  // The legacy X11 output is intentionally the correctness baseline: unlike
  // x11egl it renders in software-only/Xvfb sessions and on machines whose EGL
  // context initializes but presents only black frames. A future accelerated
  // path must pass the real-pixel visibility test before replacing it.
  const linuxEmbeddingArgs = platform === 'linux' ? ['--vo=x11'] : []
  return [
    ...configArgs,
    ...sanitizeExtraMpvArgs(extraArgs),
    ...linuxEmbeddingArgs,
    `--wid=${windowId}`,
    `--input-ipc-server=${ipcEndpoint}`,
    '--idle=yes', // start with no file; wait for loadfile commands
    '--force-window=yes', // paint into the wid even while idle
    '--keep-open=yes', // playback end must not kill the embedded window
    '--terminal=no', // embedded IPC owns control; never write status/log lines to the parent terminal
    '--no-osc', // Kizuna's DOM draws all controls
    '--no-input-default-bindings', // Kizuna owns keyboard input
    '--sid=no', // subtitles render in the DOM, never by mpv
    '--volume-max=200' // raise mpv's software-boost ceiling so setVolume can go past 100
  ]
}

/** The slice of MpvIpcClient the controller needs (fakeable in tests). */
export interface MpvClientLike {
  connect(endpoint: string, opts?: ConnectOptions): Promise<void>
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
  /** Platform seam for endpoint and cleanup tests; defaults to the host platform. */
  platform?: NodeJS.Platform
  /** Temp directory seam for deterministic Linux endpoint tests. */
  tempDir?: string
  /** Filesystem seam for deterministic Linux endpoint cleanup tests. */
  unlinkFn?: UnlinkFn
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
}

export class MpvController {
  private readonly spawnFn: SpawnFn
  private readonly client: MpvClientLike
  private readonly platform: NodeJS.Platform
  private readonly tempDir: string | undefined
  private readonly unlinkFn: UnlinkFn
  private proc: MpvProcessLike | null = null
  private ipcEndpoint: string | null = null
  constructor(deps: MpvControllerDeps = {}) {
    this.spawnFn =
      deps.spawnFn ??
      ((cmd, args) => {
        return spawn(cmd, args, { stdio: 'ignore' })
      })
    this.client = deps.client ?? new MpvIpcClient()
    this.platform = deps.platform ?? process.platform
    this.tempDir = deps.tempDir
    this.unlinkFn = deps.unlinkFn ?? unlinkSync
  }

  /** Removes the owned Linux endpoint and releases its ownership. */
  private cleanupIpcEndpoint(): void {
    const endpoint = this.ipcEndpoint
    if (endpoint === null) return
    try {
      removeMpvIpcEndpoint(endpoint, this.platform, this.unlinkFn)
    } finally {
      this.ipcEndpoint = null
    }
  }

  /**
   * A native mpv exit is a complete controller teardown too. Without this
   * path, a crash after startup leaves the Linux socket owned by Kizuna and
   * the controller keeps sending commands to a dead IPC client until app quit.
   */
  private handleProcessExit(proc: MpvProcessLike): void {
    // A killed process may emit its exit event after a new start has already
    // installed the next process. Never let a late event tear down that new
    // controller instance.
    if (this.proc !== proc) return
    this.proc = null
    try {
      this.client.dispose()
    } finally {
      this.cleanupIpcEndpoint()
    }
  }

  /** Spawns mpv rendering into `windowId` and connects the IPC client to its endpoint. */
  async start({
    mpvPath,
    windowId,
    connect,
    userConfigDir,
    extraArgs
  }: StartOptions): Promise<void> {
    if (this.proc) throw new Error('MpvController: already started')
    const ipcEndpoint = createMpvIpcEndpoint(this.platform, this.tempDir)
    this.ipcEndpoint = ipcEndpoint

    try {
      // mpv normally creates the endpoint itself. Remove a leftover Linux
      // socket before spawning so a previous crash cannot block startup.
      removeMpvIpcEndpoint(ipcEndpoint, this.platform, this.unlinkFn)
    } catch (err) {
      this.ipcEndpoint = null
      throw err
    }

    try {
      this.proc = this.spawnFn(
        mpvPath,
        buildMpvArgs({
          platform: this.platform,
          windowId,
          ipcEndpoint,
          userConfigDir,
          extraArgs
        })
      )
      const proc = this.proc
      proc.on('exit', (...args) => {
        const [code, signal] = args
        if (code !== 0 && code !== null && code !== undefined)
          console.warn(
            `[kizuna] mpv exited with code ${String(code)}${signal ? ` (${String(signal)})` : ''}`
          )
        this.handleProcessExit(proc)
      })
      proc.on('error', (err) => {
        console.warn('[kizuna] mpv process error:', err)
        this.handleProcessExit(proc)
      })
      await this.client.connect(ipcEndpoint, connect)
    } catch (err) {
      // connect failed: don't leak the spawned mpv process or leave a
      // half-started controller stuck behind the "already started" guard.
      try {
        this.proc?.kill()
      } finally {
        this.proc = null
        this.cleanupIpcEndpoint()
      }
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
  loadFile(path: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let commandResult: unknown
      let commandAcknowledged = false
      let fileLoaded = false
      let settled = false
      const cleanup = (): void => {
        this.client.off('file-loaded', onFileLoaded)
        this.client.off('end-file', onEndFile)
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
    const proc = this.proc
    this.proc = null
    try {
      this.client.dispose()
    } finally {
      try {
        proc?.kill()
      } finally {
        this.cleanupIpcEndpoint()
      }
    }
  }
}
