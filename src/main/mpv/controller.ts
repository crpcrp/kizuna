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

// A failed demux/decode leaves mpv idle; a rejected command may leave the old file playing.
export class MpvLoadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MpvLoadError'
  }
}

export interface BuildMpvArgsOptions {
  platform: NodeJS.Platform
  windowId: bigint | string
  ipcEndpoint: string
  // Only this app-owned directory may supply config; otherwise global mpv config is disabled.
  userConfigDir?: string
  // Forced embedding args follow user args because the last repeated mpv option wins.
  extraArgs?: string[]
}

// These options precede user args, so they must not be overridable.
const RESERVED_EXTRA_ARGS: ReadonlySet<string> = new Set(['config', 'config-dir'])

function extraArgName(arg: string): string | null {
  if (!arg.startsWith('--')) return null
  const name = arg.slice(2).split('=', 1)[0]
  return name.startsWith('no-') ? name.slice(3) : name
}

// Reject bare tokens so mpv cannot treat them as files to play.
export function sanitizeExtraMpvArgs(args: string[]): string[] {
  return args.filter((arg) => {
    const name = extraArgName(arg)
    return name !== null && !RESERVED_EXTRA_ARGS.has(name)
  })
}

// Embedding args must come last so user options cannot override them.
export function buildMpvArgs({
  platform,
  windowId,
  ipcEndpoint,
  userConfigDir,
  extraArgs = []
}: BuildMpvArgsOptions): string[] {
  // Keep hwdec off the command line when using mpv.conf so the user config can override it.
  const configArgs =
    userConfigDir === undefined
      ? ['--no-config', '--hwdec=auto-safe'] // block mpv from reading the user's global config
      : ['--config=yes', `--config-dir=${userConfigDir}`]
  // X11 output works in software/Xvfb sessions where x11egl can initialize but display black frames.
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

export interface MpvClientLike {
  connect(endpoint: string, opts?: ConnectOptions): Promise<void>
  sendCommand(command: unknown[]): Promise<unknown>
  observeProperty(name: string, cb: (value: unknown) => void): Promise<number>
  on(event: string, listener: (msg: MpvMessage) => void): void
  off(event: string, listener: (msg: MpvMessage) => void): void
  dispose(): void
}

export interface MpvProcessLike {
  kill(): boolean
  on(event: string, listener: (...args: unknown[]) => void): unknown
}

export type SpawnFn = (command: string, args: string[]) => MpvProcessLike

export interface MpvControllerDeps {
  spawnFn?: SpawnFn
  client?: MpvClientLike
  platform?: NodeJS.Platform
  tempDir?: string
  unlinkFn?: UnlinkFn
}

export interface StartOptions {
  mpvPath: string
  windowId: bigint | string
  connect?: ConnectOptions
  userConfigDir?: string
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
  private readonly pendingLoads = new Set<(error: Error) => void>()
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

  private cleanupIpcEndpoint(): void {
    const endpoint = this.ipcEndpoint
    if (endpoint === null) return
    try {
      removeMpvIpcEndpoint(endpoint, this.platform, this.unlinkFn)
    } finally {
      this.ipcEndpoint = null
    }
  }

  private abortPendingLoads(): void {
    const error = new MpvLoadError('MpvController: mpv exited while loading the file')
    for (const abort of [...this.pendingLoads]) abort(error)
    this.pendingLoads.clear()
  }

  // A native exit must also release the Linux socket and stop commands to the dead client.
  private handleProcessExit(proc: MpvProcessLike): void {
    // Ignore a late exit from an old process after a new start.
    if (this.proc !== proc) return
    this.abortPendingLoads()
    this.proc = null
    try {
      this.client.dispose()
    } finally {
      this.cleanupIpcEndpoint()
    }
  }

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
      // Remove a leftover Linux socket so a previous crash cannot block startup.
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
      // Failed connection must release the process and the already-started guard.
      try {
        this.proc?.kill()
      } finally {
        this.proc = null
        this.cleanupIpcEndpoint()
      }
      throw err
    }
  }

  // mpv acknowledges loadfile before decoding; wait for file-loaded before restoring tracks or seeking.
  // Reject end-file/error; end-file/stop belongs to the outgoing file during replacement.
  loadFile(path: string): Promise<unknown> {
    return new Promise((resolve, reject) => {
      let commandResult: unknown
      let commandAcknowledged = false
      let fileLoaded = false
      let settled = false
      const cleanup = (): void => {
        this.client.off('file-loaded', onFileLoaded)
        this.client.off('end-file', onEndFile)
        this.pendingLoads.delete(abort)
      }
      // Process exit can drop both event listeners without firing either; abort the pending load explicitly.
      const abort = (error: Error): void => {
        if (settled) return
        settled = true
        cleanup()
        reject(error)
      }
      this.pendingLoads.add(abort)
      const onFileLoaded = (): void => {
        fileLoaded = true
        resolveWhenReady()
      }
      const onEndFile = (msg: MpvMessage): void => {
        // Only error before file-loaded fails this load; stop/eof/quit may belong to the outgoing file.
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

      // Subscribe before loadfile: file-loaded may arrive before the command acknowledgement.
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

  stopPlayback(): Promise<unknown> {
    return this.client.sendCommand(['stop'])
  }

  seek(seconds: number, absolute = true): Promise<unknown> {
    return this.client.sendCommand(['seek', seconds, absolute ? 'absolute' : 'relative'])
  }

  // Values above 100 use software boost, enabled by --volume-max=200.
  setVolume(volume: number): Promise<unknown> {
    const v = Math.max(0, Math.min(200, volume))
    return this.client.sendCommand(['set_property', 'volume', v])
  }

  setSpeed(speed: number): Promise<unknown> {
    const finiteSpeed = Number.isFinite(speed) ? speed : 1
    const clamped = Math.max(SPEED_MIN, Math.min(SPEED_MAX, finiteSpeed))
    return this.client.sendCommand(['set_property', 'speed', clamped])
  }

  setMuted(muted: boolean): Promise<unknown> {
    return this.client.sendCommand(['set_property', 'mute', muted])
  }

  // The application uses milliseconds; mpv audio-delay uses seconds.
  setAudioDelay(delayMs: number): Promise<unknown> {
    const finiteMs = Number.isFinite(delayMs) ? delayMs : 0
    return this.client.sendCommand(['set_property', 'audio-delay', finiteMs / 1000])
  }

  // Margins are fractions of window height (top/bottom) or width (left/right), reserving space for DOM chrome.
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

  async getAudioDevices(): Promise<AudioDevice[]> {
    const raw = await this.client.sendCommand(['get_property', 'audio-device-list'])
    return parseAudioDeviceList(raw)
  }

  // Failed device reinitialization can leave mpv silent; ao-reload recovers output.
  // Older mpv builds require reloading the current playlist item instead.
  async setAudioDevice(name: string): Promise<unknown> {
    await this.client.sendCommand(['set_property', 'audio-device', name])
    try {
      return await this.client.sendCommand(['ao-reload'])
    } catch {
      return this.client.sendCommand(['playlist-play-index', 'current'])
    }
  }

  // The label scopes removal to our filter, preserving user filters; f=200 selects a 200 ms frame.
  setLoudnessNormalization(on: boolean): Promise<unknown> {
    return this.client.sendCommand([
      'af',
      on ? 'add' : 'remove',
      '@kizuna-norm:lavfi=[dynaudnorm=f=200]'
    ])
  }

  // mpv uses "no" to clear a loop endpoint; the renderer normalizes inverted ranges.
  setAbLoop(a: number | null, b: number | null): Promise<unknown> {
    const encode = (value: number | null): number | string =>
      value === null ? 'no' : Math.max(0, value)
    return Promise.all([
      this.client.sendCommand(['set_property', 'ab-loop-a', encode(a)]),
      this.client.sendCommand(['set_property', 'ab-loop-b', encode(b)])
    ])
  }

  // The video flag excludes OSD and subtitles from the captured frame.
  screenshotToFile(path: string): Promise<unknown> {
    return this.client.sendCommand(['screenshot-to-file', path, 'video'])
  }

  setVideoAdjustment(name: VideoEqProperty, value: number): Promise<unknown> {
    const finite = Number.isFinite(value) ? Math.round(value) : 0
    const clamped = Math.max(VIDEO_EQ_MIN, Math.min(VIDEO_EQ_MAX, finite))
    return this.client.sendCommand(['set_property', name, clamped])
  }

  setVideoRotate(deg: number): Promise<unknown> {
    const normalized = isVideoRotate(deg) ? deg : 0
    return this.client.sendCommand(['set_property', 'video-rotate', normalized])
  }

  setDeinterlace(on: boolean): Promise<unknown> {
    return this.client.sendCommand(['set_property', 'deinterlace', on])
  }

  frameStep(): Promise<unknown> {
    return this.client.sendCommand(['frame-step'])
  }

  frameBackStep(): Promise<unknown> {
    return this.client.sendCommand(['frame-back-step'])
  }

  observeTimePos(cb: (value: unknown) => void): Promise<number> {
    return this.client.observeProperty('time-pos', cb)
  }

  observePath(cb: (value: unknown) => void): Promise<number> {
    return this.client.observeProperty('path', cb)
  }

  observeDuration(cb: (value: unknown) => void): Promise<number> {
    return this.client.observeProperty('duration', cb)
  }

  // mpv can pause itself at EOF.
  observePause(cb: (value: unknown) => void): Promise<number> {
    return this.client.observeProperty('pause', cb)
  }

  // Seeking to the end can also reach EOF.
  observeEofReached(cb: (value: unknown) => void): Promise<number> {
    return this.client.observeProperty('eof-reached', cb)
  }

  onEvent(event: string, listener: (msg: MpvMessage) => void): void {
    this.client.on(event, listener)
  }

  offEvent(event: string, listener: (msg: MpvMessage) => void): void {
    this.client.off(event, listener)
  }

  async quit(): Promise<void> {
    try {
      await this.client.sendCommand(['quit'])
    } catch {
      // dispose() must still clean up when mpv is disconnected or dead.
    }
    this.dispose()
  }

  dispose(): void {
    this.abortPendingLoads()
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
