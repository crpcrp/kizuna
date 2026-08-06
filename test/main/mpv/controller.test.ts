import { describe, it, expect } from 'vitest'
import { EventEmitter } from 'node:events'
import { windowIdFromHandleBuffer } from '@src/main/mpv/nativeWindowHandle'
import {
  buildMpvArgs,
  sanitizeExtraMpvArgs,
  MpvController,
  MpvLoadError,
  MpvLoadTimeoutError,
  MpvLoadCancelledError,
  type MpvClientLike,
  type MpvProcessLike,
  type SetTimeoutFn,
  type SpawnFn
} from '@src/main/mpv/controller'
import type { ConnectOptions, MpvMessage } from '@src/main/mpv/ipcClient'
import type { YtdlpQuality } from '@src/shared/ytdlpQuality'

class FakeClient implements MpvClientLike {
  connectedTo: string | null = null
  sent: unknown[][] = []
  observed: { name: string; cb: (v: unknown) => void }[] = []
  disposed = false
  private readonly events = new EventEmitter()

  async connect(pipePath: string, _opts?: ConnectOptions): Promise<void> {
    this.connectedTo = pipePath
  }
  async sendCommand(command: unknown[]): Promise<unknown> {
    this.sent.push(command)
    return undefined
  }
  async observeProperty(name: string, cb: (v: unknown) => void): Promise<number> {
    this.observed.push({ name, cb })
    return this.observed.length
  }
  on(event: string, listener: (msg: MpvMessage) => void): void {
    this.events.on(event, listener)
  }
  off(event: string, listener: (msg: MpvMessage) => void): void {
    this.events.off(event, listener)
  }
  listenerCount(event: string): number {
    return this.events.listenerCount(event)
  }
  emit(event: string, msg: MpvMessage): void {
    this.events.emit(event, msg)
  }
  dispose(): void {
    this.disposed = true
  }
}

/** Fake spawn — records argv, returns a stub ChildProcess-like EventEmitter. */
class FakeProcess extends EventEmitter implements MpvProcessLike {
  killed = false
  kill(): boolean {
    this.killed = true
    return true
  }
}

function makeFixture(): {
  controller: MpvController
  client: FakeClient
  spawns: { command: string; args: string[]; proc: FakeProcess }[]
} {
  const client = new FakeClient()
  const spawns: { command: string; args: string[]; proc: FakeProcess }[] = []
  const spawnFn: SpawnFn = (command, args) => {
    const proc = new FakeProcess()
    spawns.push({ command, args, proc })
    return proc
  }
  return { controller: new MpvController({ spawnFn, client }), client, spawns }
}

describe('windowIdFromHandleBuffer', () => {
  it('reads the 8-byte LE pointer getNativeWindowHandle returns on Win64', () => {
    const buf = Buffer.alloc(8)
    buf.writeBigUInt64LE(0x00000000000a0b0cn, 0)
    expect(windowIdFromHandleBuffer(buf, 'win32')).toBe(658188n)
  })

  it('reads a Linux X11 window ID without truncating its 64-bit value', () => {
    const buf = Buffer.alloc(8)
    buf.writeBigUInt64LE(0x0000000100000001n, 0)
    expect(windowIdFromHandleBuffer(buf, 'linux')).toBe(0x0000000100000001n)
  })

  it('rejects a native handle buffer that is too small', () => {
    expect(() => windowIdFromHandleBuffer(Buffer.alloc(7), 'linux')).toThrow(
      'must contain at least 8 bytes'
    )
  })

  it('rejects unsupported platforms', () => {
    expect(() => windowIdFromHandleBuffer(Buffer.alloc(8), 'darwin')).toThrow(
      'Unsupported platform'
    )
  })
})

