import { describe, it, expect, vi } from 'vitest'
import {
  registerPlayerBridge,
  type PlayerControllerLike,
  type PlayerHistoryObserver
} from '@src/main/playerBridge'
import { MpvLoadError } from '@src/main/mpv/controller'
import { ScreenshotFolderError } from '@src/main/services/screenshots'
import { PLAYER_CHANNELS } from '@src/shared/ipcChannels'
import { fakeIpc, type FakeEvent } from '@test/harness/fakeIpcMain'

/** Fake mpv controller: records calls and captures observe callbacks. */
function fakeController() {
  const calls: Record<string, unknown[]> = {}
  let timePosCb: ((v: unknown) => void) | undefined
  let pathCb: ((v: unknown) => void) | undefined
  let durationCb: ((v: unknown) => void) | undefined
  let pauseCb: ((v: unknown) => void) | undefined
  let eofCb: ((v: unknown) => void) | undefined
  const controller: PlayerControllerLike = {
    loadFile: vi.fn(async (path: string) => {
      calls.loadFile = [path]
      return undefined
    }),
    setPause: vi.fn(async (paused: boolean) => {
      calls.setPause = [paused]
      return undefined
    }),
    seek: vi.fn(async (seconds: number, absolute?: boolean) => {
      calls.seek = [seconds, absolute]
      return undefined
    }),
    setVolume: vi.fn(async (volume: number) => {
      calls.setVolume = [volume]
      return undefined
    }),
    setSpeed: vi.fn(async (speed: number) => {
      calls.setSpeed = [speed]
      return undefined
    }),
    setMuted: vi.fn(async (muted: boolean) => {
      calls.setMuted = [muted]
      return undefined
    }),
    setAudioDelay: vi.fn(async (delayMs: number) => {
      calls.setAudioDelay = [delayMs]
      return undefined
    }),
    setAudioTrack: vi.fn(async (aid: number) => {
      calls.setAudioTrack = [aid]
      return undefined
    }),
    getAudioDevices: vi.fn(async () => {
      calls.getAudioDevices = []
      return [{ name: 'auto', description: 'Autoselect device' }]
    }),
    setAudioDevice: vi.fn(async (name: string) => {
      calls.setAudioDevice = [name]
      return undefined
    }),
    setLoudnessNormalization: vi.fn(async (on: boolean) => {
      calls.setLoudnessNormalization = [on]
      return undefined
    }),
    setAbLoop: vi.fn(async (a: number | null, b: number | null) => {
      calls.setAbLoop = [a, b]
      return undefined
    }),
    setVideoMargins: vi.fn(async (top: number, bottom: number, right?: number, left?: number) => {
      calls.setVideoMargins = [top, bottom, right, left]
      return undefined
    }),
    setVideoAdjustment: vi.fn(async (name: string, value: number) => {
      calls[`setVideoAdjustment:${name}`] = [value]
      return undefined
    }),
    setVideoRotate: vi.fn(async (deg: number) => {
      calls.setVideoRotate = [deg]
      return undefined
    }),
    setDeinterlace: vi.fn(async (on: boolean) => {
      calls.setDeinterlace = [on]
      return undefined
    }),
    frameStep: vi.fn(async () => {
      calls.frameStep = []
      return undefined
    }),
    frameBackStep: vi.fn(async () => {
      calls.frameBackStep = []
      return undefined
    }),
    observeTimePos: vi.fn(async (cb) => {
      timePosCb = cb
      return 1
    }),
    observePath: vi.fn(async (cb) => {
      pathCb = cb
      return 5
    }),
    observeDuration: vi.fn(async (cb) => {
      durationCb = cb
      return 2
    }),
    observePause: vi.fn(async (cb) => {
      pauseCb = cb
      return 3
    }),
    observeEofReached: vi.fn(async (cb) => {
      eofCb = cb
      return 4
    })
  }
  return {
    controller,
    calls,
    fireTimePos: (v: unknown) => timePosCb?.(v),
    firePath: (v: unknown) => pathCb?.(v),
    fireDuration: (v: unknown) => durationCb?.(v),
    firePause: (v: unknown) => pauseCb?.(v),
    fireEof: (v: unknown) => eofCb?.(v)
  }
}