describe('buildMpvArgs', () => {
  it('passes a decoded Linux X11 window ID to mpv unchanged', () => {
    const handle = Buffer.alloc(8)
    handle.writeBigUInt64LE(0x0000000100000001n, 0)
    const windowId = windowIdFromHandleBuffer(handle, 'linux')

    expect(buildMpvArgs({ windowId, pipeName: 'p' })).toContain('--wid=4294967297')
  })

  it('produces the embedded-playback argv with subs disabled and config off by default', () => {
    const args = buildMpvArgs({ windowId: 658188n, pipeName: 'kizuna-mpv-1' })
    expect(args).toEqual([
      '--no-config',
      '--wid=658188',
      '--input-ipc-server=\\\\.\\pipe\\kizuna-mpv-1',
      '--idle=yes',
      '--force-window=yes',
      '--keep-open=yes',
      '--no-osc',
      '--no-input-default-bindings',
      '--sid=no',
      '--volume-max=200'
    ])
  })

  it('emits --config=yes/--config-dir when a user config dir is given', () => {
    const args = buildMpvArgs({
      windowId: 1n,
      pipeName: 'p',
      userConfigDir: 'C:\\Users\\a\\AppData\\Roaming\\Kizuna\\mpv'
    })
    // Config block leads the argv; --no-config is absent.
    expect(args.slice(0, 2)).toEqual([
      '--config=yes',
      '--config-dir=C:\\Users\\a\\AppData\\Roaming\\Kizuna\\mpv'
    ])
    expect(args).not.toContain('--no-config')
  })

  it('inserts sanitized user extraArgs after the config block and before the forced args', () => {
    const args = buildMpvArgs({
      windowId: 1n,
      pipeName: 'p',
      userConfigDir: '/cfg',
      extraArgs: ['--hwdec=auto', '--profile=gpu-hq']
    })
    expect(args).toEqual([
      '--config=yes',
      '--config-dir=/cfg',
      '--hwdec=auto',
      '--profile=gpu-hq',
      '--wid=1',
      '--input-ipc-server=\\\\.\\pipe\\p',
      '--idle=yes',
      '--force-window=yes',
      '--keep-open=yes',
      '--no-osc',
      '--no-input-default-bindings',
      '--sid=no',
      '--volume-max=200'
    ])
  })

  it('appends the ytdl hook args after the forced block when a yt-dlp path is given', () => {
    const args = buildMpvArgs({
      windowId: 1n,
      pipeName: 'p',
      ytdlpPath: 'C:\\app\\resources\\yt-dlp\\yt-dlp.exe'
    })
    expect(args).toEqual([
      '--no-config',
      '--wid=1',
      '--input-ipc-server=\\\\.\\pipe\\p',
      '--idle=yes',
      '--force-window=yes',
      '--keep-open=yes',
      '--no-osc',
      '--no-input-default-bindings',
      '--sid=no',
      '--volume-max=200',
      '--ytdl=yes',
      '--script-opts-append=ytdl_hook-ytdl_path=C:\\app\\resources\\yt-dlp\\yt-dlp.exe',
      '--script-opts-append=ytdl_hook-use_manifests=no'
    ])
  })

  it('omits the ytdl args entirely when no yt-dlp path is bundled', () => {
    const args = buildMpvArgs({ windowId: 1n, pipeName: 'p' })
    expect(args.some((arg) => arg.startsWith('--ytdl'))).toBe(false)
    expect(args.some((arg) => arg.includes('ytdl_hook'))).toBe(false)
    expect(args).not.toContain('--script-opts-append=ytdl_hook-use_manifests=no')
  })

  it('drops embedding/config-owning and non---prefixed args from extraArgs', () => {
    const args = buildMpvArgs({
      windowId: 1n,
      pipeName: 'p',
      extraArgs: [
        '--wid=999', // steals the window
        '--input-ipc-server=\\\\.\\pipe\\evil', // steals the IPC socket
        '--config-dir=/somewhere', // we own the config dir
        '--include=/etc/passwd', // footgun
        '--input-terminal=yes', // footgun
        'E:\\smuggled.mkv', // positional file smuggle
        '--hwdec=auto' // legitimate — kept
      ]
    })
    // Only the legitimate option survives, sitting between --no-config and --wid.
    expect(args).toEqual([
      '--no-config',
      '--hwdec=auto',
      '--wid=1',
      '--input-ipc-server=\\\\.\\pipe\\p',
      '--idle=yes',
      '--force-window=yes',
      '--keep-open=yes',
      '--no-osc',
      '--no-input-default-bindings',
      '--sid=no',
      '--volume-max=200'
    ])
  })
})