function fakeHistory(): PlayerHistoryObserver {
  return {
    recordOpened: vi.fn(),
    beginLoad: vi.fn(),
    abortLoad: vi.fn(),
    observePath: vi.fn(),
    observePosition: vi.fn(),
    observeDuration: vi.fn()
  }
}

describe('registerPlayerBridge', () => {
  const event: FakeEvent = { senderId: 7 }

  it('registers every command channel', () => {
    const { ipc, handlers } = fakeIpc()
    const { controller } = fakeController()
    registerPlayerBridge(ipc, controller, vi.fn())

    expect([...handlers.keys()].sort()).toEqual(
      [
        PLAYER_CHANNELS.load,
        PLAYER_CHANNELS.setPause,
        PLAYER_CHANNELS.seek,
        PLAYER_CHANNELS.setVolume,
        PLAYER_CHANNELS.setSpeed,
        PLAYER_CHANNELS.setMuted,
        PLAYER_CHANNELS.setAudioDelay,
        PLAYER_CHANNELS.setAudioTrack,
        PLAYER_CHANNELS.getAudioDevices,
        PLAYER_CHANNELS.setAudioDevice,
        PLAYER_CHANNELS.setLoudnessNorm,
        PLAYER_CHANNELS.setAbLoop,
        PLAYER_CHANNELS.setVideoMargins,
        PLAYER_CHANNELS.setVideoAdjustments,
        PLAYER_CHANNELS.frameStep,
        PLAYER_CHANNELS.frameBackStep
      ].sort()
    )
  })

  it('records a recent only after a successful load', async () => {
    const { ipc, handlers } = fakeIpc()
    const { controller, calls } = fakeController()
    const history = fakeHistory()
    registerPlayerBridge(ipc, controller, vi.fn(), history)
    let resolveLoad!: () => void
    vi.mocked(controller.loadFile).mockImplementationOnce(
      (path) =>
        new Promise<void>((resolve) => {
          calls.loadFile = [path]
          resolveLoad = resolve
        })
    )

    const loading = handlers.get(PLAYER_CHANNELS.load)!(event, '/tmp/video.mp4') as Promise<unknown>
    expect(history.recordOpened).not.toHaveBeenCalled()
    resolveLoad()
    await loading

    expect(controller.loadFile).toHaveBeenCalledWith('/tmp/video.mp4')
    expect(calls.loadFile).toEqual(['/tmp/video.mp4'])
    expect(history.recordOpened).toHaveBeenCalledWith('/tmp/video.mp4')
  })

  it('does not record a recent when loading rejects', async () => {
    const { ipc, handlers } = fakeIpc()
    const { controller } = fakeController()
    const failure = new Error('mpv failed')
    vi.mocked(controller.loadFile).mockRejectedValueOnce(failure)
    const history = fakeHistory()
    registerPlayerBridge(ipc, controller, vi.fn(), history)

    await expect(handlers.get(PLAYER_CHANNELS.load)!(event, '/tmp/video.mp4')).rejects.toBe(failure)
    expect(history.recordOpened).not.toHaveBeenCalled()
  })

  it('suspends history tracking before loadFile starts, so early events during the load cannot land on the outgoing file', async () => {
    const { ipc, handlers } = fakeIpc()
    const { controller, calls } = fakeController()
    const history = fakeHistory()
    registerPlayerBridge(ipc, controller, vi.fn(), history)
    const order: string[] = []
    vi.mocked(history.beginLoad).mockImplementation(() => order.push('beginLoad'))
    vi.mocked(controller.loadFile).mockImplementationOnce(async (path) => {
      calls.loadFile = [path]
      order.push('loadFile')
    })
    vi.mocked(history.recordOpened).mockImplementation(() => order.push('recordOpened'))

    await handlers.get(PLAYER_CHANNELS.load)!(event, '/tmp/b.mkv')

    expect(order).toEqual(['beginLoad', 'loadFile', 'recordOpened'])
  })

  it('resumes history tracking on the still-playing file when the load command is rejected outright', async () => {
    const { ipc, handlers } = fakeIpc()
    const { controller } = fakeController()
    const failure = new Error('mpv IPC: not connected')
    vi.mocked(controller.loadFile).mockRejectedValueOnce(failure)
    const history = fakeHistory()
    registerPlayerBridge(ipc, controller, vi.fn(), history)

    await expect(handlers.get(PLAYER_CHANNELS.load)!(event, '/tmp/b.mkv')).rejects.toBe(failure)

    expect(history.beginLoad).toHaveBeenCalledTimes(1)
    expect(history.abortLoad).toHaveBeenCalledTimes(1)
  })

  it('does not resume history tracking when mpv drops to idle after a failed load', async () => {
    const { ipc, handlers } = fakeIpc()
    const { controller } = fakeController()
    vi.mocked(controller.loadFile).mockRejectedValueOnce(
      new MpvLoadError('mpv could not load the file')
    )
    const history = fakeHistory()
    registerPlayerBridge(ipc, controller, vi.fn(), history)

    await expect(handlers.get(PLAYER_CHANNELS.load)!(event, '/tmp/b.mkv')).rejects.toThrow()

    expect(history.beginLoad).toHaveBeenCalledTimes(1)
    expect(history.abortLoad).not.toHaveBeenCalled()
  })

  it('forwards setPause to controller.setPause', () => {
    const { ipc, handlers } = fakeIpc()
    const { controller } = fakeController()
    registerPlayerBridge(ipc, controller, vi.fn())

    handlers.get(PLAYER_CHANNELS.setPause)!(event, true)

    expect(controller.setPause).toHaveBeenCalledWith(true)
  })

  it('forwards seek with the exact args, including absolute flag', () => {
    const { ipc, handlers } = fakeIpc()
    const { controller } = fakeController()
    registerPlayerBridge(ipc, controller, vi.fn())

    handlers.get(PLAYER_CHANNELS.seek)!(event, 42, true)

    expect(controller.seek).toHaveBeenCalledWith(42, true)
  })

  it('forwards setVolume to controller.setVolume', () => {
    const { ipc, handlers } = fakeIpc()
    const { controller } = fakeController()
    registerPlayerBridge(ipc, controller, vi.fn())

    handlers.get(PLAYER_CHANNELS.setVolume)!(event, 55)

    expect(controller.setVolume).toHaveBeenCalledWith(55)
  })

  it('forwards setMuted to controller.setMuted', () => {
    const { ipc, handlers } = fakeIpc()
    const { controller } = fakeController()
    registerPlayerBridge(ipc, controller, vi.fn())

    handlers.get(PLAYER_CHANNELS.setMuted)!(event, true)

    expect(controller.setMuted).toHaveBeenCalledWith(true)
  })

  it('forwards setAudioDelay to controller.setAudioDelay', () => {
    const { ipc, handlers } = fakeIpc()
    const { controller } = fakeController()
    registerPlayerBridge(ipc, controller, vi.fn())

    handlers.get(PLAYER_CHANNELS.setAudioDelay)!(event, 250)

    expect(controller.setAudioDelay).toHaveBeenCalledWith(250)
  })

  it('forwards setAudioTrack to controller.setAudioTrack', () => {
    const { ipc, handlers } = fakeIpc()
    const { controller } = fakeController()
    registerPlayerBridge(ipc, controller, vi.fn())

    handlers.get(PLAYER_CHANNELS.setAudioTrack)!(event, 3)

    expect(controller.setAudioTrack).toHaveBeenCalledWith(3)
  })

  it('rejects HTTP and HTTPS URLs before controller or history access', async () => {
    const { ipc, handlers } = fakeIpc()
    const { controller } = fakeController()
    const history = fakeHistory()
    registerPlayerBridge(ipc, controller, vi.fn(), history)

    await expect(
      handlers.get(PLAYER_CHANNELS.load)!(event, 'https://host/stream.m3u8')
    ).rejects.toThrow('URL playback is not supported.')
    await expect(
      handlers.get(PLAYER_CHANNELS.load)!(event, 'HTTP://host/video.mp4')
    ).rejects.toThrow('URL playback is not supported.')
    expect(controller.loadFile).not.toHaveBeenCalled()
    expect(history.beginLoad).not.toHaveBeenCalled()
  })

  it('forwards setAbLoop endpoints to controller.setAbLoop', () => {
    const { ipc, handlers } = fakeIpc()
    const { controller } = fakeController()
    registerPlayerBridge(ipc, controller, vi.fn())

    handlers.get(PLAYER_CHANNELS.setAbLoop)!(event, 12, 30)
    handlers.get(PLAYER_CHANNELS.setAbLoop)!(event, null, null)

    expect(controller.setAbLoop).toHaveBeenNthCalledWith(1, 12, 30)
    expect(controller.setAbLoop).toHaveBeenNthCalledWith(2, null, null)
  })

  it('forwards setVideoMargins to controller.setVideoMargins', () => {
    const { ipc, handlers } = fakeIpc()
    const { controller } = fakeController()
    registerPlayerBridge(ipc, controller, vi.fn())

    handlers.get(PLAYER_CHANNELS.setVideoMargins)!(event, 0.1, 0.08)

    expect(controller.setVideoMargins).toHaveBeenCalledWith(0.1, 0.08, undefined, undefined)
  })

  it('forwards setVideoMargins with right and left ratios when given', () => {
    const { ipc, handlers } = fakeIpc()
    const { controller } = fakeController()
    registerPlayerBridge(ipc, controller, vi.fn())

    handlers.get(PLAYER_CHANNELS.setVideoMargins)!(event, 0.1, 0.08, 0.2, 0.15)

    expect(controller.setVideoMargins).toHaveBeenCalledWith(0.1, 0.08, 0.2, 0.15)
  })

  it('fans one setVideoAdjustments call out to the equalizer, rotate and deinterlace setters', async () => {
    const { ipc, handlers } = fakeIpc()
    const { controller, calls } = fakeController()
    registerPlayerBridge(ipc, controller, vi.fn())

    await handlers.get(PLAYER_CHANNELS.setVideoAdjustments)!(event, {
      brightness: 10,
      contrast: -20,
      saturation: 30,
      gamma: -5,
      hue: 15,
      rotate: 90,
      deinterlace: true
    })

    expect(controller.setVideoAdjustment).toHaveBeenCalledTimes(5)
    expect(calls['setVideoAdjustment:brightness']).toEqual([10])
    expect(calls['setVideoAdjustment:contrast']).toEqual([-20])
    expect(calls['setVideoAdjustment:saturation']).toEqual([30])
    expect(calls['setVideoAdjustment:gamma']).toEqual([-5])
    expect(calls['setVideoAdjustment:hue']).toEqual([15])
    expect(controller.setVideoRotate).toHaveBeenCalledWith(90)
    expect(controller.setDeinterlace).toHaveBeenCalledWith(true)
  })

  it('forwards frameStep and frameBackStep to the controller', () => {
    const { ipc, handlers } = fakeIpc()
    const { controller } = fakeController()
    registerPlayerBridge(ipc, controller, vi.fn())

    handlers.get(PLAYER_CHANNELS.frameStep)!(event)
    handlers.get(PLAYER_CHANNELS.frameBackStep)!(event)

    expect(controller.frameStep).toHaveBeenCalledTimes(1)
    expect(controller.frameBackStep).toHaveBeenCalledTimes(1)
  })

  it('forwards the audio device/normalization channels to the controller', async () => {
    const { ipc, handlers } = fakeIpc()
    const { controller, calls } = fakeController()
    registerPlayerBridge(ipc, controller, vi.fn())

    const devices = await handlers.get(PLAYER_CHANNELS.getAudioDevices)!(event)
    expect(devices).toEqual([{ name: 'auto', description: 'Autoselect device' }])

    await handlers.get(PLAYER_CHANNELS.setAudioDevice)!(event, 'wasapi/{abc}')
    expect(calls.setAudioDevice).toEqual(['wasapi/{abc}'])

    await handlers.get(PLAYER_CHANNELS.setLoudnessNorm)!(event, true)
    expect(calls.setLoudnessNormalization).toEqual([true])
  })

  it('does not register the screenshot channel without a screenshot service', () => {
    const { ipc, handlers } = fakeIpc()
    const { controller } = fakeController()
    registerPlayerBridge(ipc, controller, vi.fn())

    expect(handlers.has(PLAYER_CHANNELS.screenshot)).toBe(false)
  })

  it('forwards screenshot to the service and resolves the saved path', async () => {
    const { ipc, handlers } = fakeIpc()
    const { controller } = fakeController()
    const screenshots = { capture: vi.fn(async () => '/pics/ep1-0-00-05.png') }
    registerPlayerBridge(ipc, controller, vi.fn(), undefined, undefined, screenshots)

    const saved = await handlers.get(PLAYER_CHANNELS.screenshot)!(event, '/v/ep1.mkv', 5)

    expect(screenshots.capture).toHaveBeenCalledWith('/v/ep1.mkv', 5)
    expect(saved).toBe('/pics/ep1-0-00-05.png')
  })

  it('rejects a screenshot with a sanitized message, hiding the raw error', async () => {
    const { ipc, handlers } = fakeIpc()
    const { controller } = fakeController()
    // Raw error embeds the target path (mkdirSync/mpv failures do); it must not
    // reach the renderer.
    const failure = new Error('ENOENT: /Users/me/Pictures/Kizuna/ep1-0-00-05.png')
    const screenshots = { capture: vi.fn().mockRejectedValue(failure) }
    registerPlayerBridge(ipc, controller, vi.fn(), undefined, undefined, screenshots)

    await expect(handlers.get(PLAYER_CHANNELS.screenshot)!(event, '/v/ep1.mkv', 5)).rejects.toThrow(
      'Could not save screenshot.'
    )
    await expect(
      handlers.get(PLAYER_CHANNELS.screenshot)!(event, '/v/ep1.mkv', 5)
    ).rejects.not.toThrow(/Pictures/)
  })

  it('preserves the sanitized screenshot-folder error and its configured path', async () => {
    const { ipc, handlers } = fakeIpc()
    const { controller } = fakeController()
    const screenshots = {
      capture: vi.fn().mockRejectedValue(new ScreenshotFolderError('X:\\pics'))
    }
    registerPlayerBridge(ipc, controller, vi.fn(), undefined, undefined, screenshots)

    await expect(handlers.get(PLAYER_CHANNELS.screenshot)!(event, '/v/ep1.mkv', 5)).rejects.toThrow(
      'Screenshot folder "X:\\pics" is invalid or unreachable.'
    )
  })

  it('does not register the captureFrame channel without a frame-capture service', () => {
    const { ipc, handlers } = fakeIpc()
    const { controller } = fakeController()
    registerPlayerBridge(ipc, controller, vi.fn())

    expect(handlers.has(PLAYER_CHANNELS.captureFrame)).toBe(false)
  })

  it('resolves captureFrame with the service’s base64 PNG data', async () => {
    const { ipc, handlers } = fakeIpc()
    const { controller } = fakeController()
    const frames = { captureFrameData: vi.fn(async () => 'iVBORw0KGgo=') }
    registerPlayerBridge(
      ipc,
      controller,
      vi.fn(),
      undefined,
      undefined,
      undefined,
      undefined,
      frames
    )

    expect(await handlers.get(PLAYER_CHANNELS.captureFrame)!(event)).toBe('iVBORw0KGgo=')
    expect(frames.captureFrameData).toHaveBeenCalledTimes(1)
  })

  it('resolves captureFrame with null on failure so a mine is never blocked', async () => {
    const { ipc, handlers } = fakeIpc()
    const { controller } = fakeController()
    const frames = {
      captureFrameData: vi.fn().mockRejectedValue(new Error('mpv: no video stream'))
    }
    registerPlayerBridge(
      ipc,
      controller,
      vi.fn(),
      undefined,
      undefined,
      undefined,
      undefined,
      frames
    )

    expect(await handlers.get(PLAYER_CHANNELS.captureFrame)!(event)).toBeNull()
  })

  it('forwards time-pos to history before sending it to the renderer', () => {
    const { ipc } = fakeIpc()
    const { controller, fireTimePos } = fakeController()
    const calls: string[] = []
    const history = fakeHistory()
    vi.mocked(history.observePosition).mockImplementation(() => calls.push('history'))
    const send = vi.fn(() => calls.push('renderer'))
    registerPlayerBridge(ipc, controller, send, history)

    fireTimePos(12.5)

    expect(send).toHaveBeenCalledWith(PLAYER_CHANNELS.timePos, 12.5)
    expect(history.observePosition).toHaveBeenCalledWith(12.5)
    expect(calls).toEqual(['history', 'renderer'])
  })

  it('forwards mpv path observations to history for load-transition attribution', () => {
    const { ipc } = fakeIpc()
    const { controller, firePath } = fakeController()
    const history = fakeHistory()
    registerPlayerBridge(ipc, controller, vi.fn(), history)

    firePath('/tmp/video.mp4')

    expect(history.observePath).toHaveBeenCalledWith('/tmp/video.mp4')
  })

  it('forwards boolean pause observations to the renderer, ignoring non-booleans', () => {
    const { ipc } = fakeIpc()
    const { controller, firePause } = fakeController()
    const send = vi.fn()
    registerPlayerBridge(ipc, controller, send)

    firePause(true)
    expect(send).toHaveBeenCalledWith(PLAYER_CHANNELS.pause, true)

    firePause(false)
    expect(send).toHaveBeenLastCalledWith(PLAYER_CHANNELS.pause, false)

    send.mockClear()
    firePause('not-boolean')
    expect(send).not.toHaveBeenCalled()
  })

  it('forwards eof-reached values to the renderer', () => {
    const { ipc } = fakeIpc()
    const { controller, fireEof } = fakeController()
    const send = vi.fn()
    registerPlayerBridge(ipc, controller, send)

    fireEof(true)

    expect(send).toHaveBeenCalledWith(PLAYER_CHANNELS.eofReached, true)
  })

  it('forwards every duration value to history and the renderer', () => {
    const { ipc } = fakeIpc()
    const { controller, fireDuration } = fakeController()
    const calls: string[] = []
    const history = fakeHistory()
    vi.mocked(history.observeDuration).mockImplementation(() => calls.push('history'))
    const send = vi.fn(() => calls.push('renderer'))
    registerPlayerBridge(ipc, controller, send, history)

    fireDuration('invalid')

    expect(send).toHaveBeenCalledWith(PLAYER_CHANNELS.duration, 'invalid')
    expect(history.observeDuration).toHaveBeenCalledWith('invalid')
    expect(calls).toEqual(['history', 'renderer'])
  })

  it('updates power save only after load succeeds and pause observations change playback state', async () => {
    const { ipc, handlers } = fakeIpc()
    const { controller, firePause } = fakeController()
    const powerSave = { update: vi.fn() }
    registerPlayerBridge(ipc, controller, vi.fn(), undefined, powerSave)

    firePause(false)
    expect(powerSave.update).toHaveBeenCalledWith(false)

    await handlers.get(PLAYER_CHANNELS.load)!(event, '/tmp/video.mp4')
    expect(powerSave.update).toHaveBeenLastCalledWith(true)

    firePause(true)
    expect(powerSave.update).toHaveBeenLastCalledWith(false)
    firePause('not-boolean')
    expect(powerSave.update).toHaveBeenCalledTimes(3)
  })

  describe('power-save wiring', () => {
    function fakePowerSave() {
      return { update: vi.fn() }
    }

    it('holds the blocker once a file has loaded and stays unpaused', async () => {
      const { ipc, handlers } = fakeIpc()
      const { controller } = fakeController()
      const powerSave = fakePowerSave()
      registerPlayerBridge(ipc, controller, vi.fn(), undefined, powerSave)

      await (handlers.get(PLAYER_CHANNELS.load)!(event, '/tmp/video.mp4') as Promise<unknown>)

      expect(powerSave.update).toHaveBeenLastCalledWith(true)
    })

    it('releases the blocker when mpv reports paused, and re-holds on unpause', async () => {
      const { ipc, handlers } = fakeIpc()
      const { controller, firePause } = fakeController()
      const powerSave = fakePowerSave()
      registerPlayerBridge(ipc, controller, vi.fn(), undefined, powerSave)

      await (handlers.get(PLAYER_CHANNELS.load)!(event, '/tmp/video.mp4') as Promise<unknown>)
      firePause(true)
      expect(powerSave.update).toHaveBeenLastCalledWith(false)

      firePause(false)
      expect(powerSave.update).toHaveBeenLastCalledWith(true)
    })

    it('ignores a non-boolean pause observation', async () => {
      const { ipc, handlers } = fakeIpc()
      const { controller, firePause } = fakeController()
      const powerSave = fakePowerSave()
      registerPlayerBridge(ipc, controller, vi.fn(), undefined, powerSave)

      await (handlers.get(PLAYER_CHANNELS.load)!(event, '/tmp/video.mp4') as Promise<unknown>)
      powerSave.update.mockClear()

      firePause('yes' as unknown as boolean)

      expect(powerSave.update).not.toHaveBeenCalled()
    })

    it('never calls update before a file has loaded', () => {
      const { ipc } = fakeIpc()
      const { controller, firePause } = fakeController()
      const powerSave = fakePowerSave()
      registerPlayerBridge(ipc, controller, vi.fn(), undefined, powerSave)

      firePause(false)

      expect(powerSave.update).toHaveBeenLastCalledWith(false)
    })

    it('releases the blocker when a later load fails with mpv dropping to idle', async () => {
      const { ipc, handlers } = fakeIpc()
      const { controller } = fakeController()
      const powerSave = fakePowerSave()
      registerPlayerBridge(ipc, controller, vi.fn(), undefined, powerSave)

      await (handlers.get(PLAYER_CHANNELS.load)!(event, '/tmp/first.mkv') as Promise<unknown>)
      expect(powerSave.update).toHaveBeenLastCalledWith(true)

      // An MpvLoadError means the file failed to load and mpv is now idle.
      vi.mocked(controller.loadFile).mockRejectedValueOnce(
        new MpvLoadError('mpv could not load the file (error)')
      )
      await expect(handlers.get(PLAYER_CHANNELS.load)!(event, '/tmp/broken.mkv')).rejects.toThrow(
        'mpv could not load the file (error)'
      )
      expect(powerSave.update).toHaveBeenLastCalledWith(false)
    })

    it('keeps the blocker when a load command rejects while a file is still playing', async () => {
      const { ipc, handlers } = fakeIpc()
      const { controller } = fakeController()
      const powerSave = fakePowerSave()
      registerPlayerBridge(ipc, controller, vi.fn(), undefined, powerSave)

      await (handlers.get(PLAYER_CHANNELS.load)!(event, '/tmp/first.mkv') as Promise<unknown>)
      expect(powerSave.update).toHaveBeenLastCalledWith(true)
      powerSave.update.mockClear()

      // A plain command-send rejection (not an MpvLoadError): mpv never dropped
      // the currently playing file, so the blocker must stay held.
      vi.mocked(controller.loadFile).mockRejectedValueOnce(new Error('mpv IPC: not connected'))
      await expect(handlers.get(PLAYER_CHANNELS.load)!(event, '/tmp/broken.mkv')).rejects.toThrow(
        'mpv IPC: not connected'
      )
      expect(powerSave.update).not.toHaveBeenCalled()
    })
  })

  describe('system-media wiring', () => {
    function fakeSystemMedia() {
      return { update: vi.fn() }
    }

    it('reports a loaded, unpaused snapshot once a file has loaded', async () => {
      const { ipc, handlers } = fakeIpc()
      const { controller } = fakeController()
      const systemMedia = fakeSystemMedia()
      registerPlayerBridge(ipc, controller, vi.fn(), undefined, undefined, undefined, systemMedia)

      await (handlers.get(PLAYER_CHANNELS.load)!(event, '/tmp/video.mp4') as Promise<unknown>)

      expect(systemMedia.update).toHaveBeenLastCalledWith({
        fileLoaded: true,
        paused: false,
        timePos: 0,
        duration: 0
      })
    })

    it('reports fileLoaded=false when a later load fails with mpv dropping to idle', async () => {
      const { ipc, handlers } = fakeIpc()
      const { controller } = fakeController()
      const systemMedia = fakeSystemMedia()
      registerPlayerBridge(ipc, controller, vi.fn(), undefined, undefined, undefined, systemMedia)

      await (handlers.get(PLAYER_CHANNELS.load)!(event, '/tmp/first.mkv') as Promise<unknown>)
      vi.mocked(controller.loadFile).mockRejectedValueOnce(new MpvLoadError('load failed'))
      await expect(handlers.get(PLAYER_CHANNELS.load)!(event, '/tmp/broken.mkv')).rejects.toThrow()

      expect(systemMedia.update).toHaveBeenLastCalledWith({
        fileLoaded: false,
        paused: false,
        timePos: 0,
        duration: 0
      })
    })

    it('feeds time-pos, duration and pause observations into the snapshot', async () => {
      const { ipc, handlers } = fakeIpc()
      const { controller, fireTimePos, fireDuration, firePause } = fakeController()
      const systemMedia = fakeSystemMedia()
      registerPlayerBridge(ipc, controller, vi.fn(), undefined, undefined, undefined, systemMedia)

      await (handlers.get(PLAYER_CHANNELS.load)!(event, '/tmp/video.mp4') as Promise<unknown>)
      fireDuration(120)
      fireTimePos(30)
      firePause(true)

      expect(systemMedia.update).toHaveBeenLastCalledWith({
        fileLoaded: true,
        paused: true,
        timePos: 30,
        duration: 120
      })
    })

    it('ignores non-numeric time-pos/duration observations for the snapshot', async () => {
      const { ipc, handlers } = fakeIpc()
      const { controller, fireTimePos, fireDuration } = fakeController()
      const systemMedia = fakeSystemMedia()
      registerPlayerBridge(ipc, controller, vi.fn(), undefined, undefined, undefined, systemMedia)

      await (handlers.get(PLAYER_CHANNELS.load)!(event, '/tmp/video.mp4') as Promise<unknown>)
      fireTimePos(15)
      systemMedia.update.mockClear()
      fireDuration('invalid')

      expect(systemMedia.update).not.toHaveBeenCalled()
    })
  })
})