describe('sanitizeExtraMpvArgs', () => {
  it('keeps --prefixed args that do not touch the embedding/config options', () => {
    expect(sanitizeExtraMpvArgs(['--hwdec=auto', '--vo=gpu-next', '--profile=fast'])).toEqual([
      '--hwdec=auto',
      '--vo=gpu-next',
      '--profile=fast'
    ])
  })

  it('drops bare tokens and the embedding/config options Kizuna owns', () => {
    expect(
      sanitizeExtraMpvArgs([
        'not-an-option',
        '',
        '--wid=1',
        '--input-ipc-server=x',
        '--input-terminal=no',
        '--include=y',
        '--config-dir=z',
        '--config=yes',
        '--config',
        '--sub-scale=2' // allowlisted — --sid=no owns subs but this is harmless
      ])
    ).toEqual(['--sub-scale=2'])
  })

  it('drops options that execute code or read arbitrary files', () => {
    expect(
      sanitizeExtraMpvArgs([
        '--script=/x.lua', // runs Lua
        '--scripts=/a.lua:/b.lua',
        '--load-scripts=yes',
        '--script-opts=foo=1',
        '--input-conf=/x', // reads any file
        '--input-commands=run "calc.exe"', // `run` spawns a detached process
        '--ytdl-raw-options=exec=calc.exe', // unchecked pass-through to youtube-dl
        '--osc=no'
      ])
    ).toEqual(['--osc=no'])
  })

  it('fails closed on unknown options rather than passing them through', () => {
    // The allowlist's whole point: an option nobody has vetted — including one
    // a future mpv release adds — is dropped, not forwarded.
    expect(
      sanitizeExtraMpvArgs(['--some-future-mpv-option=1', '--widget-scale=1', '--hwdec=auto'])
    ).toEqual(['--hwdec=auto'])
  })

  it('accepts the value-less and negated spellings of an allowlisted option', () => {
    expect(sanitizeExtraMpvArgs(['--deband', '--no-osc', '--interpolation'])).toEqual([
      '--deband',
      '--no-osc',
      '--interpolation'
    ])
  })

  it('does not let a prefix collision smuggle in a forbidden option', () => {
    // "--script-opts" shares a prefix with nothing allowlisted, and "--cache-secs"
    // must not be admitted merely because "cache" is allowed as a separate name.
    expect(sanitizeExtraMpvArgs(['--cache-secs=30'])).toEqual(['--cache-secs=30'])
    expect(sanitizeExtraMpvArgs(['--cache-evil=1'])).toEqual([])
  })
})

describe('MpvController (fake spawn + fake client)', () => {
  it('sets each yt-dlp policy through ytdl-hook without loading media', async () => {
    const { controller, client } = makeFixture()
    const expected: Record<YtdlpQuality, string> = {
      best: 'bv*+ba/b',
      '2160': 'bv*[height<=2160]+ba/b[height<=2160]',
      '1440': 'bv*[height<=1440]+ba/b[height<=1440]',
      '1080': 'bv*[height<=1080]+ba/b[height<=1080]',
      '720': 'bv*[height<=720]+ba/b[height<=720]',
      '480': 'bv*[height<=480]+ba/b[height<=480]',
      '360': 'bv*[height<=360]+ba/b[height<=360]',
      worst: 'worstvideo+worstaudio/worst'
    }

    for (const quality of Object.keys(expected) as YtdlpQuality[])
      await controller.setYtdlpQuality(quality)

    expect(client.sent).toEqual(
      Object.entries(expected).map(([, format]) => ['set_property', 'ytdl-format', format])
    )
    expect(client.sent.flat()).not.toContain('loadfile')
  })

  it('start spawns mpvPath with built args and connects to the same pipe', async () => {
    const { controller, client, spawns } = makeFixture()
    await controller.start({ mpvPath: 'C:\\bin\\mpv.exe', windowId: 658188n })

    expect(spawns).toHaveLength(1)
    expect(spawns[0].command).toBe('C:\\bin\\mpv.exe')
    const ipcArg = spawns[0].args.find((a) => a.startsWith('--input-ipc-server='))
    const pipePath = ipcArg?.slice('--input-ipc-server='.length)
    expect(pipePath).toMatch(/^\\\\\.\\pipe\\kizuna-mpv-/)
    expect(client.connectedTo).toBe(pipePath) // client dials the pipe mpv serves
    expect(spawns[0].args).toEqual(
      buildMpvArgs({ windowId: 658188n, pipeName: pipePath!.replace('\\\\.\\pipe\\', '') })
    )
    await expect(controller.start({ mpvPath: 'x', windowId: 1n })).rejects.toThrow(
      'already started'
    )
  })

  it('start forwards userConfigDir and extraArgs into the spawned argv', async () => {
    const { controller, spawns } = makeFixture()
    await controller.start({
      mpvPath: 'mpv.exe',
      windowId: 658188n,
      userConfigDir: '/data/mpv',
      extraArgs: ['--hwdec=auto', '--wid=999'],
      ytdlpPath: '/data/yt-dlp/yt-dlp.exe'
    })
    const args = spawns[0].args
    expect(args[0]).toBe('--config=yes')
    expect(args[1]).toBe('--config-dir=/data/mpv')
    expect(args).toContain('--hwdec=auto')
    // The sanitizer strips the smuggled --wid; only the forced one remains.
    expect(args.filter((a) => a.startsWith('--wid='))).toEqual(['--wid=658188'])
    // ytdlpPath is forwarded into the ytdl hook args.
    expect(args).toContain('--script-opts-append=ytdl_hook-ytdl_path=/data/yt-dlp/yt-dlp.exe')
    expect(args).toContain('--script-opts-append=ytdl_hook-use_manifests=no')
  })

  it('maps each command method to the exact mpv IPC command array', async () => {
    const { controller, client } = makeFixture()
    const load = controller.loadFile('E:\\anime\\ep1.mkv')
    client.emit('file-loaded', { event: 'file-loaded' })
    await load
    await controller.setPause(true)
    await controller.seek(93.5, true)
    await controller.seek(-5, false)
    await controller.setVolume(80)
    await controller.setVolume(250) // clamped to the boosted 0-200 ceiling
    await controller.setVolume(-10) // clamped up to 0
    await controller.setAudioDevice('wasapi/{abc}')
    await controller.setLoudnessNormalization(true)
    await controller.setLoudnessNormalization(false)
    await controller.setSpeed(1.5)
    await controller.setSpeed(0)
    await controller.setSpeed(4)
    await controller.setSpeed(Number.NaN)
    await controller.setMuted(true)
    await controller.setAudioDelay(250) // ms → seconds at this boundary
    await controller.setAudioDelay(-500)
    await controller.setAudioDelay(Number.NaN) // non-finite resets to 0
    await controller.setAudioTrack(2)
    await controller.setAbLoop(12, 30) // both endpoints set → mpv loops the range
    await controller.setAbLoop(-3, null) // negative A clamps to 0; null B clears
    await controller.setAbLoop(null, null) // both cleared
    await controller.setVideoMargins(0.1, 0.05)
    await controller.setVideoMargins(0.1, 0.05, 0.2)
    await controller.setVideoMargins(0.1, 0.05, 0, 0.15)
    await controller.setVideoAdjustment('brightness', 40)
    await controller.setVideoAdjustment('contrast', 250) // clamped to 100
    await controller.setVideoAdjustment('gamma', -250) // clamped to -100
    await controller.setVideoAdjustment('saturation', 12.6) // rounded
    await controller.setVideoAdjustment('hue', Number.NaN) // non-finite resets to 0
    await controller.setVideoRotate(90)
    await controller.setVideoRotate(45) // not one of 0/90/180/270 → 0
    await controller.setDeinterlace(true)
    await controller.setDeinterlace(false)
    await controller.screenshotToFile('E:\\shots\\ep1-0-01-11.png')
    await controller.frameStep()
    await controller.frameBackStep()
    expect(client.sent).toEqual([
      ['loadfile', 'E:\\anime\\ep1.mkv'],
      ['set_property', 'pause', true],
      ['seek', 93.5, 'absolute'],
      ['seek', -5, 'relative'],
      ['set_property', 'volume', 80],
      ['set_property', 'volume', 200],
      ['set_property', 'volume', 0],
      ['set_property', 'audio-device', 'wasapi/{abc}'],
      ['ao-reload'],
      ['af', 'add', '@kizuna-norm:lavfi=[dynaudnorm=f=200]'],
      ['af', 'remove', '@kizuna-norm:lavfi=[dynaudnorm=f=200]'],
      ['set_property', 'speed', 1.5],
      ['set_property', 'speed', 0.25],
      ['set_property', 'speed', 3],
      ['set_property', 'speed', 1],
      ['set_property', 'mute', true],
      ['set_property', 'audio-delay', 0.25],
      ['set_property', 'audio-delay', -0.5],
      ['set_property', 'audio-delay', 0],
      ['set_property', 'aid', 2],
      ['set_property', 'ab-loop-a', 12],
      ['set_property', 'ab-loop-b', 30],
      ['set_property', 'ab-loop-a', 0],
      ['set_property', 'ab-loop-b', 'no'],
      ['set_property', 'ab-loop-a', 'no'],
      ['set_property', 'ab-loop-b', 'no'],
      ['set_property', 'video-margin-ratio-top', 0.1],
      ['set_property', 'video-margin-ratio-bottom', 0.05],
      ['set_property', 'video-margin-ratio-right', 0],
      ['set_property', 'video-margin-ratio-left', 0],
      ['set_property', 'video-margin-ratio-top', 0.1],
      ['set_property', 'video-margin-ratio-bottom', 0.05],
      ['set_property', 'video-margin-ratio-right', 0.2],
      ['set_property', 'video-margin-ratio-left', 0],
      ['set_property', 'video-margin-ratio-top', 0.1],
      ['set_property', 'video-margin-ratio-bottom', 0.05],
      ['set_property', 'video-margin-ratio-right', 0],
      ['set_property', 'video-margin-ratio-left', 0.15],
      ['set_property', 'brightness', 40],
      ['set_property', 'contrast', 100],
      ['set_property', 'gamma', -100],
      ['set_property', 'saturation', 13],
      ['set_property', 'hue', 0],
      ['set_property', 'video-rotate', 90],
      ['set_property', 'video-rotate', 0],
      ['set_property', 'deinterlace', true],
      ['set_property', 'deinterlace', false],
      ['screenshot-to-file', 'E:\\shots\\ep1-0-01-11.png', 'video'],
      ['frame-step'],
      ['frame-back-step']
    ])
  })

  it('reloads audio only after a device write completes, falls back when unavailable, and propagates device-write errors', async () => {
    const { controller, client } = makeFixture()
    let completeDeviceWrite: (() => void) | undefined
    client.sendCommand = (command: unknown[]) => {
      client.sent.push(command)
      if (command[0] === 'set_property') {
        return new Promise((resolve) => {
          completeDeviceWrite = () => resolve(undefined)
        })
      }
      return Promise.resolve('audio recovered')
    }

    const selection = controller.setAudioDevice('auto')
    expect(client.sent).toEqual([['set_property', 'audio-device', 'auto']])
    completeDeviceWrite?.()
    await expect(selection).resolves.toBe('audio recovered')
    expect(client.sent).toEqual([['set_property', 'audio-device', 'auto'], ['ao-reload']])

    client.sent = []
    client.sendCommand = async (command: unknown[]) => {
      client.sent.push(command)
      if (command[0] === 'ao-reload') {
        throw new Error('unknown command')
      }
      return 'playback reloaded'
    }
    await expect(controller.setAudioDevice('wasapi/{abc}')).resolves.toBe('playback reloaded')
    expect(client.sent).toEqual([
      ['set_property', 'audio-device', 'wasapi/{abc}'],
      ['ao-reload'],
      ['playlist-play-index', 'current']
    ])

    client.sent = []
    client.sendCommand = async (command: unknown[]) => {
      client.sent.push(command)
      throw new Error('device write failed')
    }
    await expect(controller.setAudioDevice('wasapi/{abc}')).rejects.toThrow('device write failed')
    expect(client.sent).toEqual([['set_property', 'audio-device', 'wasapi/{abc}']])
  })

  it('getAudioDevices sends the get_property command and parses the device list', async () => {
    const { controller, client } = makeFixture()
    client.sendCommand = async (command: unknown[]) => {
      client.sent.push(command)
      return [
        { name: 'auto', description: 'Autoselect device' },
        { name: 'wasapi/{abc}', description: 'Speakers' }
      ]
    }
    const devices = await controller.getAudioDevices()
    expect(client.sent).toEqual([['get_property', 'audio-device-list']])
    expect(devices).toEqual([
      { name: 'auto', description: 'Autoselect device' },
      { name: 'wasapi/{abc}', description: 'Speakers' }
    ])
  })

  it('getAudioDevices returns [] for a non-array / malformed device-list payload', async () => {
    const { controller, client } = makeFixture()
    client.sendCommand = async () => null // mpv could report null before any device is enumerated
    await expect(controller.getAudioDevices()).resolves.toEqual([])
    client.sendCommand = async () => [{ description: 'no name here' }, 'garbage', { name: '' }]
    await expect(controller.getAudioDevices()).resolves.toEqual([])
  })

  it('getTrackList sends the get_property command and parses the track list', async () => {
    const { controller, client } = makeFixture()
    client.sendCommand = async (command: unknown[]) => {
      client.sent.push(command)
      return [
        { id: 1, type: 'video', codec: 'h264' },
        { id: 1, type: 'audio', codec: 'aac', lang: 'jpn', title: 'JP' },
        { id: 2, type: 'sub', codec: 'ass' }
      ]
    }
    const tracks = await controller.getTrackList()
    expect(client.sent).toEqual([['get_property', 'track-list']])
    expect(tracks).toEqual([
      { id: 1, kind: 'audio', codec: 'aac', language: 'jpn', title: 'JP' },
      { id: 2, kind: 'subtitle', codec: 'ass' }
    ])
  })

  it('getTrackList returns [] for a non-array / malformed track-list payload', async () => {
    const { controller, client } = makeFixture()
    client.sendCommand = async () => null
    await expect(controller.getTrackList()).resolves.toEqual([])
  })

  it('getVideoDimensions reads mpv video-params/dw and dh', async () => {
    const { controller, client } = makeFixture()
    client.sendCommand = async (command: unknown[]) => {
      client.sent.push(command)
      const prop = command[1]
      if (prop === 'video-params/dw') return 1920
      if (prop === 'video-params/dh') return 1080
      return undefined
    }
    await expect(controller.getVideoDimensions()).resolves.toEqual({ width: 1920, height: 1080 })
    expect(client.sent).toEqual([
      ['get_property', 'video-params/dw'],
      ['get_property', 'video-params/dh']
    ])
  })

  it('getVideoDimensions returns undefined for absent/non-positive/non-number values', async () => {
    const { controller } = makeFixture()
    const cases: [unknown, unknown][] = [
      [undefined, 1080],
      [1920, undefined],
      [0, 1080],
      [1920, 0],
      [-1, 1080],
      [1920, -1],
      [null, 1080],
      [1920, null],
      ['1920', 1080],
      [1920, '1080'],
      [Number.NaN, 1080],
      [Number.POSITIVE_INFINITY, 1080]
    ]
    for (const [dw, dh] of cases) {
      const { controller: c, client } = makeFixture()
      client.sendCommand = async (command: unknown[]) =>
        command[1] === 'video-params/dw' ? dw : dh
      await expect(c.getVideoDimensions()).resolves.toBeUndefined()
    }
    // Baseline sanity: a fresh fixture with no override reports undefined too
    // (the default FakeClient resolves every property to undefined).
    await expect(controller.getVideoDimensions()).resolves.toBeUndefined()
  })

  it('getVideoDimensions returns undefined (does not reject) when the IPC call rejects', async () => {
    const { controller, client } = makeFixture()
    client.sendCommand = () => Promise.reject(new Error('mpv IPC: not connected'))
    await expect(controller.getVideoDimensions()).resolves.toBeUndefined()
  })

  it('waits for file-loaded before resolving loadFile and removes its listener', async () => {
    const { controller, client } = makeFixture()
    let resolved = false
    const load = controller.loadFile('E:\\anime\\ep1.mkv').then(() => {
      resolved = true
    })

    await Promise.resolve()
    expect(client.sent).toEqual([['loadfile', 'E:\\anime\\ep1.mkv']])
    expect(resolved).toBe(false)
    expect(client.listenerCount('file-loaded')).toBe(1)

    client.emit('file-loaded', { event: 'file-loaded' })
    await load
    expect(resolved).toBe(true)
    expect(client.listenerCount('file-loaded')).toBe(0)
  })

  it('rejects loadFile and removes its listener when the load command fails', async () => {
    const { controller, client } = makeFixture()
    client.sendCommand = () => Promise.reject(new Error('mpv IPC: load failed'))

    await expect(controller.loadFile('E:\\anime\\ep1.mkv')).rejects.toThrow('mpv IPC: load failed')
    expect(client.listenerCount('file-loaded')).toBe(0)
    expect(client.listenerCount('end-file')).toBe(0)
  })

  it('rejects loadFile and drops both listeners when mpv ends the file without loading it', async () => {
    const { controller, client } = makeFixture()
    const load = controller.loadFile('E:\\anime\\broken.mkv')

    // mpv acknowledges loadfile immediately, then aborts with end-file
    // (reason error) and never emits file-loaded for an unplayable file.
    await Promise.resolve()
    client.emit('end-file', { event: 'end-file', reason: 'error' })

    // An MpvLoadError (not a plain Error) signals mpv dropped to idle, which
    // the player bridge relies on to release the power-save blocker.
    await expect(load).rejects.toBeInstanceOf(MpvLoadError)
    await expect(load).rejects.toThrow('mpv could not load the file (error)')
    expect(client.listenerCount('file-loaded')).toBe(0)
    expect(client.listenerCount('end-file')).toBe(0)
  })

  it('ignores a pre-load end-file with a non-error reason (replacing the playing file)', async () => {
    const { controller, client } = makeFixture()
    const load = controller.loadFile('E:\\anime\\ep2.mkv')

    // Replacing a playing file: mpv stops the outgoing file (reason stop)
    // before it emits file-loaded for the new one. That must not reject.
    await Promise.resolve()
    client.emit('end-file', { event: 'end-file', reason: 'stop' })
    client.emit('file-loaded', { event: 'file-loaded' })

    await expect(load).resolves.toBeUndefined()
    expect(client.listenerCount('file-loaded')).toBe(0)
    expect(client.listenerCount('end-file')).toBe(0)
  })

  it('ignores end-file that arrives after file-loaded so a normal EOF never rejects the load', async () => {
    const { controller, client } = makeFixture()
    const load = controller.loadFile('E:\\anime\\ep1.mkv')

    client.emit('file-loaded', { event: 'file-loaded' })
    await expect(load).resolves.toBeUndefined()

    // A later end-file (playback reached EOF) must not throw or touch the
    // already-settled promise; its listener was removed on resolve.
    expect(client.listenerCount('end-file')).toBe(0)
    expect(() => client.emit('end-file', { event: 'end-file', reason: 'eof' })).not.toThrow()
  })

  it('times out a stalled loadFile: sends stop, cleans up listeners, and releases the lock', async () => {
    const client = new FakeClient()
    // Capture the injected timeout so the test fires it deterministically.
    let fireTimeout: (() => void) | undefined
    const setTimeoutFn: SetTimeoutFn = (cb) => {
      fireTimeout = cb
      return 1
    }
    const controller = new MpvController({ client, setTimeoutFn, clearTimeoutFn: () => {} })

    // mpv acknowledges loadfile (sendCommand resolves) but never emits
    // file-loaded/end-file — the stalled-URL case.
    const load = controller.loadFile('https://host/stream.m3u8', { timeoutMs: 60_000 })
    await Promise.resolve()
    expect(client.sent).toEqual([['loadfile', 'https://host/stream.m3u8']])
    expect(client.listenerCount('file-loaded')).toBe(1)
    expect(client.listenerCount('end-file')).toBe(1)

    fireTimeout!()
    await expect(load).rejects.toBeInstanceOf(MpvLoadTimeoutError)
    // Stop was issued to unstick mpv; both listeners were dropped.
    expect(client.sent).toContainEqual(['stop'])
    expect(client.listenerCount('file-loaded')).toBe(0)
    expect(client.listenerCount('end-file')).toBe(0)

    // The lock is released: a subsequent load settles normally.
    const next = controller.loadFile('E:\\anime\\ep1.mkv')
    client.emit('file-loaded', { event: 'file-loaded' })
    await expect(next).resolves.toBeUndefined()
  })

  it('cancelLoad aborts an in-flight load immediately via the stop-and-reject path', async () => {
    const { controller, client } = makeFixture()
    const load = controller.loadFile('https://host/stream.m3u8', { timeoutMs: 60_000 })
    await Promise.resolve()

    controller.cancelLoad()
    await expect(load).rejects.toBeInstanceOf(MpvLoadCancelledError)
    // A cancel is idle-dropping, so it must count as an MpvLoadError subclass.
    await expect(load).rejects.toBeInstanceOf(MpvLoadError)
    expect(client.sent).toContainEqual(['stop'])
    expect(client.listenerCount('file-loaded')).toBe(0)
    expect(client.listenerCount('end-file')).toBe(0)
  })

  it('cancelLoad is a no-op when no load is in flight', () => {
    const { controller, client } = makeFixture()
    expect(() => controller.cancelLoad()).not.toThrow()
    expect(client.sent).toEqual([])
  })

  it('a completed local load clears the abort hook so a later cancelLoad is a no-op', async () => {
    const { controller, client } = makeFixture()
    const load = controller.loadFile('E:\\anime\\ep1.mkv')
    client.emit('file-loaded', { event: 'file-loaded' })
    await load
    client.sent.length = 0

    controller.cancelLoad()
    // No stray stop for an already-settled load.
    expect(client.sent).toEqual([])
  })

  it('observeTimePos / observePath / observeDuration / observePause observe the right properties', async () => {
    const { controller, client } = makeFixture()
    const times: unknown[] = []
    const paths: unknown[] = []
    const durations: unknown[] = []
    const pauses: unknown[] = []
    await controller.observeTimePos((v) => times.push(v))
    await controller.observePath((v) => paths.push(v))
    await controller.observeDuration((v) => durations.push(v))
    await controller.observePause((v) => pauses.push(v))
    expect(client.observed.map((o) => o.name)).toEqual(['time-pos', 'path', 'duration', 'pause'])
    client.observed[0].cb(12.3)
    client.observed[1].cb('/media/video.mkv')
    client.observed[2].cb(1440)
    client.observed[3].cb(false)
    expect(times).toEqual([12.3])
    expect(paths).toEqual(['/media/video.mkv'])
    expect(durations).toEqual([1440])
    expect(pauses).toEqual([false])
  })

  it('observePause observes the pause property', async () => {
    const { controller, client } = makeFixture()
    const values: unknown[] = []
    await controller.observePause((v) => values.push(v))
    expect(client.observed.map((o) => o.name)).toEqual(['pause'])
    client.observed[0].cb(true)
    expect(values).toEqual([true])
  })

  it('onEvent/offEvent pass through to the client event surface', () => {
    const { controller, client } = makeFixture()
    const seen: MpvMessage[] = []
    const listener = (msg: MpvMessage): void => {
      seen.push(msg)
    }
    controller.onEvent('end-file', listener)
    client.emit('end-file', { event: 'end-file', reason: 'eof' })
    controller.offEvent('end-file', listener)
    client.emit('end-file', { event: 'end-file', reason: 'quit' })
    expect(seen).toEqual([{ event: 'end-file', reason: 'eof' }])
  })

  it('quit sends the quit command, disposes the client and kills mpv', async () => {
    const { controller, client, spawns } = makeFixture()
    await controller.start({ mpvPath: 'mpv.exe', windowId: 1n })
    await controller.quit()
    expect(client.sent).toContainEqual(['quit'])
    expect(client.disposed).toBe(true)
    expect(spawns[0].proc.killed).toBe(true)
  })

  it('quit still tears down when the quit command rejects', async () => {
    const { controller, client, spawns } = makeFixture()
    client.sendCommand = () => Promise.reject(new Error('mpv IPC: not connected'))
    await controller.start({ mpvPath: 'mpv.exe', windowId: 1n })
    await controller.quit()
    expect(client.disposed).toBe(true)
    expect(spawns[0].proc.killed).toBe(true)
  })

  it('dispose hard-tears down the client and mpv process', async () => {
    const { controller, client, spawns } = makeFixture()
    await controller.start({ mpvPath: 'mpv.exe', windowId: 1n })

    controller.dispose()

    expect(client.disposed).toBe(true)
    expect(spawns[0].proc.killed).toBe(true)
  })

  it('start kills the spawned proc and resets state when connect rejects', async () => {
    const { controller, client, spawns } = makeFixture()
    const connectErr = new Error('mpv IPC: connect failed')
    client.connect = () => Promise.reject(connectErr)

    await expect(controller.start({ mpvPath: 'mpv.exe', windowId: 1n })).rejects.toThrow(
      'mpv IPC: connect failed'
    )
    expect(spawns).toHaveLength(1)
    expect(spawns[0].proc.killed).toBe(true)

    // controller is left in a clean state — a retry is allowed, not stuck
    // behind the "already started" guard.
    client.connect = async (pipePath: string) => {
      client.connectedTo = pipePath
    }
    await expect(controller.start({ mpvPath: 'mpv.exe', windowId: 1n })).resolves.toBeUndefined()
    expect(spawns).toHaveLength(2)
    expect(spawns[1].proc.killed).toBe(false)
  })
})
